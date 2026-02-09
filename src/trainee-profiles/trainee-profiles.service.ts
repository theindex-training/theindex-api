import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import { TraineeProfileEntity } from './trainee-profile.entity';

@Injectable()
export class TraineeProfilesService {
  constructor(
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
  ) {}

  async list(params: { search?: string; active?: boolean }) {
    const { search, active } = params;

    const where: any[] = [];
    const activeFilter = active === undefined ? {} : { isActive: active };

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.push({ firstName: ILike(`%${q}%`), ...activeFilter });
      where.push({ lastName: ILike(`%${q}%`), ...activeFilter });
      where.push({ phone: ILike(`%${q}%`), ...activeFilter });
    } else {
      where.push({ ...activeFilter });
    }

    // If where has multiple items, TypeORM treats it as OR.
    return this.traineeRepo.find({
      where,
      order: { name: 'ASC', nickname: 'ASC' },
    });
  }

  async getById(id: string) {
    const trainee = await this.traineeRepo.findOne({ where: { id } });
    if (!trainee) throw new NotFoundException('Trainee not found');
    return trainee;
  }

  async create(dto: CreateTraineeDto) {
    if (dto.accountId) {
      const existing = await this.traineeRepo.findOne({
        where: { accountId: dto.accountId },
      });
      if (existing)
        throw new BadRequestException(
          'This account is already linked to another trainee',
        );
    }

    const trainee = this.traineeRepo.create({
      name: dto.name.trim(),
      nickname: dto.nickname?.trim() ?? null,
      phone: dto.phone?.trim() ?? null,
      accountId: dto.accountId ?? null,
      isActive: dto.isActive ?? true,
    });

    return this.traineeRepo.save(trainee);
  }

  async update(id: string, dto: UpdateTraineeDto) {
    const trainee = await this.getById(id);

    if (dto.name !== undefined) trainee.name = dto.name.trim();
    if (dto.nickname !== undefined) trainee.nickname = dto.nickname.trim();

    if (dto.phone !== undefined) {
      trainee.phone = dto.phone === null ? null : dto.phone.trim();
    }

    if (dto.isActive !== undefined) trainee.isActive = dto.isActive;

    if (dto.accountId !== undefined) {
      const nextAccountId = dto.accountId === null ? null : dto.accountId;

      if (nextAccountId) {
        const existing = await this.traineeRepo.findOne({
          where: { accountId: nextAccountId },
        });
        if (existing && existing.id !== trainee.id) {
          throw new BadRequestException(
            'This account is already linked to another trainee',
          );
        }
      }

      trainee.accountId = nextAccountId;
    }

    return this.traineeRepo.save(trainee);
  }

  async deactivate(id: string) {
    const trainee = await this.getById(id);
    trainee.isActive = false;
    return this.traineeRepo.save(trainee);
  }

  async hardDelete(id: string) {
    const trainee = await this.getById(id);
    await this.traineeRepo.remove(trainee);
    return { deleted: true };
  }

  async overview(id: string) {
    const trainee = await this.getById(id);

    const now = new Date();

    // Active subscriptions:
    // - PUNCH: ACTIVE + remainingCredits > 0
    // - TIME : ACTIVE + endsAt > now
    const activeSubscriptions = await this.subRepo
      .createQueryBuilder('s')
      .where('s.traineeId = :id', { id })
      .andWhere('s.status = :status', { status: SubscriptionStatus.ACTIVE })
      .andWhere(
        `(
        (s.type = :punch AND s.remainingCredits IS NOT NULL AND s.remainingCredits > 0)
        OR
        (s.type = :time AND s.endsAt IS NOT NULL AND s.endsAt > :now)
      )`,
        { punch: PlanType.PUNCH, time: PlanType.TIME, now },
      )
      .orderBy('s.startsAt', 'ASC')
      .addOrderBy('s.createdAt', 'ASC')
      .getMany();

    // Recent subscriptions (for history widget)
    const recentSubscriptions = await this.subRepo.find({
      where: { traineeId: id },
      order: { startsAt: 'DESC', createdAt: 'DESC' },
      take: 10,
    });

    // Recent attendance with trainer + subscription lightweight info
    const recentAttendance = await this.attRepo
      .createQueryBuilder('a')
      .leftJoin('a.trainer', 't')
      .leftJoin('a.subscription', 's')
      .select([
        'a.id',
        'a.trainedAt',
        'a.paymentStatus',
        't.id',
        't.name',
        't.nickname',
        's.id',
        's.type',
      ])
      .where('a.traineeId = :id', { id })
      .orderBy('a.trainedAt', 'DESC')
      .addOrderBy('a.createdAt', 'DESC')
      .limit(20)
      .getMany();

    // Format a bit cleaner for frontend
    const attendanceDto = recentAttendance.map((a: AttendanceEntity) => ({
      id: a.id,
      trainedAt: a.trainedAt.toISOString(),
      paymentStatus: a.paymentStatus,
      trainer: {
        id: a.trainer?.id,
        name: a.trainer?.name,
        nickname: a.trainer?.nickname,
      },
      subscription: a.subscription
        ? {
            id: a.subscription.id,
            type: a.subscription.type,
          }
        : null,
    }));

    return {
      trainee,
      subscriptions: {
        active: activeSubscriptions,
        recent: recentSubscriptions,
      },
      attendance: {
        recent: attendanceDto,
      },
    };
  }
}
