import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountEntity } from './account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateProvisionedAccountDto } from './dto/create-provisioned-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Injectable()
export class AccountsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AccountEntity)
    private readonly repo: Repository<AccountEntity>,
  ) {}

  async findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  async findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async createInvited(dto: CreateAccountDto) {
    this.validateRoleLinks(dto);

    return this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getRepository(AccountEntity);
      const trainerRepo = manager.getRepository(TrainerProfileEntity);
      const traineeRepo = manager.getRepository(TraineeProfileEntity);

      // Validate linked profile exists (+ active)
      if (dto.role === AccountRole.TRAINER) {
        const trainer = await trainerRepo.findOne({
          where: { id: dto.trainerProfileId!, isActive: true },
        });
        if (!trainer) {
          throw new BadRequestException(
            'Trainer profile not found or inactive',
          );
        }
        // Optional: prevent multiple accounts for same profile
        if (trainer.accountId) {
          throw new BadRequestException('Trainer already has an account');
        }
      }

      if (dto.role === AccountRole.TRAINEE) {
        const trainee = await traineeRepo.findOne({
          where: { id: dto.traineeProfileId!, isActive: true },
        });
        if (!trainee) {
          throw new BadRequestException(
            'Trainee profile not found or inactive',
          );
        }
        if (trainee.accountId) {
          throw new BadRequestException('Trainee already has an account');
        }
      }

      const acc = accountRepo.create({
        email: dto.email ?? null,
        passwordHash: null,
        role: dto.role,
        status: AccountStatus.ACTIVE,
        trainerProfileId: dto.trainerProfileId ?? null,
        traineeProfileId: dto.traineeProfileId ?? null,
      });

      let saved: AccountEntity;
      try {
        saved = await accountRepo.save(acc);
      } catch {
        throw new BadRequestException(
          'Cannot create account (email may already exist)',
        );
      }

      // Mirror the link on the profile side (this is what you’re missing)
      if (saved.role === AccountRole.TRAINER && saved.trainerProfileId) {
        await trainerRepo.update(
          { id: saved.trainerProfileId },
          { accountId: saved.id },
        );
      }

      if (saved.role === AccountRole.TRAINEE && saved.traineeProfileId) {
        await traineeRepo.update(
          { id: saved.traineeProfileId },
          { accountId: saved.id },
        );
      }

      return saved;
    });
  }

  async update(accountId: string, dto: UpdateAccountDto) {
    const acc = await this.findById(accountId);
    if (!acc) throw new NotFoundException('Account not found');

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const existing = await this.repo.findOne({ where: { email } });
      if (existing && existing.id !== acc.id) {
        throw new BadRequestException(
          'Email is already used by another account',
        );
      }
      acc.email = email;
    }

    if (dto.password !== undefined || dto.confirmPassword !== undefined) {
      if (!dto.password || !dto.confirmPassword) {
        throw new BadRequestException(
          'Both password and confirmPassword are required to change password',
        );
      }

      if (dto.password !== dto.confirmPassword) {
        throw new BadRequestException('Passwords do not match');
      }

      acc.passwordHash = await bcrypt.hash(dto.password, 10);
      if (acc.status === AccountStatus.DISABLED) {
        acc.status = AccountStatus.ACTIVE;
      }
    }

    return this.repo.save(acc);
  }

  async setStatus(accountId: string, status: AccountStatus) {
    const acc = await this.findById(accountId);
    if (!acc) throw new NotFoundException('Account not found');

    acc.status = status;
    return this.repo.save(acc);
  }

  async delete(accountId: string) {
    return this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getRepository(AccountEntity);
      const trainerRepo = manager.getRepository(TrainerProfileEntity);
      const traineeRepo = manager.getRepository(TraineeProfileEntity);

      const acc = await accountRepo.findOne({ where: { id: accountId } });
      if (!acc) throw new NotFoundException('Account not found');

      if (acc.trainerProfileId) {
        await trainerRepo.update(
          { id: acc.trainerProfileId },
          { accountId: null },
        );
      }

      if (acc.traineeProfileId) {
        await traineeRepo.update(
          { id: acc.traineeProfileId },
          { accountId: null },
        );
      }

      acc.status = AccountStatus.DISABLED;
      acc.trainerProfileId = null;
      acc.traineeProfileId = null;

      return accountRepo.save(acc);
    });
  }

  sanitize(acc: AccountEntity) {
    return {
      id: acc.id,
      email: acc.email,
      role: acc.role,
      status: acc.status,
      trainerProfileId: acc.trainerProfileId,
      traineeProfileId: acc.traineeProfileId,
      createdAt: acc.createdAt,
      updatedAt: acc.updatedAt,
    };
  }

  async provisionForProfile(
    profileType: 'trainer' | 'trainee',
    profileId: string,
    dto: CreateProvisionedAccountDto,
  ) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    // Enforce role/profileType match
    if (profileType === 'trainer' && dto.role !== AccountRole.TRAINER) {
      throw new BadRequestException(
        'Trainer profile must be provisioned with TRAINER role',
      );
    }
    if (profileType === 'trainee' && dto.role !== AccountRole.TRAINEE) {
      throw new BadRequestException(
        'Trainee profile must be provisioned with TRAINEE role',
      );
    }

    if (dto.role === AccountRole.ADMIN) {
      throw new ForbiddenException(
        'This endpoint cannot create ADMIN accounts',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const accountRepo = manager.getRepository(AccountEntity);
      const trainerRepo = manager.getRepository(TrainerProfileEntity);
      const traineeRepo = manager.getRepository(TraineeProfileEntity);

      const email = dto.email.trim();
      const existing = await accountRepo.findOne({ where: { email } });
      if (existing) {
        throw new BadRequestException(
          'Email is already used by another account',
        );
      }

      // Validate profile exists + active + has no account yet
      if (profileType === 'trainer') {
        const trainer = await trainerRepo.findOne({
          where: { id: profileId, isActive: true },
        });
        if (!trainer)
          throw new NotFoundException('Trainer profile not found or inactive');
        if (trainer.accountId)
          throw new BadRequestException('Trainer already has an account');

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const acc = accountRepo.create({
          email,
          passwordHash,
          role: AccountRole.TRAINER,
          status: dto.status,
          trainerProfileId: trainer.id,
          traineeProfileId: null,
        });

        let saved: AccountEntity;
        try {
          saved = await accountRepo.save(acc);
        } catch {
          throw new BadRequestException(
            'Cannot create account (email may already exist)',
          );
        }

        await trainerRepo.update({ id: trainer.id }, { accountId: saved.id });

        return saved;
      }

      if (profileType === 'trainee') {
        const trainee = await traineeRepo.findOne({
          where: { id: profileId, isActive: true },
        });
        if (!trainee)
          throw new NotFoundException('Trainee profile not found or inactive');
        if (trainee.accountId)
          throw new BadRequestException('Trainee already has an account');

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const acc = accountRepo.create({
          email,
          passwordHash,
          role: AccountRole.TRAINEE,
          status: dto.status,
          traineeProfileId: trainee.id,
          trainerProfileId: null,
        });

        let saved: AccountEntity;
        try {
          saved = await accountRepo.save(acc);
        } catch {
          throw new BadRequestException(
            'Cannot create account (email may already exist)',
          );
        }

        await traineeRepo.update({ id: trainee.id }, { accountId: saved.id });

        return saved;
      }

      throw new BadRequestException('Invalid profile type');
    });
  }

  private validateRoleLinks(dto: {
    role: AccountRole;
    trainerProfileId?: string;
    traineeProfileId?: string;
  }) {
    const hasTrainer = !!dto.trainerProfileId;
    const hasTrainee = !!dto.traineeProfileId;

    if (dto.role === AccountRole.ADMIN) {
      if (hasTrainer || hasTrainee) {
        throw new BadRequestException(
          'ADMIN account must not be linked to trainer/trainee profile',
        );
      }
    }

    if (dto.role === AccountRole.TRAINER) {
      if (!hasTrainer || hasTrainee) {
        throw new BadRequestException(
          'TRAINER account must have trainerProfileId and must not have traineeProfileId',
        );
      }
    }

    if (dto.role === AccountRole.TRAINEE) {
      if (!hasTrainee || hasTrainer) {
        throw new BadRequestException(
          'TRAINEE account must have traineeProfileId and must not have trainerProfileId',
        );
      }
    }
  }
}
