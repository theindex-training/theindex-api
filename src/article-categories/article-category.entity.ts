import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A category of articles on the public site, e.g. "Тренировки"
 * (theindex-web docs/decision-record.md, D12 and section 6). An article can be in several.
 * Its page is /articles/category/<slug>, so the slug is unique per language.
 */
@Entity('article_categories')
@Index(['language', 'slug'], { unique: true })
export class ArticleCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Bulgarian only for now; other languages get their own categories later. */
  @Column({ type: 'varchar', length: 8, default: 'bg' })
  language!: string;

  @Column({ type: 'varchar', length: 60 })
  name!: string;

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
