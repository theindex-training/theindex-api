import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { contentToPlainText } from '../articles/article-content';
import { ArticleCategoryLinkEntity } from '../articles/article-category-link.entity';
import { ArticleEntity, ArticleStatus } from '../articles/article.entity';
import { DEFAULT_LANGUAGE } from '../articles/articles.service';
import {
  InvalidPreviewTokenError,
  verifyPreviewToken,
} from '../articles/preview-token';
import { containsPattern } from '../common/utils/like.util';
import { MediaService } from '../media/media.service';
import {
  ListPublicArticlesQueryDto,
  PUBLIC_ARTICLES_PAGE_SIZE_DEFAULT,
} from './dto/list-public-articles.query.dto';
import {
  ArticlePreview,
  PublicArticle,
  PublicArticlePage,
  PublicArticleSummary,
  PublicCategory,
  PublicCategoryRef,
  PublicSitemap,
  excerptOf,
  mediaIdsOf,
  seoOf,
  toPublicBlocks,
} from './public-content';

/** The columns a list needs: no content, no draft. */
const SUMMARY_COLUMNS = [
  'a.id',
  'a.slug',
  'a.title',
  'a.excerpt',
  'a.plainText',
  'a.featuredMediaId',
  'a.firstPublishedAt',
  'a.lastPublishedAt',
];

/**
 * What the public site reads (theindex-web docs/decision-record.md, section 8). Every query here
 * starts from PUBLISHED articles of the language; the draft and the back office's fields never
 * leave this service, except through a valid preview token.
 */
@Injectable()
export class PublicContentService {
  constructor(
    @InjectRepository(ArticleEntity)
    private readonly articles: Repository<ArticleEntity>,
    @InjectRepository(ArticleCategoryEntity)
    private readonly categories: Repository<ArticleCategoryEntity>,
    private readonly media: MediaService,
  ) {}

  /** Published articles, newest first (by first publish), optionally in a category or searched. */
  async listArticles(
    q: ListPublicArticlesQueryDto,
  ): Promise<PublicArticlePage> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? PUBLIC_ARTICLES_PAGE_SIZE_DEFAULT;
    const query = this.published().select(SUMMARY_COLUMNS);

    if (q.category) {
      query.andWhere(
        (sub) =>
          `EXISTS ${sub
            .subQuery()
            .select('1')
            .from(ArticleCategoryLinkEntity, 'l')
            .innerJoin(ArticleCategoryEntity, 'c', 'c.id = l.categoryId')
            .where('l.articleId = a.id')
            .andWhere('c.language = a.language')
            .andWhere('c.slug = :category')
            .getQuery()}`,
        { category: q.category },
      );
    }
    if (q.q) {
      query.andWhere(
        `(a.title ILIKE :search ESCAPE '\\' OR a.excerpt ILIKE :search ESCAPE '\\' OR a.plainText ILIKE :search ESCAPE '\\')`,
        { search: containsPattern(q.q) },
      );
    }

