import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaEntity } from '../media/media.entity';
import type { PhotoCrop } from '../media/profile-photo-processing';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';

/**
 * A trainee's or trainer's profile photo (exactly one of the two profiles; at most one photo
 * each): the private picture it was cropped from, the public square crops, and the crop, so the
 * owner can change it. The media rows and files are replaced, never changed, so each crop has
 * new URLs.
 */
@Entity('profile_photos')
@Check(`("traineeProfileId" IS NULL) <> ("trainerProfileId" IS NULL)`)
export class ProfilePhotoEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  traineeProfileId!: string | null;

  @ManyToOne(() => TraineeProfileEntity, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'traineeProfileId' })
  traineeProfile?: TraineeProfileEntity | null;

  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  trainerProfileId!: string | null;

  @ManyToOne(() => TrainerProfileEntity, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'trainerProfileId' })
  trainerProfile?: TrainerProfileEntity | null;

  /** The private PROFILE_PHOTO_ORIGINAL. */
  @Column({ type: 'uuid' })
  originalMediaId!: string;

  @ManyToOne(() => MediaEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'originalMediaId' })
  originalMedia?: MediaEntity;

  /** The public PROFILE_PHOTO (the square crops). */
  @Column({ type: 'uuid' })
  photoMediaId!: string;

  @ManyToOne(() => MediaEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'photoMediaId' })
  photoMedia?: MediaEntity;

  /** The square chosen on the original (profile-photo-processing.ts). */
  @Column({ type: 'jsonb' })
  crop!: PhotoCrop;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
