import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  MediaService,
  PrivateImage,
  UploadedMediaFile,
} from '../media/media.service';
import { PhotoCrop } from '../media/profile-photo-processing';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { ProfilePhotoEntity } from './profile-photo.entity';

/** Whose photo: a trainee's or a trainer's profile (exactly one of the two). */
export type PhotoOwner =
  | { traineeProfileId: string; trainerProfileId?: null }
  | { traineeProfileId?: null; trainerProfileId: string };

/** A profile photo as its owner gets it. */
export interface ProfilePhoto {
  /** 512 × 512 px. */
  url: string;
  /** 128 × 128 px. */
  thumbnailUrl: string;
  /** The square chosen on the original (fractions after turning it by `rotation`). */
  crop: PhotoCrop;
  updatedAt: Date;
}

/** The thumbnails of people's photos, by profile id. */
export interface PhotoThumbnails {
  trainee: Map<string, string>;
  trainer: Map<string, string>;
}

export const NO_PHOTO_MESSAGE = 'You have no profile photo';

/**
 * Trainees' and trainers' profile photos. The picture is kept privately and cropped on the server
 * (MediaService); this keeps which crop is a profile's photo. Files are written before the row
 * changes and the replaced ones removed after it, so a profile never points at missing files;
 * the row is changed under a lock on the profile, so two changes at once can't both win.
 */
@Injectable()
export class ProfilePhotosService {
  constructor(
    @InjectRepository(ProfilePhotoEntity)
    private readonly repo: Repository<ProfilePhotoEntity>,
    private readonly media: MediaService,
  ) {}

  /** The profile's photo, or null. */
  async get(owner: PhotoOwner): Promise<ProfilePhoto | null> {
    const row = await this.repo.findOne({ where: whereOwner(owner) });
    return row ? this.present(row) : null;
  }

  /** Sets the profile's photo from a new picture and the square chosen on it. */
  async replace(
    owner: PhotoOwner,
    file: UploadedMediaFile | undefined,
    crop: PhotoCrop,
    accountId: string,
  ): Promise<ProfilePhoto> {
    const original = await this.media.storeProfilePhotoOriginal(
      file,
      accountId,
    );
    const photo = await this.media
      .createProfilePhoto(original.id, crop, accountId)
      .catch(async (error: unknown) => {
        await this.media.removeItems([original.id]);
        throw error;
      });
    const { saved, replaced } = await this.repo.manager
      .transaction(async (m) => {
        await lockProfile(m, owner);
        const current = await m.findOne(ProfilePhotoEntity, {
          where: whereOwner(owner),
        });
        const row = await m.save(
          m.create(ProfilePhotoEntity, {
            ...(current ? { id: current.id } : {}),
            ...ownerColumns(owner),
            originalMediaId: original.id,
            photoMediaId: photo.id,
            crop: cropOf(crop),
          }),
        );
        return { saved: row, replaced: current };
      })
      .catch(async (error: unknown) => {
        await this.media.removeItems([original.id, photo.id]);
        throw error;
      });
    if (replaced) {
      await this.media.removeItems([
        replaced.photoMediaId,
        replaced.originalMediaId,
      ]);
    }
    return this.present(saved);
  }

  /**
   * Crops the profile's picture again. 404 without a photo; 409 when the picture was replaced or
   * removed meanwhile (the crop was chosen on the other one).
   */
  async recrop(
    owner: PhotoOwner,
    crop: PhotoCrop,
    accountId: string,
  ): Promise<ProfilePhoto> {
    const current = await this.repo.findOne({ where: whereOwner(owner) });
    if (!current) throw new NotFoundException(NO_PHOTO_MESSAGE);
    const photo = await this.media.createProfilePhoto(
      current.originalMediaId,
      crop,
      accountId,
    );
    let previousPhotoId: string;
    const saved = await this.repo.manager
      .transaction(async (m) => {
        await lockProfile(m, owner);
        const row = await m.findOne(ProfilePhotoEntity, {
          where: whereOwner(owner),
        });
        if (!row || row.originalMediaId !== current.originalMediaId) {
          throw new ConflictException(
            'Your profile photo was changed meanwhile. Reload it and try again.',
          );
        }
        previousPhotoId = row.photoMediaId;
        row.photoMediaId = photo.id;
        row.crop = cropOf(crop);
        return m.save(row);
      })
      .catch(async (error: unknown) => {
        await this.media.removeItems([photo.id]);
        throw error;
      });
    await this.media.removeItems([previousPhotoId!]);
    return this.present(saved);
  }

