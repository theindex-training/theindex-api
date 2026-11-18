import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { normalizePhone, socialLinksPatch } from '../common/utils/contact.util';
import { homeGymId } from '../gym-locations/home-gym.util';
import { activeGymSubscriptionId } from '../gym-subscriptions/gym-subscription.util';
import {
  PhotoOwner,
  ProfilePhoto,
  ProfilePhotosService,
} from '../profile-photos/profile-photos.service';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

/**
 * A trainee's or trainer's own details ("My details"): what they could enter when they
 * registered. Read from the account in the database, not the token, so a profile connected or
 * changed since the login is the one used. The nickname is staff-only and never part of it.
 */
export type MyProfile = {
  profileType: 'trainee' | 'trainer';
  email: string | null;
  name: string;
  phone: string | null;
  /** Always null for trainers. */
  gymSubscriptionId: string | null;
  /** A trainee's preferred gym or a trainer's primary gym. */
  homeGymId: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  /** When they agreed to the use of their personal data and to emails; null if never asked. */
  consentAt: Date | null;
  /** Their profile photo (`/api/my-profile/photo`), or null. */
  photo: ProfilePhoto | null;
};

@Injectable()
export class MyProfileService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly accounts: Repository<AccountEntity>,
    private readonly photos: ProfilePhotosService,
  ) {}

  async get(accountId: string): Promise<MyProfile> {
    const m = this.accounts.manager;
    const { account, trainee, trainer } = await this.load(m, accountId);
    return this.withPhoto(view(account, trainee, trainer), trainee, trainer);
  }

  /** The profile connected to the account, whose photo `/my-profile/photo` changes (403 if none). */
  async photoOwner(accountId: string): Promise<PhotoOwner> {
    const { trainee, trainer } = await this.load(
      this.accounts.manager,
      accountId,
    );
    return trainee
      ? { traineeProfileId: trainee.id }
      : { trainerProfileId: trainer!.id };
  }

  async update(accountId: string, dto: UpdateMyProfileDto): Promise<MyProfile> {
    const updated = await this.accounts.manager.transaction(async (m) => {
      const { account, trainee, trainer } = await this.load(m, accountId, true);
      const profile = trainee ?? trainer!;

      if (dto.phone !== undefined) profile.phone = normalizePhone(dto.phone);

      if (trainee) {
        const gymSubscriptionId = await activeGymSubscriptionId(
          m,
          dto.gymSubscriptionId,
        );
        if (gymSubscriptionId !== undefined) {
          trainee.gymSubscriptionId = gymSubscriptionId;
        }
        const preferredGymId = await homeGymId(m, dto.homeGymId);
        if (preferredGymId !== undefined) {
          trainee.preferredGymId = preferredGymId;
        }
      } else {
        if (dto.gymSubscriptionId) {
          throw new BadRequestException('Trainers have no gym subscription');
        }
        const primaryGymId = await homeGymId(m, dto.homeGymId);
        if (primaryGymId !== undefined) trainer!.primaryGymId = primaryGymId;
      }

      Object.assign(profile, socialLinksPatch(dto));
      await m.save(profile);
      return { profile: view(account, trainee, trainer), trainee, trainer };
    });
    return this.withPhoto(updated.profile, updated.trainee, updated.trainer);
  }

  private async withPhoto(
    profile: Omit<MyProfile, 'photo'>,
    trainee: TraineeProfileEntity | null,
    trainer: TrainerProfileEntity | null,
  ): Promise<MyProfile> {
    const photo = await this.photos.get(
      trainee
        ? { traineeProfileId: trainee.id }
        : { trainerProfileId: trainer!.id },
    );
    return { ...profile, photo };
  }

  private async load(m: EntityManager, accountId: string, lock = false) {
    const account = await m.findOne(AccountEntity, {
      where: { id: accountId },
    });
    const lockOpt = lock
      ? { lock: { mode: 'pessimistic_write' as const } }
      : {};
    const trainee = account?.traineeProfileId
      ? await m.findOne(TraineeProfileEntity, {
          where: { id: account.traineeProfileId },
          ...lockOpt,
        })
      : null;
    const trainer =
      !trainee && account?.trainerProfileId
        ? await m.findOne(TrainerProfileEntity, {
            where: { id: account.trainerProfileId },
            ...lockOpt,
          })
        : null;
    if (!account || (!trainee && !trainer)) {
      throw new ForbiddenException(
        'Your account is not connected to a profile',
      );
    }
    return { account, trainee, trainer };
  }
}

function view(
  account: AccountEntity,
  trainee: TraineeProfileEntity | null,
  trainer: TrainerProfileEntity | null,
): Omit<MyProfile, 'photo'> {
  const profile = (trainee ?? trainer)!;
  return {
    profileType: trainee ? 'trainee' : 'trainer',
    email: account.email,
    name: profile.name,
    phone: profile.phone,
    gymSubscriptionId: trainee ? trainee.gymSubscriptionId : null,
    homeGymId: trainee ? trainee.preferredGymId : trainer!.primaryGymId,
    instagram: profile.instagram,
    facebook: profile.facebook,
    tiktok: profile.tiktok,
    consentAt: account.consentAt,
  };
}
