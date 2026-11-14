import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AccountRole } from '../common/enums/account-role.enum';
import {
  normalizePhone,
  optionalText,
  socialLinksPatch,
} from '../common/utils/contact.util';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { containsPattern } from '../common/utils/like.util';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { homeGymId } from '../gym-locations/home-gym.util';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { activeGymSubscriptionId } from '../gym-subscriptions/gym-subscription.util';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountEntity } from './account.entity';
import {
  AccountLinkFilter,
  AccountView,
  accountView,
  isLinked,
  Named,
  registrationRefs,
} from './account-view';
import { LinkAccountDto } from './dto/link-account.dto';
import { ListAccountsQueryDto } from './dto/list-accounts.query.dto';

/**
 * The admin's Accounts page: the accounts (self-registered ones waiting to be connected first),
 * connecting an account to a trainee or trainer profile, and deleting an account that was never
 * connected.
 */
@Injectable()
export class AccountAdminService {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repo: Repository<AccountEntity>,
  ) {}

  async list(query: ListAccountsQueryDto): Promise<AccountView[]> {
    const link: AccountLinkFilter = query.link ?? 'unlinked';
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.traineeProfile', 'tp')
      .leftJoinAndSelect('a.trainerProfile', 'trp')
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'ASC');

    if (link === 'unlinked') {
      qb.where('a.traineeProfileId IS NULL')
        .andWhere('a.trainerProfileId IS NULL')
        .andWhere('a.role != :admin', { admin: AccountRole.ADMIN });
    } else if (link === 'linked') {
      qb.where(
        '(a.traineeProfileId IS NOT NULL OR a.trainerProfileId IS NOT NULL)',
      );
    }

    const term = query.search?.trim();
    if (term) {
      qb.andWhere(
        `(a.email ILIKE :q ESCAPE '\\'
          OR a.registration->>'name' ILIKE :q ESCAPE '\\'
          OR a.registration->>'phone' ILIKE :q ESCAPE '\\'
          OR tp.name ILIKE :q ESCAPE '\\'
          OR trp.name ILIKE :q ESCAPE '\\')`,
        { q: containsPattern(term) },
      );
    }

    return this.views(await qb.getMany());
  }

  async details(id: string): Promise<AccountView> {
    const [view] = await this.views([await this.load(this.repo.manager, id)]);
    return view;
  }

  /**
   * Connects the account to a profile: an existing active one without an account, or a new one.
   * The profile stores the fields the admin sent, and the account takes the profile's role.
   */
  async link(id: string, dto: LinkAccountDto): Promise<AccountView> {
    if (dto.profileType === 'trainer' && dto.gymSubscriptionId) {
      throw new BadRequestException('Trainers have no gym subscription');
    }

    try {
      await this.repo.manager.transaction(async (m) => {
        const acc = await m.findOne(AccountEntity, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!acc) throw new NotFoundException('Account not found');
        if (acc.role === AccountRole.ADMIN) {
          throw new BadRequestException(
            'Admin accounts cannot be connected to a profile',
          );
        }
        if (isLinked(acc)) {
          throw new ConflictException(
            'Account is already connected to a profile',
          );
        }

        if (dto.profileType === 'trainee') {
          const trainee = await this.traineeToLink(m, dto, acc.id);
          acc.role = AccountRole.TRAINEE;
          acc.traineeProfileId = trainee.id;
        } else {
          const trainer = await this.trainerToLink(m, dto, acc.id);
          acc.role = AccountRole.TRAINER;
          acc.trainerProfileId = trainer.id;
        }
        await m.save(acc);
      });
    } catch (error) {
      // A concurrent link of the same profile: the unique indexes decide.
      if (violatedUniqueIndex(error)) {
        throw new ConflictException(
          `This ${dto.profileType} already has an account`,
        );
      }
      throw error;
    }

    return this.details(id);
  }

  /** Deletes an account for good; only one that was never connected (or was disconnected). */
  async deletePermanently(id: string) {
    return this.repo.manager.transaction(async (m) => {
      const acc = await m.findOne(AccountEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException('Account not found');
      if (acc.role === AccountRole.ADMIN) {
        throw new ConflictException('Admin accounts cannot be deleted');
      }
      const profileSideLinks =
        (await m.count(TraineeProfileEntity, { where: { accountId: id } })) +
        (await m.count(TrainerProfileEntity, { where: { accountId: id } }));
      if (isLinked(acc) || profileSideLinks > 0) {
        throw new ConflictException(
          'Only an account that is not connected to a profile can be deleted permanently',
        );
      }
      await m.delete(AccountEntity, { id });
      return { id, deleted: true };
    });
  }

  private async load(m: EntityManager, id: string) {
    const acc = await m.findOne(AccountEntity, {
      where: { id },
      relations: { traineeProfile: true, trainerProfile: true },
    });
    if (!acc) throw new NotFoundException('Account not found');
    return acc;
  }

  private async views(accounts: AccountEntity[]): Promise<AccountView[]> {
    const refs = registrationRefs(accounts);
    const m = this.repo.manager;
    const [gymSubscriptions, gyms] = await Promise.all([
      refs.gymSubscriptionIds.length
        ? m.find(GymSubscriptionEntity, {
            where: { id: In(refs.gymSubscriptionIds) },
          })
        : [],
      refs.gymIds.length
        ? m.find(GymLocationEntity, { where: { id: In(refs.gymIds) } })
        : [],
    ]);
    const byId = (rows: Named[]) =>
      new Map(rows.map((r) => [r.id, { id: r.id, name: r.name }]));
    const lookups = {
      gymSubscriptions: byId(gymSubscriptions),
      gyms: byId(gyms),
    };
    return accounts.map((acc) => accountView(acc, lookups));
  }

  private async traineeToLink(
    m: EntityManager,
    dto: LinkAccountDto,
    accountId: string,
  ) {
    let trainee: TraineeProfileEntity;
    if (dto.profileId) {
      const found = await m.findOne(TraineeProfileEntity, {
        where: { id: dto.profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!found) throw new NotFoundException('Trainee not found');
      if (!found.isActive) {
        throw new BadRequestException('Trainee profile is inactive');
      }
      if (found.accountId) {
        throw new ConflictException('This trainee already has an account');
      }
      trainee = found;
    } else {
      trainee = m.create(TraineeProfileEntity, {
        nickname: null,
        phone: null,
        gymSubscriptionId: null,
        preferredGymId: null,
        instagram: null,
        facebook: null,
        tiktok: null,
        isActive: true,
      });
    }

    trainee.name = dto.name.trim();
    const nickname = optionalText(dto.nickname);
    if (nickname !== undefined) trainee.nickname = nickname;
    if (dto.phone !== undefined) {
      trainee.phone = dto.phone === null ? null : normalizePhone(dto.phone);
    }
    const gymSubscriptionId = await activeGymSubscriptionId(
      m,
      dto.gymSubscriptionId,
    );
    if (gymSubscriptionId !== undefined) {
      trainee.gymSubscriptionId = gymSubscriptionId;
    }
    const preferredGymId = await homeGymId(m, dto.homeGymId);
    if (preferredGymId !== undefined) trainee.preferredGymId = preferredGymId;
    Object.assign(trainee, socialLinksPatch(dto));
    trainee.accountId = accountId;

    return m.save(trainee);
  }

  private async trainerToLink(
    m: EntityManager,
    dto: LinkAccountDto,
    accountId: string,
  ) {
    let trainer: TrainerProfileEntity;
    if (dto.profileId) {
      const found = await m.findOne(TrainerProfileEntity, {
        where: { id: dto.profileId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!found) throw new NotFoundException('Trainer not found');
      if (!found.isActive) {
        throw new BadRequestException('Trainer profile is inactive');
      }
      if (found.accountId) {
        throw new ConflictException('This trainer already has an account');
      }
      trainer = found;
    } else {
      trainer = m.create(TrainerProfileEntity, {
        nickname: null,
        phone: null,
        primaryGymId: null,
        instagram: null,
        facebook: null,
        tiktok: null,
        isActive: true,
      });
    }

    trainer.name = dto.name.trim();
    const nickname = optionalText(dto.nickname);
    if (nickname !== undefined) trainer.nickname = nickname;
    if (dto.phone !== undefined) {
      trainer.phone = dto.phone === null ? null : normalizePhone(dto.phone);
    }
    const primaryGymId = await homeGymId(m, dto.homeGymId);
    if (primaryGymId !== undefined) trainer.primaryGymId = primaryGymId;
    Object.assign(trainer, socialLinksPatch(dto));
    trainer.accountId = accountId;

    return m.save(trainer);
  }
}
