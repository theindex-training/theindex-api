import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { SubscriptionResolverService } from '../subscriptions/subscription-resolver.service';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { getLocalDateInterval } from './attendance-range.util';
import { getLocalDateTimeInterval } from './attendance-datetime-range.util';
import { resolveTrainedAt } from './attendance-time.util';
import { AttendanceEntity } from './attendance.entity';
import { AttendanceDatesQueryDto } from './dto/attendance-dates.query.dto';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions.query.dto';
import { CreateAttendanceBatchDto } from './dto/create-attendance-batch.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
    @InjectRepository(TrainerProfileEntity)
    private readonly trainerRepo: Repository<TrainerProfileEntity>,
    @InjectRepository(GymLocationEntity)
    private readonly locationRepo: Repository<GymLocationEntity>,
    private readonly resolver: SubscriptionResolverService,
  ) {}

  async create(dto: CreateAttendanceDto) {
    const trainedAt = resolveTrainedAt(dto);

    return this.dataSource.transaction(async (manager) => {
      return this.createOneInTransaction(
        manager,
        dto.traineeId,
        dto.trainerId,
        trainedAt,
        dto.locationId,
      );
    });
  }

  async createBatch(dto: CreateAttendanceBatchDto) {
    const traineeIds = Array.from(new Set(dto.traineeIds));
    const trainedAt = resolveTrainedAt(dto);

    // Validate trainer once
    const trainer = await this.trainerRepo.findOne({
      where: { id: dto.trainerId, isActive: true },
    });
    if (!trainer)
      throw new BadRequestException('Trainer not found or inactive');

    // Validate trainees exist + active
    const trainees = await this.traineeRepo.findByIds(traineeIds as any);
    const activeSet = new Set(
      trainees.filter((t) => t.isActive).map((t) => t.id),
    );

    const invalidTraineeIds = traineeIds.filter((id) => !activeSet.has(id));
    if (invalidTraineeIds.length > 0) {
      throw new BadRequestException({
        message: 'Some trainees are missing or inactive',
        invalidTraineeIds,
      });
    }

    const location = await this.locationRepo.findOne({
      where: { id: dto.locationId, isActive: true },
    });
    if (!location)
      throw new BadRequestException('Location not found or inactive');

    return this.dataSource.transaction(async (manager) => {
      const results: any[] = [];

      for (const traineeId of traineeIds) {
        const created = await this.createOneInTransaction(
          manager,
          traineeId,
          dto.trainerId,
          trainedAt,
          dto.locationId,
        );
        results.push(created);
      }

      return {
        trainerId: dto.trainerId,
        trainedAt: trainedAt.toISOString(),
        count: results.length,
        results,
      };
    });
  }

  async dates(query: AttendanceDatesQueryDto) {
    const { from, to } = getLocalDateInterval(query.from, query.to);

    // Choose a single gym timezone (configurable later)
    const tz = 'Europe/Sofia';

    const qb = this.attRepo
      .createQueryBuilder('a')
      .select(`to_char(a.trainedAt AT TIME ZONE '${tz}', 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        `SUM(CASE WHEN a.paymentStatus = 'UNPAID' THEN 1 ELSE 0 END)`,
        'unpaidCount',
      )
      .where('a.trainedAt >= :from AND a.trainedAt < :to', { from, to });

    if (query.trainerId)
      qb.andWhere('a.trainerId = :trainerId', { trainerId: query.trainerId });
    if (query.traineeId)
      qb.andWhere('a.traineeId = :traineeId', { traineeId: query.traineeId });

    qb.groupBy('date').orderBy('date', 'ASC');

    const raw = await qb.getRawMany<{
      date: string;
      count: string;
      unpaidCount: string;
    }>();

    return {
      from: query.from,
      to: query.to,
      days: raw.map((r) => ({
        date: r.date,
        count: Number(r.count),
        unpaidCount: Number(r.unpaidCount),
        paidCount: Number(r.count) - Number(r.unpaidCount),
        hasUnpaid: Number(r.unpaidCount) > 0,
      })),
    };
  }

  async sessions(query: AttendanceSessionsQueryDto) {
    return this.listSessionView(query);
  }


  private async listSessionView(query: AttendanceSessionsQueryDto) {
    const { from, to } = getLocalDateTimeInterval(query);
    const bucket = query.bucketMinutes ?? 60;

    const qb = this.attRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.trainee', 'trn')
      .leftJoinAndSelect('a.trainer', 't')
      .leftJoinAndSelect('a.location', 'loc')
      .where('a.trainedAt >= :from AND a.trainedAt < :to', { from, to });

    if (query.trainerId) {
      qb.andWhere('a.trainerId = :trainerId', { trainerId: query.trainerId });
    }

    qb.orderBy('a.trainedAt', 'ASC').addOrderBy('a.createdAt', 'ASC');

    const items = await qb.getMany();
    const sessions: Record<string, any> = {};
    const trainees = new Map<string, any>();
    const trainers = new Map<string, any>();
    const locations = new Map<string, any>();

    for (const a of items) {
      const dt = a.trainedAt;
      const minutesFromMidnight = dt.getHours() * 60 + dt.getMinutes();
      const bucketStartMin = Math.floor(minutesFromMidnight / bucket) * bucket;
      const startH = Math.floor(bucketStartMin / 60);
      const startM = bucketStartMin % 60;

      const day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const key = `${day}|${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}|${a.trainerId}|${a.locationId}`;

      if (!sessions[key]) {
        const start = new Date(
          dt.getFullYear(),
          dt.getMonth(),
          dt.getDate(),
          startH,
          startM,
          0,
          0,
        );
        const end = new Date(start.getTime() + bucket * 60 * 1000);

        sessions[key] = {
          sessionKey: key,
          date: day,
          start: start.toISOString(),
          end: end.toISOString(),
          bucketMinutes: bucket,
          trainerId: a.trainerId,
          locationId: a.locationId,
          attendance: [],
          totals: { count: 0, paid: 0, unpaid: 0 },
        };
      }

      trainees.set(a.trainee.id, {
        id: a.trainee.id,
        name: a.trainee.name,
        nickname: a.trainee.nickname,
      });

      trainers.set(a.trainer.id, {
        id: a.trainer.id,
        name: a.trainer.name,
        nickname: a.trainer.nickname,
      });

      if (a.location) {
        locations.set(a.location.id, {
          id: a.location.id,
          name: a.location.name,
        });
      }

      sessions[key].attendance.push({
        id: a.id,
        trainedAt: a.trainedAt.toISOString(),
        paymentStatus: a.paymentStatus,
        traineeId: a.traineeId,
        subscriptionId: a.subscriptionId,
      });

      sessions[key].totals.count += 1;
      if (a.paymentStatus === AttendancePaymentStatus.UNPAID) {
        sessions[key].totals.unpaid += 1;
      } else {
        sessions[key].totals.paid += 1;
      }
    }

    return {
      filters: {
        startDate: query.startDate,
        endDate: query.endDate,
        startTime: query.startTime ?? '00:00',
        endTime: query.endTime ?? '23:59',
        trainerId: query.trainerId ?? null,
      },
      bucketMinutes: bucket,
      sessions: Object.values(sessions),
      entities: {
        trainees: Array.from(trainees.values()),
        trainers: Array.from(trainers.values()),
        locations: Array.from(locations.values()),
      },
    };
  }

  async remove(id: string) {
    const attendance = await this.attRepo.findOne({ where: { id } });
    if (!attendance) throw new NotFoundException('Attendance not found');

    await this.attRepo.remove(attendance);
    return { deleted: true };
  }

  private async createOneInTransaction(
    manager: EntityManager,
    traineeId: string,
    trainerId: string,
    trainedAt: Date,
    locationId: string,
  ) {
    // Use manager repos for consistency inside the transaction
    const traineeRepo = manager.getRepository(TraineeProfileEntity);
    const trainerRepo = manager.getRepository(TrainerProfileEntity);
    const locationRepo = manager.getRepository(GymLocationEntity);
    const subRepo = manager.getRepository(SubscriptionEntity);
    const attRepo = manager.getRepository(AttendanceEntity);

    const [trainee, trainer, location] = await Promise.all([
      traineeRepo.findOne({ where: { id: traineeId, isActive: true } }),
      trainerRepo.findOne({ where: { id: trainerId, isActive: true } }),
      locationRepo.findOne({ where: { id: locationId, isActive: true } }),
    ]);

    if (!trainee)
      throw new BadRequestException('Trainee not found or inactive');
    if (!trainer)
      throw new BadRequestException('Trainer not found or inactive');
    if (!location) {
      throw new BadRequestException('Location not found or inactive');
    }

    // IMPORTANT: Resolve subscription in a way that is transaction-safe.
    // If your resolver currently uses injected repos directly, add an overload that accepts manager,
    // or implement the resolver logic here.
    const subscription = await this.resolver.resolveForAttendance(
      traineeId,
      trainedAt,
      manager,
    );

    const attendance = attRepo.create({
      traineeId,
      trainerId,
      trainedAt,
      locationId,
      subscriptionId: subscription?.id ?? null,
      paymentStatus: subscription
        ? AttendancePaymentStatus.PAID
        : AttendancePaymentStatus.UNPAID,
    });

    const savedAttendance = await attRepo.save(attendance);

    if (subscription && subscription.type === PlanType.PUNCH) {
      // Lock subscription row for safe decrement
      const locked = await subRepo
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id: subscription.id })
        .getOne();

      if (!locked) throw new BadRequestException('Subscription not found');

      if (!locked.remainingCredits || locked.remainingCredits <= 0) {
        // Edge case (race): revert this attendance to UNPAID
        savedAttendance.subscriptionId = null;
        savedAttendance.paymentStatus = AttendancePaymentStatus.UNPAID;
        await attRepo.save(savedAttendance);

        return {
          attendance: savedAttendance,
          info: { paymentStatus: savedAttendance.paymentStatus },
        };
      }

      locked.remainingCredits -= 1;
      if (locked.remainingCredits === 0)
        locked.status = SubscriptionStatus.EXHAUSTED;
      await subRepo.save(locked);

      return {
        attendance: savedAttendance,
        info: {
          paymentStatus: savedAttendance.paymentStatus,
          subscriptionId: locked.id,
          subscriptionType: locked.type,
          remainingCredits: locked.remainingCredits,
        },
      };
    }

    // TIME-based: no consumption
    return {
      attendance: savedAttendance,
      info: {
        paymentStatus: savedAttendance.paymentStatus,
        subscriptionId: subscription?.id ?? null,
        subscriptionType: subscription?.type ?? null,
      },
    };
  }
}