  /** Removes the profile's photo and its files. 404 without one. */
  async remove(owner: PhotoOwner): Promise<void> {
    const row = await this.repo.manager.transaction(async (m) => {
      await lockProfile(m, owner);
      const found = await m.findOne(ProfilePhotoEntity, {
        where: whereOwner(owner),
      });
      if (!found) throw new NotFoundException(NO_PHOTO_MESSAGE);
      await m.delete(ProfilePhotoEntity, { id: found.id });
      return found;
    });
    await this.media.removeItems([row.photoMediaId, row.originalMediaId]);
  }

  /** The picture the profile's photo was cropped from, for its owner to crop it again. */
  async openOriginal(owner: PhotoOwner): Promise<PrivateImage> {
    const row = await this.repo.findOne({ where: whereOwner(owner) });
    if (!row) throw new NotFoundException(NO_PHOTO_MESSAGE);
    return this.media.openProfilePhotoOriginal(row.originalMediaId);
  }

  /**
   * Runs `deleteProfile` (which deletes the profile, and with it the photo's row), then removes
   * the photo's files, so a deleted person's pictures don't stay behind.
   */
  async deleteWithProfile<T>(
    owner: PhotoOwner,
    deleteProfile: () => Promise<T>,
  ): Promise<T> {
    const row = await this.repo.findOne({ where: whereOwner(owner) });
    const result = await deleteProfile();
    if (row) {
      await this.media.removeItems([row.photoMediaId, row.originalMediaId]);
    }
    return result;
  }

  /** The thumbnail URLs of the given profiles' photos (profiles without one are left out). */
  async thumbnails(owners: {
    traineeProfileIds: string[];
    trainerProfileIds: string[];
  }): Promise<PhotoThumbnails> {
    const result: PhotoThumbnails = { trainee: new Map(), trainer: new Map() };
    const trainees = [...new Set(owners.traineeProfileIds)];
    const trainers = [...new Set(owners.trainerProfileIds)];
    const where = [
      ...(trainees.length ? [{ traineeProfileId: In(trainees) }] : []),
      ...(trainers.length ? [{ trainerProfileId: In(trainers) }] : []),
    ];
    if (!where.length) return result;
    const rows = await this.repo.find({ where });
    if (!rows.length) return result;
    const urls = await this.media.profilePhotoUrls(
      rows.map((r) => r.photoMediaId),
    );
    for (const row of rows) {
      const url = urls.get(row.photoMediaId)?.thumbnailUrl;
      if (!url) continue;
      if (row.traineeProfileId) result.trainee.set(row.traineeProfileId, url);
      else if (row.trainerProfileId) {
        result.trainer.set(row.trainerProfileId, url);
      }
    }
    return result;
  }

  private async present(row: ProfilePhotoEntity): Promise<ProfilePhoto> {
    const urls = (await this.media.profilePhotoUrls([row.photoMediaId])).get(
      row.photoMediaId,
    );
    if (!urls) throw new NotFoundException(NO_PHOTO_MESSAGE);
    return { ...urls, crop: cropOf(row.crop), updatedAt: row.updatedAt };
  }
}

function whereOwner(owner: PhotoOwner) {
  return owner.traineeProfileId
    ? { traineeProfileId: owner.traineeProfileId }
    : { trainerProfileId: owner.trainerProfileId! };
}

function ownerColumns(owner: PhotoOwner) {
  return {
    traineeProfileId: owner.traineeProfileId ?? null,
    trainerProfileId: owner.traineeProfileId
      ? null
      : (owner.trainerProfileId ?? null),
  };
}

/** Only the crop's own fields, whatever the DTO instance carries. */
function cropOf(crop: PhotoCrop): PhotoCrop {
  return {
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    rotation: crop.rotation,
  };
}

/** Locks the owner's profile row: photo changes of one profile happen one at a time. */
async function lockProfile(m: EntityManager, owner: PhotoOwner) {
  const found = owner.traineeProfileId
    ? await m.findOne(TraineeProfileEntity, {
        where: { id: owner.traineeProfileId },
        lock: { mode: 'pessimistic_write' },
      })
    : await m.findOne(TrainerProfileEntity, {
        where: { id: owner.trainerProfileId! },
        lock: { mode: 'pessimistic_write' },
      });
  if (!found) throw new NotFoundException('Profile not found');
}
