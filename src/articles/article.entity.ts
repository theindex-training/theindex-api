import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { MediaEntity } from '../media/media.entity';
import type { ArticleContent } from './article-content';

export enum ArticleStatus {
  /** Never published. */
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  /** Was published, then taken down. */
  UNPUBLISHED = 'UNPUBLISHED',
}

/**
 * The working copy that autosave writes to (theindex-web docs/decision-record.md, section 5).
 * The published columns change only on Publish/Update, so half-written text never goes live.
 */
export interface ArticleDraft {
  title: string;
  excerpt: string | null;
  content: ArticleContent;
  featuredMediaId: string | null;
  categoryIds: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  /** A slug the admin chose; null means "from the title" at the first publish. */
  slug: string | null;
}

export const ARTICLE_SLUG_INDEX = 'UQ_articles_language_slug';

/** An article of the public site's journal. */
@Entity('articles')
@Index(ARTICLE_SLUG_INDEX, ['language', 'slug'], { unique: true })
export class ArticleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Bulgarian only for now; a translation will be its own article, linked by translationGroupId. */
  @Column({ type: 'varchar', length: 8, default: 'bg' })
  language!: string;

  @Column({ type: 'uuid', nullable: true })
  translationGroupId!: string | null;

  @Index()
  @Column({ type: 'enum', enum: ArticleStatus, default: ArticleStatus.DRAFT })
  status!: ArticleStatus;

  /**
   * Set at the first publish (from the title, or the slug the admin chose) and fixed after that,
   * so shared links never break. Null until then; Postgres lets the unique index hold many nulls.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  slug!: string | null;

  // ---- published version: empty until the first publish ----

  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  excerpt!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  content!: ArticleContent | null;

  /** Text of the published content: search, description fallback, digest emails. */
  @Column({ type: 'text', nullable: true })
  plainText!: string | null;

  @Column({ type: 'uuid', nullable: true })
  featuredMediaId!: string | null;

  @ManyToOne(() => MediaEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'featuredMediaId' })
  featuredMedia?: MediaEntity | null;

  @Column({ type: 'varchar', length: 70, nullable: true })
  seoTitle!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  seoDescription!: string | null;

  // ---- working copy ----

  @Column({ type: 'jsonb' })
  draft!: ArticleDraft;

  /** +1 on every draft save; a save based on an older revision is refused (two tabs). */
  @Column({ type: 'int', default: 0 })
  draftRevision!: number;

  @Column({ type: 'timestamptz' })
  draftUpdatedAt!: Date;

  /** The draft differs from the published version (always true before the first publish). */
  @Column({ type: 'boolean', default: true })
  hasUnpublishedChanges!: boolean;

  // ---- lifecycle ----

  @Column({ type: 'timestamptz', nullable: true })
  firstPublishedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastPublishedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  unpublishedAt!: Date | null;

  // Deleting an account never deletes articles: the link is only cleared.
  @Column({ type: 'uuid', nullable: true })
  createdByAccountId!: string | null;

  @ManyToOne(() => AccountEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByAccountId' })
  createdByAccount?: AccountEntity | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByAccountId!: string | null;

  @ManyToOne(() => AccountEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updatedByAccountId' })
  updatedByAccount?: AccountEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
