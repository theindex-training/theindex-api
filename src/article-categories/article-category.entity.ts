import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Unique index names, so a violation can be told apart (the service answers 409 for each). */
export const CATEGORY_SLUG_INDEX = 'UQ_article_categories_language_slug';
export const CATEGORY_NAME_INDEX = 'UQ_article_categories_language_name_key';

/** Names are unique per language ignoring case: the index compares this key. */
export function nameKeyOf(name: string): string {
  return name.toLowerCase();
}

/**
 * A category of articles on the public site, e.g. "Тренировки"
 * (theindex-web docs/decision-record.md, D12 and section 6). An article can be in several.
 * Its page is /articles/category/<slug>, so the slug is unique per language; so is the name,
 * ignoring case.
 */
@Entity('article_categories')
@Index(CATEGORY_SLUG_INDEX, ['language', 'slug'], { unique: true })
@Index(CATEGORY_NAME_INDEX, ['language', 'nameKey'], { unique: true })
export class ArticleCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Bulgarian only for now; other languages get their own categories later. */
  @Column({ type: 'varchar', length: 8, default: 'bg' })
  language!: string;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

  /** nameKeyOf(name). Internal: not selected, so it never appears in responses. */
  @Column({ type: 'varchar', length: 60, select: false })
  nameKey!: string;

  /** Latin, from the name by default (common/utils/slug.util.ts). */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  /** Intro on the category page and its meta description. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  description!: string | null;

  /** Order in the site's navigation, lowest first. */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
