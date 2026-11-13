import {
  ConflictException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import {
  normalizeEmail,
  normalizePhone,
  optionalText,
} from '../common/utils/contact.util';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { homeGymId } from '../gym-locations/home-gym.util';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { activeGymSubscriptionId } from '../gym-subscriptions/gym-subscription.util';
import { AccountEntity } from './account.entity';
import { AccountsService } from './accounts.service';
import { RegisterDto } from './dto/register.dto';

const EMAIL_TAKEN = 'Email is already used by another account';

/**
 * Self-registration (`/api/auth/register`, public): anyone creates an account, which can't log in
 * until an admin connects it to a trainee or trainer profile (`AccountAdminService.link`).
 */
@Injectable()
export class AccountRegistrationService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repo: Repository<AccountEntity>,
    private readonly accounts: AccountsService,
  ) {}

  /** The active gyms and gym subscriptions the form offers, by name. */
  async options() {
    const m = this.repo.manager;
    const [gyms, gymSubscriptions] = await Promise.all([
      m.find(GymLocationEntity, {
        where: { isActive: true },
        order: { name: 'ASC' },
      }),
      m.find(GymSubscriptionEntity, {
        where: { isActive: true },
        order: { name: 'ASC' },
      }),
    ]);
    return {
      gyms: gyms.map((g) => ({ id: g.id, name: g.name })),
      gymSubscriptions: gymSubscriptions.map((g) => ({
        id: g.id,
        name: g.name,
      })),
    };
  }

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const email = normalizeEmail(dto.email);
    const taken = await this.repo
      .createQueryBuilder('a')
      .where('LOWER(a.email) = :email', { email })
      .getExists();
    if (taken) throw new ConflictException(EMAIL_TAKEN);

    const m = this.repo.manager;
    const gymSubscriptionId =
      (await activeGymSubscriptionId(m, dto.gymSubscriptionId)) ?? null;
    const preferredGymId = (await homeGymId(m, dto.preferredGymId)) ?? null;

    const account = this.repo.create({
      email,
      passwordHash: await bcrypt.hash(dto.password, 10),
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      // They chose the password themselves: no forced change on first login.
      hasUpdatedInitialPassword: true,
      trainerProfileId: null,
      traineeProfileId: null,
      registration: {
        name: dto.name.trim(),
        phone: normalizePhone(dto.phone),
        gymSubscriptionId,
        preferredGymId,
        instagram: optionalText(dto.instagram) ?? null,
        facebook: optionalText(dto.facebook) ?? null,
        tiktok: optionalText(dto.tiktok) ?? null,
      },
      consentAt: new Date(),
    });

    try {
      return this.accounts.sanitize(await this.repo.save(account));
    } catch (error) {
      // Two registrations with the same email at once: the unique index decides.
      if (violatedUniqueIndex(error)) throw new ConflictException(EMAIL_TAKEN);
      throw error;
    }
  }
}
