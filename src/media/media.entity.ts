import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { MediaKind } from './media-kind';

/** One stored file of a media item: its path inside the storage and its size in pixels. */
export interface MediaFile {
  path: string;
  width: number;
  height: number;
}

/**
 * An uploaded file: an article image, a workout's lesson-plan PDF, and later other kinds (see
 * media-kind.ts). The files themselves are in the media storage, in the kind's area and folder
 * (`<folder>/<id>/`; images uploaded before kinds existed are directly under `<id>/`); this row
 * records what the item is, where its files are and how big they are.
 *
 * Columns marked "images only" are null for other kinds. Captions are not stored here: they
 * belong to the article's image block.
 */
@Entity('media')
@Index(['kind', 'sha256'])
export class MediaEntity {
  // Set by the service before the files are written, so the folder name is the row's id.
  @PrimaryColumn('uuid')
  id!: string;

  // The default only fills rows from before kinds existed (all article images); the service
  // always sets the kind.
  @Column({ type: 'enum', enum: MediaKind, default: MediaKind.ARTICLE_IMAGE })
  kind!: MediaKind;

  /**
   * The main file, relative to the kind's storage area: an image's master (upright, metadata
   * removed, at most 4096 px on its longer side), or a document as it was uploaded.
   */
  @Column({ type: 'varchar', length: 255 })
  masterPath!: string;

  /** Images only: describes the image for screen readers and search engines. */
  @Column({ type: 'varchar', length: 250, nullable: true })
  altText!: string | null;

  /** Images only. */
  @Column({ type: 'int', nullable: true })
  width!: number | null;

  /** Images only. */
  @Column({ type: 'int', nullable: true })
  height!: number | null;

  /** Images only: WebP versions for `srcset`, narrowest first. */
  @Column({ type: 'jsonb', nullable: true })
  variants!: MediaFile[] | null;

  /** Images only: 1200×630 JPEG crop for social previews (used for a featured image). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  ogPath!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalFilename!: string | null;

  /** Size of the uploaded file, in bytes. */
  @Column({ type: 'int' })
  sizeBytes!: number;

  /**
   * Documents only: SHA-256 of the file (hex), so uploading the same document again reuses the
   * stored one instead of keeping a copy per upload.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256!: string | null;

  // Kept when the account goes: deleting an account never deletes media (or articles).
  @Column({ type: 'uuid', nullable: true })
  uploadedByAccountId!: string | null;

  @ManyToOne(() => AccountEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploadedByAccountId' })
  uploadedByAccount?: AccountEntity | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
