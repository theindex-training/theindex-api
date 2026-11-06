import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EMPTY_CONTENT,
  InvalidContentError,
  normalizeContent,
} from './article-content';
import { ArticleDraft, ArticleEntity, ArticleStatus } from './article.entity';
import { CreateArticleDto } from './dto/create-article.dto';
import {
  ARTICLES_PAGE_SIZE_DEFAULT,
  ListArticlesQueryDto,
} from './dto/list-articles.query.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

/** All content is Bulgarian for now (theindex-web docs/decision-record.md, D14). */
export const DEFAULT_LANGUAGE = 'bg';

/** The published version, as the back office sees it; null before the first publish. */
export interface PublishedVersion {
  title: string | null;
  excerpt: string | null;
  content: ArticleEntity['content'];
  featuredMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

export interface ArticleResponse {
  id: string;
  language: string;
  status: ArticleStatus;
  slug: string | null;
  published: PublishedVersion | null;
  draft: ArticleDraft;
  draftRevision: number;
  draftUpdatedAt: Date;
  hasUnpublishedChanges: boolean;
  firstPublishedAt: Date | null;
  lastPublishedAt: Date | null;
  unpublishedAt: Date | null;
  createdByAccountId: string | null;
  updatedByAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A row of the back-office list: enough to show and filter, without the content. */
export interface ArticleSummary {
  id: string;
  status: ArticleStatus;
  slug: string | null;
  /** The draft's title, which is what the editor works on. */
  title: string;
  publishedTitle: string | null;
  categoryIds: string[];
  featuredMediaId: string | null;
  hasUnpublishedChanges: boolean;
  draftUpdatedAt: Date;
  firstPublishedAt: Date | null;
  lastPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticlePage {
  items: ArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Articles in the back office (ADMIN): creating drafts, the list, and autosave. Publishing and
 * the rest of the lifecycle come next (backlog item 6, second part).
 */
@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(ArticleEntity)
    private readonly repo: Repository<ArticleEntity>,
  ) {}

  async create(dto: CreateArticleDto, accountId: string | null) {
    const draft: ArticleDraft = {
      title: dto.title,
      excerpt: null,
      content: EMPTY_CONTENT,
      featuredMediaId: null,
      categoryIds: [],
      seoTitle: null,
      seoDescription: null,
      slug: null,
    };
    const saved = await this.repo.save(
      this.repo.create({
        language: DEFAULT_LANGUAGE,
        status: ArticleStatus.DRAFT,
        draft,
        draftRevision: 0,
        draftUpdatedAt: new Date(),
        hasUnpublishedChanges: true,
        createdByAccountId: accountId,
        updatedByAccountId: accountId,
      }),
    );
    return this.get(saved.id);
  }

  /** The back-office list, most recently changed first. */
  async list(q: ListArticlesQueryDto): Promise<ArticlePage> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? ARTICLES_PAGE_SIZE_DEFAULT;
    const query = this.repo
      .createQueryBuilder('a')
      .where('a.language = :language', { language: DEFAULT_LANGUAGE });

    if (q.status) query.andWhere('a.status = :status', { status: q.status });
    if (q.categoryId) {
      query.andWhere(`a.draft -> 'categoryIds' @> :categoryIds::jsonb`, {
        // Stored ids are lowercase (saveDraft); JSON containment compares strings exactly.
        categoryIds: JSON.stringify([q.categoryId.toLowerCase()]),
      });
    }
    if (q.search) {
      query.andWhere(`a.draft ->> 'title' ILIKE :search ESCAPE '\\'`, {
        search: `%${escapeLike(q.search)}%`,
      });
    }

    const [rows, total] = await query
      .orderBy('a.updatedAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items: rows.map(toSummary), total, page, pageSize };
  }

  async get(id: string): Promise<ArticleResponse> {
    return toResponse(await this.findOrFail(id));
  }

