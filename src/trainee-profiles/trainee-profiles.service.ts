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
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { CreateTraineeDto } from './dto/create-trainee.dto';
import { UpdateTraineeDto } from './dto/update-trainee.dto';
import { TraineeProfileEntity } from './trainee-profile.entity';

const REPORT_TIMEZONE = 'Europe/Sofia';

type CountRow = {
  count: string;
};

@Injectable()
export class TraineeProfilesService {
  constructor(
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
    @InjectRepository(GymSubscriptionEntity)
    private readonly gymSubscriptionRepo: Repository<GymSubscriptionEntity>,
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
    const gymSubscriptionId = this.normalizeGymSubscriptionId(
      dto.gymSubscriptionId,
    );

    if (gymSubscriptionId) {
      await this.ensureGymSubscriptionActive(gymSubscriptionId);
    }

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
      gymSubscriptionId,
      isActive: dto.isActive ?? true,
    });

    return this.traineeRepo.save(trainee);
  }

  async update(id: string, dto: UpdateTraineeDto) {
    const trainee = await this.getById(id);

    if (dto.name !== undefined) trainee.name = dto.name.trim();
    if (dto.nickname !== undefined) {
      trainee.nickname = dto.nickname === null ? null : dto.nickname.trim();
    }

    if (dto.phone !== undefined) {
      trainee.phone = dto.phone === null ? null : dto.phone.trim();
    }

    if (dto.isActive !== undefined) trainee.isActive = dto.isActive;

    if (dto.gymSubscriptionId !== undefined) {
      const nextGymSubscriptionId = this.normalizeGymSubscriptionId(
        dto.gymSubscriptionId,
      );

      if (nextGymSubscriptionId) {
        await this.ensureGymSubscriptionActive(nextGymSubscriptionId);
      }

      trainee.gymSubscriptionId = nextGymSubscriptionId;
    }

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

  private normalizeGymSubscriptionId(value: string | null | undefined) {
    if (value === undefined || value === null) return null;
    return value;
  }

  private async ensureGymSubscriptionActive(gymSubscriptionId: string) {
    const gymSubscription = await this.gymSubscriptionRepo.findOne({
      where: { id: gymSubscriptionId, isActive: true },
    });

    if (!gymSubscription) {
      throw new BadRequestException('Gym subscription not found or inactive');
    }
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

  async trainingInsights(id: string) {
    await this.getById(id);

    const topTrainingPartnersRaw = await this.attRepo
      .createQueryBuilder('selfAttendance')
      .innerJoin(
        AttendanceEntity,
        'peerAttendance',
        `
          "peerAttendance"."traineeId" != "selfAttendance"."traineeId"
          AND "peerAttendance"."trainerId" = "selfAttendance"."trainerId"
          AND "peerAttendance"."locationId" = "selfAttendance"."locationId"
          AND "peerAttendance"."trainedAt" = "selfAttendance"."trainedAt"
        `,
      )
      .innerJoin(
        TraineeProfileEntity,
        'peerTrainee',
        'peerTrainee.id = peerAttendance.traineeId',
      )
      .select('peerTrainee.id', 'traineeId')
      .addSelect('peerTrainee.name', 'traineeName')
      .addSelect('COUNT(*)', 'trainingsTogether')
      .where('selfAttendance.traineeId = :id', { id })
      .groupBy('peerTrainee.id')
      .addGroupBy('peerTrainee.name')
      .orderBy('"trainingsTogether"', 'DESC')
      .addOrderBy('peerTrainee.name', 'ASC')
      .getRawMany<{
        traineeId: string;
        traineeName: string;
        trainingsTogether: string;
      }>();

    const topTrainersRaw = await this.attRepo
      .createQueryBuilder('a')
      .innerJoin('a.trainer', 't')
      .select('t.id', 'trainerId')
      .addSelect('t.name', 'trainerName')
      .addSelect('COUNT(*)', 'trainingsCount')
      .where('a.traineeId = :id', { id })
      .groupBy('t.id')
      .addGroupBy('t.name')
      .orderBy('"trainingsCount"', 'DESC')
      .addOrderBy('t.name', 'ASC')
      .getRawMany<{
        trainerId: string;
        trainerName: string;
        trainingsCount: string;
      }>();

    const topGymsRaw = await this.attRepo
      .createQueryBuilder('a')
      .innerJoin('a.location', 'g')
      .select('g.id', 'gymId')
      .addSelect('g.name', 'gymName')
      .addSelect('COUNT(*)', 'trainingsCount')
      .where('a.traineeId = :id', { id })
      .groupBy('g.id')
      .addGroupBy('g.name')
      .orderBy('"trainingsCount"', 'DESC')
      .addOrderBy('g.name', 'ASC')
      .getRawMany<{
        gymId: string;
        gymName: string;
        trainingsCount: string;
      }>();

    const topWeekdaysRaw = await this.attRepo
      .createQueryBuilder('a')
      .select(
        `EXTRACT(ISODOW FROM a.trainedAt AT TIME ZONE '${REPORT_TIMEZONE}')`,
        'weekdayNumber',
      )
      .addSelect(
        `TRIM(TO_CHAR(a.trainedAt AT TIME ZONE '${REPORT_TIMEZONE}', 'Day'))`,
        'weekday',
      )
      .addSelect('COUNT(*)', 'trainingsCount')
      .where('a.traineeId = :id', { id })
      .groupBy('weekdayNumber')
      .addGroupBy('weekday')
      .orderBy('"trainingsCount"', 'DESC')
      .addOrderBy('"weekdayNumber"', 'ASC')
      .getRawMany<{
        weekdayNumber: string;
        weekday: string;
        trainingsCount: string;
      }>();

    const topTimeSlotsRaw = await this.attRepo
      .createQueryBuilder('a')
      .select(
        `TO_CHAR(date_trunc('hour', a.trainedAt AT TIME ZONE '${REPORT_TIMEZONE}'), 'HH24:MI')`,
        'slotStart',
      )
      .addSelect(
        `TO_CHAR(date_trunc('hour', a.trainedAt AT TIME ZONE '${REPORT_TIMEZONE}') + interval '59 minutes', 'HH24:MI')`,
        'slotEnd',
      )
      .addSelect('COUNT(*)', 'trainingsCount')
      .where('a.traineeId = :id', { id })
      .groupBy('slotStart')
      .addGroupBy('slotEnd')
      .orderBy('"trainingsCount"', 'DESC')
      .addOrderBy('"slotStart"', 'ASC')
      .getRawMany<{
        slotStart: string;
        slotEnd: string;
        trainingsCount: string;
      }>();

    const totalAttendancesRaw = await this.attRepo
      .createQueryBuilder('a')
      .select('COUNT(*)', 'count')
      .where('a.traineeId = :id', { id })
      .getRawOne<CountRow>();

    const totalAttendances = Number(totalAttendancesRaw?.count ?? 0);

    return {
      traineeId: id,
      totalAttendances,
      topTrainingPartners: topTrainingPartnersRaw.map((row) => ({
        traineeId: row.traineeId,
        traineeName: row.traineeName,
        trainingsTogether: Number(row.trainingsTogether),
      })),
      topTrainers: topTrainersRaw.map((row) => ({
        trainerId: row.trainerId,
        trainerName: row.trainerName,
        trainingsCount: Number(row.trainingsCount),
      })),
      topGyms: topGymsRaw.map((row) => ({
        gymId: row.gymId,
        gymName: row.gymName,
        trainingsCount: Number(row.trainingsCount),
      })),
      topWeekdays: topWeekdaysRaw.map((row) => ({
        weekday: row.weekday,
        weekdayNumber: Number(row.weekdayNumber),
        trainingsCount: Number(row.trainingsCount),
      })),
      topTimeSlots: topTimeSlotsRaw.map((row) => ({
        timeSlot: `${row.slotStart}-${row.slotEnd}`,
        trainingsCount: Number(row.trainingsCount),
      })),
    };
  }
}
