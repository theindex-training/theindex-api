import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { slugify, uniqueSlug } from '../common/utils/slug.util';
import { ArticleCategoryEntity } from './article-category.entity';
import { CreateArticleCategoryDto } from './dto/create-article-category.dto';
import { UpdateArticleCategoryDto } from './dto/update-article-category.dto';

/** All content is Bulgarian for now (theindex-web docs/decision-record.md, D14). */
export const DEFAULT_LANGUAGE = 'bg';

/** Slug for a name that gives none (e.g. only emoji): "kategoria", "kategoria-2", ... */
const FALLBACK_SLUG = 'kategoria';

/** Postgres error code for a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Article categories for the back office (ADMIN). The public endpoints come with the articles
 * (backlog item 7): a category is only public once it has a published article.
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
    await this.assertNameFree(language, dto.name);

    // A chosen slug is checked by the unique index on (language, slug) when saving (409).
    let slug: string;
    if (dto.slug) {
      slug = dto.slug;
    } else {
      slug = uniqueSlug(slugify(dto.name), await this.slugsInUse(language), {
        fallback: FALLBACK_SLUG,
      });
    }

    return this.saveOrConflict(
      this.repo.create({
        language,
        name: dto.name,
        slug,
        description: dto.description || null,
        sortOrder: dto.sortOrder ?? (await this.nextSortOrder(language)),
      }),
    );
  }

  async update(id: string, dto: UpdateArticleCategoryDto) {
    const category = await this.get(id);

    if (dto.name !== undefined && dto.name !== category.name) {
      await this.assertNameFree(category.language, dto.name, category.id);
      category.name = dto.name;
    }
    if (dto.slug !== undefined) {
      category.slug = dto.slug;
    }
    if (dto.description !== undefined) {
      category.description = dto.description || null;
    }
    if (dto.sortOrder !== undefined) {
      category.sortOrder = dto.sortOrder;
    }

    return this.saveOrConflict(category);
  }

  async delete(id: string) {
    const category = await this.get(id);
    await this.repo.delete(category.id);
    return { deleted: true };
  }

  /** Names are unique per language, ignoring case. */
  private async assertNameFree(
    language: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.repo
      .createQueryBuilder('c')
      .where('c.language = :language', { language })
      .andWhere('lower(c.name) = lower(:name)', { name })
      .getOne();
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(
        `A category named "${clash.name}" already exists`,
      );
    }
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

  /** The unique index on (language, slug) decides slug clashes, including concurrent ones. */
  private async saveOrConflict(category: ArticleCategoryEntity) {
    try {
      return await this.repo.save(category);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(
          `The slug "${category.slug}" is already in use`,
        );
      }
      throw error;
    }
  }
}
