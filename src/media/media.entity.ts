import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';

/** One stored file of a media item: its path inside the storage and its size in pixels. */
export interface MediaFile {
  path: string;
  width: number;
  height: number;
}

/**
 * An uploaded image (theindex-web docs/decision-record.md, section 6). The files themselves are
 * in the media storage under `<id>/`; this row records where and how big they are.
 * Captions are not stored here: they belong to the article's image block.
 */
@Entity('media')
export class MediaEntity {
  // Set by the service before the files are written, so the folder name is the row's id.
  @PrimaryColumn('uuid')
  id!: string;

  /** Describes the image for screen readers and search engines. Required. */
  @Column({ type: 'varchar', length: 250 })
  altText!: string;

  /** The master: upright, metadata removed, at most 4096 px on its longer side. */
  @Column({ type: 'varchar', length: 255 })
  masterPath!: string;

  @Column({ type: 'int' })
  width!: number;

  @Column({ type: 'int' })
  height!: number;

  /** WebP versions for `srcset`, narrowest first. */
  @Column({ type: 'jsonb' })
  variants!: MediaFile[];

  /** 1200×630 JPEG crop for social previews (used when the image is a featured image). */
  @Column({ type: 'varchar', length: 255 })
  ogPath!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalFilename!: string | null;

  /** Size of the uploaded file, in bytes. */
  @Column({ type: 'int' })
  sizeBytes!: number;

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