  /**
   * Autosave. Merges the sent fields into the draft, only if the client saw the current
   * revision: two tabs can't overwrite each other's work (409 for the stale one). The published
   * version is never touched here.
   */
  async saveDraft(id: string, dto: SaveDraftDto, accountId: string | null) {
    const article = await this.findOrFail(id);

    if (dto.slug !== undefined && article.firstPublishedAt) {
      throw new BadRequestException(
        'The slug is fixed once the article has been published',
      );
    }

    const draft: ArticleDraft = { ...article.draft };
    if (dto.title !== undefined) draft.title = dto.title;
    if (dto.excerpt !== undefined) draft.excerpt = dto.excerpt || null;
    if (dto.content !== undefined)
      draft.content = contentOrBadRequest(dto.content);
    if (dto.featuredMediaId !== undefined) {
      draft.featuredMediaId = dto.featuredMediaId?.toLowerCase() ?? null;
    }
    if (dto.categoryIds !== undefined) {
      draft.categoryIds = dto.categoryIds.map((c) => c.toLowerCase());
    }
    if (dto.seoTitle !== undefined) draft.seoTitle = dto.seoTitle || null;
    if (dto.seoDescription !== undefined) {
      draft.seoDescription = dto.seoDescription || null;
    }
    if (dto.slug !== undefined) draft.slug = dto.slug || null;

    // Only if the draft is still at the revision the client saw: a stale tab, or a concurrent
    // save that got in first, loses (409) instead of silently overwriting.
    const result = await this.repo
      .createQueryBuilder()
      .update(ArticleEntity)
      .set({
        draft,
        draftRevision: () => '"draftRevision" + 1',
        draftUpdatedAt: () => 'now()',
        hasUnpublishedChanges: true,
        updatedByAccountId: accountId,
      })
      .where('id = :id AND "draftRevision" = :base', {
        id,
        base: dto.baseRevision,
      })
      .execute();

    if (!result.affected) {
      throw staleRevision((await this.findOrFail(id)).draftRevision);
    }
    return this.get(id);
  }

  private async findOrFail(id: string): Promise<ArticleEntity> {
    const article = await this.repo.findOne({ where: { id } });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }
}

function contentOrBadRequest(input: unknown) {
  try {
    return normalizeContent(input);
  } catch (error) {
    if (error instanceof InvalidContentError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/** 409 with the current revision, so the client can tell the user and reload. */
function staleRevision(currentRevision: number) {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    message:
      'The article was changed in another tab or by someone else. Reload it to continue.',
    currentRevision,
  });
}

/** Escapes LIKE wildcards so a search for "100%" matches the text "100%". */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toResponse(a: ArticleEntity): ArticleResponse {
  return {
    id: a.id,
    language: a.language,
    status: a.status,
    slug: a.slug,
    published: a.firstPublishedAt
      ? {
          title: a.title,
          excerpt: a.excerpt,
          content: a.content,
          featuredMediaId: a.featuredMediaId,
          seoTitle: a.seoTitle,
          seoDescription: a.seoDescription,
        }
      : null,
    draft: a.draft,
    draftRevision: a.draftRevision,
    draftUpdatedAt: a.draftUpdatedAt,
    hasUnpublishedChanges: a.hasUnpublishedChanges,
    firstPublishedAt: a.firstPublishedAt,
    lastPublishedAt: a.lastPublishedAt,
    unpublishedAt: a.unpublishedAt,
    createdByAccountId: a.createdByAccountId,
    updatedByAccountId: a.updatedByAccountId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function toSummary(a: ArticleEntity): ArticleSummary {
  return {
    id: a.id,
    status: a.status,
    slug: a.slug,
    title: a.draft.title,
    publishedTitle: a.title,
    categoryIds: a.draft.categoryIds,
    featuredMediaId: a.draft.featuredMediaId,
    hasUnpublishedChanges: a.hasUnpublishedChanges,
    draftUpdatedAt: a.draftUpdatedAt,
    firstPublishedAt: a.firstPublishedAt,
    lastPublishedAt: a.lastPublishedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
