import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { slugify, uniqueSlug } from '../common/utils/slug.util';
import { MediaEntity } from '../media/media.entity';
import { MediaKind } from '../media/media-kind';
import {
  ArticleContent,
  EMPTY_CONTENT,
  contentToPlainText,
} from './article-content';
import { ArticleCategoryLinkEntity } from './article-category-link.entity';
import {
  ARTICLE_SLUG_INDEX,
  ArticleDraft,
  ArticleEntity,
  ArticleStatus,
} from './article.entity';
import { ArticlesService, staleRevision } from './articles.service';
import { TITLE_MAX_LENGTH } from './dto/article-fields';

/** Path segments of the site under /articles that an article slug must not take. */
export const RESERVED_ARTICLE_SLUGS = ['category'] as const;

/** Slug for a title that gives none (e.g. only emoji): "statia", "statia-2", ... */
const FALLBACK_SLUG = 'statia';

/**
 * The article lifecycle (theindex-web docs/decision-record.md, section 5):
 * DRAFT -> publish -> PUBLISHED -> unpublish -> UNPUBLISHED -> publish again, and permanent delete
 * for anything not published. Each change locks the article row, so two requests can't interleave.
 */
@Injectable()
export class ArticlePublishingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly articles: ArticlesService,
  ) {}

  /**
   * Publishes the draft (first publish, republish, or "Update"): checks the rules for going live,
   * sets the slug at the first publish, copies the draft over the published version and links
   * its categories. The draft itself is left as it is.
   */
  async publish(id: string, baseRevision: number, accountId: string | null) {
    try {
      await this.dataSource.transaction(async (m) => {
        const article = await this.lockOrFail(m, id);
        if (article.draftRevision !== baseRevision) {
          throw staleRevision(article.draftRevision);
        }

        const draft = article.draft;
        const problems = await this.problemsWith(m, draft);
        const slug = article.slug ?? (await this.newSlug(m, article, problems));
        if (problems.length) {
          throw new BadRequestException({
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'Bad Request',
            message: problems,
          });
        }

        const now = new Date();
        Object.assign(article, {
          status: ArticleStatus.PUBLISHED,
          slug,
          title: draft.title,
          excerpt: draft.excerpt,
          content: draft.content,
          plainText: contentToPlainText(draft.content),
          featuredMediaId: draft.featuredMediaId,
          seoTitle: draft.seoTitle,
          seoDescription: draft.seoDescription,
          firstPublishedAt: article.firstPublishedAt ?? now,
          lastPublishedAt: now,
          unpublishedAt: null,
          hasUnpublishedChanges: false,
          updatedByAccountId: accountId,
        });
        await m.save(article);

        await m.delete(ArticleCategoryLinkEntity, { articleId: id });
        if (draft.categoryIds.length) {
          await m.insert(
            ArticleCategoryLinkEntity,
            draft.categoryIds.map((categoryId) => ({
              articleId: id,
              categoryId,
            })),
          );
        }
      });
    } catch (error) {
      // Another article took the slug between our check and the save.
      if (violatedUniqueIndex(error) === ARTICLE_SLUG_INDEX) {
        throw new ConflictException(
          'The slug was just taken by another article; publish again to get a new one',
        );
      }
      throw error;
    }
    return this.articles.get(id);
  }

  /** PUBLISHED -> UNPUBLISHED. The published version is kept, so it can go back up. */
  async unpublish(id: string, accountId: string | null) {
    await this.dataSource.transaction(async (m) => {
      const article = await this.lockOrFail(m, id);
      if (article.status !== ArticleStatus.PUBLISHED) {
        throw new ConflictException(
          'Only a published article can be unpublished',
        );
      }
      article.status = ArticleStatus.UNPUBLISHED;
      article.unpublishedAt = new Date();
      article.updatedByAccountId = accountId;
      await m.save(article);
    });
    return this.articles.get(id);
  }

  /** Throws the draft's changes away: the draft becomes the published version again. */
  async discardDraft(
    id: string,
    baseRevision: number,
    accountId: string | null,
  ) {
    await this.dataSource.transaction(async (m) => {
      const article = await this.lockOrFail(m, id);
      if (article.draftRevision !== baseRevision) {
        throw staleRevision(article.draftRevision);
      }
      if (!article.firstPublishedAt) {
        throw new ConflictException(
          'The article has never been published, so there is no version to go back to',
        );
      }
      const links = await m.find(ArticleCategoryLinkEntity, {
        where: { articleId: id },
        order: { categoryId: 'ASC' },
      });
      const draft: ArticleDraft = {
        title: article.title ?? '',
        excerpt: article.excerpt,
        content: article.content ?? EMPTY_CONTENT,
        featuredMediaId: article.featuredMediaId,
        categoryIds: links.map((l) => l.categoryId),
        seoTitle: article.seoTitle,
        seoDescription: article.seoDescription,
        slug: article.slug,
      };
      Object.assign(article, {
        draft,
        draftRevision: article.draftRevision + 1,
        draftUpdatedAt: new Date(),
        hasUnpublishedChanges: false,
        updatedByAccountId: accountId,
      });
      await m.save(article);
    });
    return this.articles.get(id);
  }

  /** Deletes an article for good. A published one must be unpublished first. */
  async delete(id: string) {
    await this.dataSource.transaction(async (m) => {
      const article = await this.lockOrFail(m, id);
      if (article.status === ArticleStatus.PUBLISHED) {
        throw new ConflictException(
          'Unpublish the article before deleting it permanently',
        );
      }
      // The category links go with it (ON DELETE CASCADE).
      await m.delete(ArticleEntity, { id });
    });
    return { deleted: true };
  }

  private async lockOrFail(m: EntityManager, id: string) {
    const article = await m.findOne(ArticleEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  /** What stops the draft from going live, in words an admin can act on. */
  private async problemsWith(m: EntityManager, draft: ArticleDraft) {
    const problems: string[] = [];

    const title = draft.title.trim();
    if (!title) problems.push('The article needs a title');
    if (title.length > TITLE_MAX_LENGTH) {
      problems.push(`The title can be at most ${TITLE_MAX_LENGTH} characters`);
    }
    if (!draft.content.blocks.length) {
      problems.push('The article needs some content');
    }

    // Only article images: another kind's id (a workout's PDF) is never shown on the site.
    if (
      draft.featuredMediaId &&
      !(await m.exists(MediaEntity, {
        where: { id: draft.featuredMediaId, kind: MediaKind.ARTICLE_IMAGE },
      }))
    ) {
      problems.push('The featured image no longer exists');
    }

    const imageIds = imageMediaIds(draft.content);
    if (imageIds.length) {
      const found = await m.find(MediaEntity, {
        select: { id: true },
        where: { id: In(imageIds), kind: MediaKind.ARTICLE_IMAGE },
      });
      const foundIds = new Set(found.map((f) => f.id));
      draft.content.blocks.forEach((block, index) => {
        if (block.type === 'image' && !foundIds.has(block.data.mediaId)) {
          problems.push(`The image in block ${index + 1} no longer exists`);
        }
      });
    }

    if (draft.categoryIds.length) {
      const found = await m.find(ArticleCategoryEntity, {
        select: { id: true },
        where: { id: In(draft.categoryIds) },
      });
      const missing = draft.categoryIds.length - found.length;
      if (missing) {
        problems.push(
          missing === 1
            ? 'One of the categories no longer exists'
            : `${missing} of the categories no longer exist`,
        );
      }
    }

    return problems;
  }

  /**
   * The slug for the first publish: the one the admin chose, or one made from the title and made
   * unique. A chosen slug that is reserved or taken is a problem to fix, not silently changed.
   */
  private async newSlug(
    m: EntityManager,
    article: ArticleEntity,
    problems: string[],
  ): Promise<string> {
    const chosen = article.draft.slug;
    if (chosen) {
      if ((RESERVED_ARTICLE_SLUGS as readonly string[]).includes(chosen)) {
        problems.push(`The slug "${chosen}" is reserved`);
      } else if (
        await m.exists(ArticleEntity, {
          where: { language: article.language, slug: chosen },
        })
      ) {
        problems.push(
          `The slug "${chosen}" is already used by another article`,
        );
      }
      return chosen;
    }

    const taken = await m.find(ArticleEntity, {
      select: { slug: true },
      where: { language: article.language },
    });
    return uniqueSlug(
      slugify(article.draft.title),
      taken.flatMap((t) => (t.slug ? [t.slug] : [])),
      { fallback: FALLBACK_SLUG, reserved: RESERVED_ARTICLE_SLUGS },
    );
  }
}

function imageMediaIds(content: ArticleContent): string[] {
  return [
    ...new Set(
      content.blocks.flatMap((b) =>
        b.type === 'image' ? [b.data.mediaId] : [],
      ),
    ),
  ];
}
