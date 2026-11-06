import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArticleCategoryLinkEntity } from '../articles/article-category-link.entity';
import { ArticleEntity, ArticleStatus } from '../articles/article.entity';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { slugify, uniqueSlug } from '../common/utils/slug.util';
import {
  ArticleCategoryEntity,
  CATEGORY_NAME_INDEX,
  CATEGORY_SLUG_INDEX,
  nameKeyOf,
} from './article-category.entity';
import { CreateArticleCategoryDto } from './dto/create-article-category.dto';
import { UpdateArticleCategoryDto } from './dto/update-article-category.dto';

/** All content is Bulgarian for now (theindex-web docs/decision-record.md, D14). */
export const DEFAULT_LANGUAGE = 'bg';

/** Slug for a name that gives none (e.g. only emoji): "kategoria", "kategoria-2", ... */
const FALLBACK_SLUG = 'kategoria';

/**
 * Article categories for the back office (ADMIN). The public endpoints come with the articles
 * (backlog item 7): a category is only public once it has a published article.
 *
 * Slugs and names (ignoring case) are unique per language. The unique indexes decide both,
 * so two concurrent requests can't both win; a violation is answered with 409. A slug is fixed
 * while a published article uses the category, so its page doesn't move under readers.
 */
@Injectable()
export class ArticleCategoriesService {
  constructor(
    @InjectRepository(ArticleCategoryEntity)
    private readonly repo: Repository<ArticleCategoryEntity>,
  ) {}

  /** All categories in navigation order. */
  list() {
    return this.repo.find({
      where: { language: DEFAULT_LANGUAGE },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async get(id: string) {
    const category = await this.repo.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateArticleCategoryDto) {
    const language = DEFAULT_LANGUAGE;
    const slug =
      dto.slug ||
      uniqueSlug(slugify(dto.name), await this.slugsInUse(language), {
        fallback: FALLBACK_SLUG,
      });

    const saved = await this.saveOrConflict(
      this.repo.create({
        language,
        name: dto.name,
        nameKey: nameKeyOf(dto.name),
        slug,
        description: dto.description || null,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(language)),
      }),
    );
    return this.get(saved.id);
  }

  async update(id: string, dto: UpdateArticleCategoryDto) {
    const category = await this.get(id);

    if (dto.name !== undefined) {
      category.name = dto.name;
      category.nameKey = nameKeyOf(dto.name);
    }
    if (dto.slug !== undefined && dto.slug !== category.slug) {
      if (await this.usedByPublishedArticle(category.id)) {
        throw new ConflictException(
          "The slug can't change while published articles use this category",
        );
      }
      category.slug = dto.slug;
    }
    if (dto.description !== undefined) {
      category.description = dto.description || null;
    }
    if (dto.sortOrder !== undefined) {
      category.sortOrder = dto.sortOrder;
    }

    await this.saveOrConflict(category);
    return this.get(category.id);
  }

  /**
   * Deletes the category. Articles stay: their published links go with it (ON DELETE CASCADE),
   * and it is dropped from drafts' categoryIds, so the next publish doesn't fail over it.
   */
  async delete(id: string) {
    const category = await this.get(id);
    await this.repo.manager.transaction(async (m) => {
      await m.query(
        `UPDATE "articles"
            SET "draft" = jsonb_set("draft", '{categoryIds}', ("draft" -> 'categoryIds') - $1::text)
          WHERE "draft" -> 'categoryIds' @> jsonb_build_array($1::text)`,
        [category.id],
      );
      await m.delete(ArticleCategoryEntity, { id: category.id });
    });
    return { deleted: true };
  }

  private usedByPublishedArticle(categoryId: string): Promise<boolean> {
    return this.repo.manager
      .createQueryBuilder(ArticleCategoryLinkEntity, 'l')
      .innerJoin(ArticleEntity, 'a', 'a.id = l.articleId')
      .where('l.categoryId = :categoryId', { categoryId })
      .andWhere('a.status = :status', { status: ArticleStatus.PUBLISHED })
      .getExists();
  }

  /** Slugs in use for the language. There are only a handful of categories, so all of them. */
  private async slugsInUse(language: string): Promise<string[]> {
    const rows = await this.repo.find({
      select: { slug: true },
      where: { language },
    });
    return rows.map((r) => r.slug);
  }

  private async nextSortOrder(language: string): Promise<number> {
    const row = await this.repo
      .createQueryBuilder('c')
      .select('MAX(c.sortOrder)', 'max')
      .where('c.language = :language', { language })
      .getRawOne<{ max: number | null }>();
    return row?.max === null || row?.max === undefined
      ? 0
      : Number(row.max) + 1;
  }

  /** Saves, answering 409 when a unique index (slug or name) refuses the row. */
  private async saveOrConflict(category: ArticleCategoryEntity) {
    try {
      return await this.repo.save(category);
    } catch (error) {
      const index = violatedUniqueIndex(error);
      if (index === CATEGORY_SLUG_INDEX) {
        throw new ConflictException(
          `The slug "${category.slug}" is already in use`,
        );
      }
      if (index === CATEGORY_NAME_INDEX) {
        const existing = await this.repo.findOne({
          where: { language: category.language, nameKey: category.nameKey },
        });
        throw new ConflictException(
          `A category named "${existing?.name ?? category.name}" already exists`,
        );
      }
      throw error;
    }
  }
}