    const [rows, total] = await query
      .orderBy('a.firstPublishedAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const [categories, media] = await Promise.all([
      this.publishedCategoriesOf(rows.map((r) => r.id)),
      this.media.publicMedia(
        rows.flatMap((r) => (r.featuredMediaId ? [r.featuredMediaId] : [])),
      ),
    ]);
    const items = rows.map((a) =>
      summaryOf(
        a,
        categories.get(a.id) ?? [],
        (a.featuredMediaId && media.get(a.featuredMediaId)) || null,
      ),
    );
    return { items, total, page, pageSize };
  }

  /** A published article by its slug; 404 for anything else (draft, unpublished, unknown). */
  async getArticle(slug: string): Promise<PublicArticle> {
    const article = await this.published()
      .andWhere('a.slug = :slug', { slug })
      .getOne();
    if (!article) throw new NotFoundException('Article not found');

    const [categories, media] = await Promise.all([
      this.publishedCategoriesOf([article.id]),
      this.media.publicMedia(
        mediaIdsOf(article.content, article.featuredMediaId),
      ),
    ]);
    const featuredImage =
      (article.featuredMediaId && media.get(article.featuredMediaId)) || null;
    const text = textOf(article);
    return {
      ...summaryOf(article, categories.get(article.id) ?? [], featuredImage),
      language: article.language,
      ...seoOf(text),
      content: { blocks: toPublicBlocks(article.content, media) },
    };
  }

  /** Categories with at least one published article, in navigation order. */
  listCategories(): Promise<PublicCategory[]> {
    return this.publicCategories().getRawMany<PublicCategory>();
  }

  /** One category; 404 unless it has a published article. */
  async getCategory(slug: string): Promise<PublicCategory> {
    const category = await this.publicCategories()
      .andWhere('c.slug = :slug', { slug })
      .getRawOne<PublicCategory>();
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  /** Slugs and last changes of everything public, for the site's sitemap.xml. */
  async sitemap(): Promise<PublicSitemap> {
    const [articles, categories] = await Promise.all([
      this.published()
        .select(['a.id', 'a.slug', 'a.lastPublishedAt'])
        .orderBy('a.firstPublishedAt', 'DESC')
        .addOrderBy('a.id', 'DESC')
        .getMany(),
      this.withPublishedArticles()
        .select('c.slug', 'slug')
        .addSelect('GREATEST(c.updatedAt, MAX(a.lastPublishedAt))', 'lastmod')
        .groupBy('c.id')
        .orderBy('c.sortOrder', 'ASC')
        .addOrderBy('c.name', 'ASC')
        .getRawMany<{ slug: string; lastmod: Date }>(),
    ]);
    return {
      articles: articles.map((a) => ({
        slug: a.slug!,
        lastmod: a.lastPublishedAt!,
      })),
      categories,
    };
  }

  /**
   * The draft of the article a preview token was issued for, whatever its status, as it is now
   * (so a reload shows the latest autosave). 401 for a bad or expired token, 404 when the article
   * has been deleted since.
   */
  async preview(token: string): Promise<ArticlePreview> {
    let articleId: string;
    try {
      articleId = verifyPreviewToken(token, process.env.JWT_SECRET ?? '');
    } catch (error) {
      if (error instanceof InvalidPreviewTokenError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    const article = await this.articles.findOne({ where: { id: articleId } });
    if (!article) throw new NotFoundException('Article not found');

    const draft = article.draft;
    const [categories, media] = await Promise.all([
      draft.categoryIds.length
        ? this.categories.find({
            select: { slug: true, name: true },
            where: { id: In(draft.categoryIds) },
            order: { sortOrder: 'ASC', name: 'ASC' },
          })
        : Promise.resolve([]),
      this.media.publicMedia(mediaIdsOf(draft.content, draft.featuredMediaId)),
    ]);
    const text = {
      title: draft.title,
      excerpt: draft.excerpt,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      plainText: contentToPlainText(draft.content),
    };
    return {
      preview: true,
      status: article.status,
      slug: article.slug ?? draft.slug,
      language: article.language,
      title: draft.title,
      excerpt: excerptOf(text),
      ...seoOf(text),
      featuredImage:
        (draft.featuredMediaId && media.get(draft.featuredMediaId)) || null,
      categories: categories.map(({ slug, name }) => ({ slug, name })),
      publishedAt: article.firstPublishedAt,
      updatedAt: article.draftUpdatedAt,
      content: { blocks: toPublicBlocks(draft.content, media) },
    };
  }

  /** PUBLISHED articles of the language, as `a`. */
  private published(): SelectQueryBuilder<ArticleEntity> {
    return this.articles
      .createQueryBuilder('a')
      .where('a.language = :language', { language: DEFAULT_LANGUAGE })
      .andWhere('a.status = :status', { status: ArticleStatus.PUBLISHED });
  }

  /** Categories (`c`) joined to their PUBLISHED articles (`a`): no row without one. */
  private withPublishedArticles(): SelectQueryBuilder<ArticleCategoryEntity> {
    return this.categories
      .createQueryBuilder('c')
      .innerJoin(ArticleCategoryLinkEntity, 'l', 'l.categoryId = c.id')
      .innerJoin(
        ArticleEntity,
        'a',
        'a.id = l.articleId AND a.status = :status AND a.language = c.language',
        { status: ArticleStatus.PUBLISHED },
      )
      .where('c.language = :language', { language: DEFAULT_LANGUAGE });
  }

  private publicCategories(): SelectQueryBuilder<ArticleCategoryEntity> {
    return this.withPublishedArticles()
      .select('c.slug', 'slug')
      .addSelect('c.name', 'name')
      .addSelect('c.description', 'description')
      .addSelect('COUNT(a.id)::int', 'articleCount')
      .groupBy('c.id')
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('c.name', 'ASC');
  }

  /** The published categories of each article, in navigation order. */
  private async publishedCategoriesOf(
    articleIds: string[],
  ): Promise<Map<string, PublicCategoryRef[]>> {
    const result = new Map<string, PublicCategoryRef[]>();
    if (!articleIds.length) return result;
    const rows = await this.categories
      .createQueryBuilder('c')
      .innerJoin(ArticleCategoryLinkEntity, 'l', 'l.categoryId = c.id')
      .select('l.articleId', 'articleId')
      .addSelect('c.slug', 'slug')
      .addSelect('c.name', 'name')
      .where('l.articleId IN (:...articleIds)', { articleIds })
      .orderBy('c.sortOrder', 'ASC')
      .addOrderBy('c.name', 'ASC')
      .getRawMany<{ articleId: string; slug: string; name: string }>();
    for (const { articleId, slug, name } of rows) {
      const list = result.get(articleId) ?? [];
      list.push({ slug, name });
      result.set(articleId, list);
    }
    return result;
  }
}

/** The published text fields; a published article always has a title. */
function textOf(a: ArticleEntity) {
  return {
    title: a.title ?? '',
    excerpt: a.excerpt,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    plainText: a.plainText ?? '',
  };
}

function summaryOf(
  a: ArticleEntity,
  categories: PublicCategoryRef[],
  featuredImage: PublicArticleSummary['featuredImage'],
): PublicArticleSummary {
  return {
    slug: a.slug!,
    title: a.title ?? '',
    excerpt: excerptOf(textOf(a)),
    featuredImage,
    categories,
    publishedAt: a.firstPublishedAt!,
    updatedAt: a.lastPublishedAt!,
  };
}
