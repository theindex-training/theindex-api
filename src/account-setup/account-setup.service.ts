import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { EntityManager, Not, Raw, Repository } from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import {
  needsAccountSetup,
  needsPasswordChange,
} from '../accounts/account-setup';
import { AuthService } from '../auth/auth.service';
import {
  normalizeEmail,
  normalizePhone,
  socialLinksPatch,
} from '../common/utils/contact.util';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { homeGymId } from '../gym-locations/home-gym.util';
import { activeGymSubscriptionId } from '../gym-subscriptions/gym-subscription.util';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { CompleteAccountSetupDto } from './dto/complete-account-setup.dto';

const EMAIL_TAKEN = 'Email is already used by another account';

/**
 * What the first-login form starts from: the account's email and its profile's details as an
 * admin entered them. The nickname is staff-only and never part of it.
 */
export type AccountSetupView = {
  profileType: 'trainee' | 'trainer';
  /** Whether the account still has to go through the form. */
  setupRequired: boolean;
  /** Whether the form must ask for a new password (the admin's one is still in place). */
  passwordChangeRequired: boolean;
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
};

/**
 * The first-login setup of an account an admin created (and of older accounts that never gave
 * consent): the same details self-registration asks for, prefilled, and a new password while the
 * admin's one is still in place. Until it is done, `JwtAuthGuard` refuses everything else.
 */
@Injectable()
export class AccountSetupService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly accounts: Repository<AccountEntity>,
    private readonly auth: AuthService,
  ) {}

  async get(accountId: string): Promise<AccountSetupView> {
    const { account, trainee, trainer } = await this.load(
      this.accounts.manager,
      accountId,
    );
    return view(account, trainee, trainer);
  }

  /** Saves the form and answers like a login, with a token that no longer requires the setup. */
  async complete(accountId: string, dto: CompleteAccountSetupDto) {
    const account = await this.accounts.manager.transaction(async (m) => {
      const { account, trainee, trainer } = await this.load(m, accountId, true);
      if (!needsAccountSetup(account)) {
        throw new ConflictException('Your account is already set up');
      }

      await this.applyPassword(account, dto);
      await this.applyEmail(m, account, dto.email);

      const profile = trainee ?? trainer!;
      profile.name = dto.name.trim();
      profile.phone = normalizePhone(dto.phone);
      if (trainee) {
        if (dto.gymSubscriptionId !== trainee.gymSubscriptionId) {
          const id = await activeGymSubscriptionId(m, dto.gymSubscriptionId);
          if (id !== undefined) trainee.gymSubscriptionId = id;
        }
        if (dto.homeGymId !== trainee.preferredGymId) {
          const id = await homeGymId(m, dto.homeGymId);
          if (id !== undefined) trainee.preferredGymId = id;
        }
      } else {
        if (dto.gymSubscriptionId) {
          throw new BadRequestException('Trainers have no gym subscription');
        }
        if (dto.homeGymId !== trainer!.primaryGymId) {
          const id = await homeGymId(m, dto.homeGymId);
          if (id !== undefined) trainer!.primaryGymId = id;
        }
      }
      Object.assign(profile, socialLinksPatch(dto));

      account.consentAt = new Date();
      try {
        await m.save(account);
      } catch (error) {
        // Another account took the email meanwhile: the unique index decides.
        if (violatedUniqueIndex(error))
          throw new ConflictException(EMAIL_TAKEN);
        throw error;
      }
      await m.save(profile);
      return account;
    });
    return this.auth.login(account);
  }

  private async applyPassword(
    account: AccountEntity,
    dto: CompleteAccountSetupDto,
  ) {
    const sent =
      dto.password !== undefined || dto.confirmPassword !== undefined;
    if (!needsPasswordChange(account)) {
      if (sent) {
        throw new BadRequestException(
          'Your password has already been changed; use Change password to change it again',
        );
      }
      return;
    }
    if (!dto.password || !dto.confirmPassword) {
      throw new BadRequestException('Choose a new password');
    }
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }
    if (
      account.passwordHash &&
      (await bcrypt.compare(dto.password, account.passwordHash))
    ) {
      throw new BadRequestException(
        'Choose a password different from the one you were given',
      );
    }
    account.passwordHash = await bcrypt.hash(dto.password, 10);
    account.hasUpdatedInitialPassword = true;
  }

  /** Stored trimmed and lowercased, as self-registration does; any other account having it is 409. */
  private async applyEmail(
    m: EntityManager,
    account: AccountEntity,
    sent: string,
  ) {
    const email = normalizeEmail(sent);
    const taken = await m.exists(AccountEntity, {
      where: {
        id: Not(account.id),
        email: Raw((column) => `LOWER(${column}) = :email`, { email }),
      },
    });
    if (taken) throw new ConflictException(EMAIL_TAKEN);
    account.email = email;
  }

  private async load(m: EntityManager, accountId: string, lock = false) {
    const lockOpt = lock
      ? { lock: { mode: 'pessimistic_write' as const } }
      : {};
    const account = await m.findOne(AccountEntity, {
      where: { id: accountId },
      ...lockOpt,
    });
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
): AccountSetupView {
  const profile = (trainee ?? trainer)!;
  return {
    profileType: trainee ? 'trainee' : 'trainer',
    setupRequired: needsAccountSetup(account),
    passwordChangeRequired: needsPasswordChange(account),
    email: account.email,
    name: profile.name,
    phone: profile.phone,
    gymSubscriptionId: trainee ? trainee.gymSubscriptionId : null,
    homeGymId: trainee ? trainee.preferredGymId : trainer!.primaryGymId,
    instagram: profile.instagram,
    facebook: profile.facebook,
    tiktok: profile.tiktok,
  };
}
