import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { toGymLocalDate } from '../attendance/attendance-timezone.util';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { WorkoutEntity } from '../workouts/workout.entity';
import {
  CreateScheduleSlotDto,
  CreateScheduleWeekDto,
  CreateTemplateSlotDto,
  ScheduleTrainingTimeDto,
  ScheduleWeekQueryDto,
  UpdateScheduleSlotDto,
  UpdateTemplateSlotDto,
} from './dto/schedule.dto';
import {
  ScheduleBookingEntity,
  ScheduleSlotEntity,
  ScheduleTemplateSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import {
  addDays,
  compareSlots,
  onlyWorkoutByDay,
  firstEditableDate,
  isEditableDate,
  isWeekOver,
  weekDates,
  weekStartOf,
  weekdayOf,
} from './schedule-week';
import { slotStartsAt } from './booking-rules';
import { buildTrainingBookings } from './training-bookings';

type SlotFields = {
  trainingTimeId?: string;
  trainingTime?: ScheduleTrainingTimeDto;
  trainerId?: string;
};

/** Today's gym-local date. Read on every call, so tests can freeze `Date`. */
export function today(): string {
  return toGymLocalDate(new Date());
}

/**
 * Gym schedule templates (ADMIN) and the real weeks created from them (ADMIN and TRAINER).
 * Days up to today are read-only in a week; the template has no dates.
 */
@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(ScheduleTemplateSlotEntity)
    private readonly templateRepo: Repository<ScheduleTemplateSlotEntity>,
    @InjectRepository(ScheduleWeekEntity)
    private readonly weekRepo: Repository<ScheduleWeekEntity>,
    @InjectRepository(ScheduleSlotEntity)
    private readonly slotRepo: Repository<ScheduleSlotEntity>,
  ) {}

  // ---- template ----

  async template(gymId: string) {
    const gym = await this.gym(gymId);
    const slots = await this.templateRepo.find({
      where: { gymId },
      relations: { trainingTime: true, trainer: true },
    });
    return {
      gym: { id: gym.id, name: gym.name },
      slots: slots.map(presentTemplateSlot).sort(compareSlots),
    };
  }

  async addTemplateSlot(gymId: string, dto: CreateTemplateSlotDto) {
    await this.gym(gymId);
    const id = await this.templateRepo.manager.transaction(async (m) => {
      const trainingTimeId = await resolveTrainingTime(m, dto, true);
      await checkTrainer(m, dto.trainerId);
      const slot = await m.save(
        m.create(ScheduleTemplateSlotEntity, {
          gymId,
          weekday: dto.weekday,
          trainingTimeId: trainingTimeId!,
          trainerId: dto.trainerId,
        }),
      );
      return slot.id;
    });
    return this.templateSlot(id);
  }

  async updateTemplateSlot(id: string, dto: UpdateTemplateSlotDto) {
    await this.templateSlot(id);
    await this.templateRepo.manager.transaction(async (m) => {
      const changes: Partial<ScheduleTemplateSlotEntity> = {};
      const trainingTimeId = await resolveTrainingTime(m, dto, false);
      if (trainingTimeId) changes.trainingTimeId = trainingTimeId;
      if (dto.trainerId !== undefined) {
        await checkTrainer(m, dto.trainerId);
        changes.trainerId = dto.trainerId;
      }
      if (dto.weekday !== undefined) changes.weekday = dto.weekday;
      await m.update(
        ScheduleTemplateSlotEntity,
        { id },
        { ...changes, updatedAt: new Date() },
      );
    });
    return this.templateSlot(id);
  }

  async deleteTemplateSlot(id: string) {
    const result = await this.templateRepo.delete({ id });
    if (!result.affected) {
      throw new NotFoundException('Template slot not found');
    }
    return { deleted: true };
  }

  private async templateSlot(id: string) {
    const slot = await this.templateRepo.findOne({
      where: { id },
      relations: { trainingTime: true, trainer: true },
    });
    if (!slot) throw new NotFoundException('Template slot not found');
    return presentTemplateSlot(slot);
  }

  // ---- weeks ----

  /** A gym's week: its slots once created, or `week: null` and no slots before that. */
  async week(query: ScheduleWeekQueryDto) {
    const gym = await this.gym(query.gymId);
    const weekStart = weekStartOf(query.week ?? today());
    const week = await this.weekRepo.findOne({
      where: { gymId: gym.id, weekStart },
    });
    const slots = week ? await this.weekSlots(week.id) : [];
    return {
      gym: { id: gym.id, name: gym.name },
      weekStart,
      weekEnd: addDays(weekStart, 6),
      /** Slots before this day are read-only. */
      editableFrom: firstEditableDate(today()),
      week: week ? { id: week.id, createdAt: week.createdAt } : null,
      slots,
    };
  }

  /**
   * Creates a gym's week from its template: every template slot becomes a dated slot, past days
   * included (they stay read-only). Refused for a week that is over, one that exists already,
   * and a gym without a template.
   */
  async createWeek(dto: CreateScheduleWeekDto, accountId: string | null) {
    const gym = await this.gym(dto.gymId);
    const weekStart = weekStartOf(dto.week);
    if (isWeekOver(weekStart, today())) {
      throw new BadRequestException('This week is over');
    }
    try {
      await this.weekRepo.manager.transaction(async (m) => {
        const template = await m.find(ScheduleTemplateSlotEntity, {
          where: { gymId: gym.id },
        });
        if (!template.length) {
          throw new BadRequestException(
            'This gym has no schedule template yet',
          );
        }
        const week = await m.save(
          m.create(ScheduleWeekEntity, {
            gymId: gym.id,
            weekStart,
            createdByAccountId: accountId,
          }),
        );
        const dates = weekDates(weekStart);
        const workouts = await m
          .createQueryBuilder(WorkoutEntity, 'w')
          .select(['w.id', 'w.date'])
          .where('w.date BETWEEN :from AND :to', {
            from: dates[0],
            to: dates[6],
          })
          .getMany();
        const onlyWorkout = onlyWorkoutByDay(workouts);
        await m.insert(
          ScheduleSlotEntity,
          template.map((slot) => {
            const date = dates[slot.weekday - 1];
            return {
              weekId: week.id,
              date,
              trainingTimeId: slot.trainingTimeId,
              trainerId: slot.trainerId,
              workoutId: onlyWorkout.get(date) ?? null,
            };
          }),
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This week has already been created');
      }
      throw error;
    }
    return this.week({ gymId: gym.id, week: weekStart });
  }

  async addSlot(weekId: string, dto: CreateScheduleSlotDto) {
    const week = await this.weekRepo.findOne({ where: { id: weekId } });
    if (!week) throw new NotFoundException('Schedule week not found');
    if (!weekDates(week.weekStart).includes(dto.date)) {
      throw new BadRequestException('The day must be in this week');
    }
    assertEditable(dto.date);
    const id = await this.slotRepo.manager.transaction(async (m) => {
      const trainingTimeId = await resolveTrainingTime(m, dto, true);
      await checkTrainer(m, dto.trainerId);
      await checkWorkout(m, dto.workoutId, dto.date);
      const slot = await m.save(
        m.create(ScheduleSlotEntity, {
          weekId,
          date: dto.date,
          trainingTimeId: trainingTimeId!,
          trainerId: dto.trainerId,
          workoutId: dto.workoutId ?? null,
        }),
      );
      return slot.id;
    });
    return this.slot(id);
  }

  async updateSlot(id: string, dto: UpdateScheduleSlotDto) {
    await this.slotRepo.manager.transaction(async (m) => {
      // Locked, so a booking can't slip in between the count below and the change.
      const slot = await lockSlot(m, id, 'pessimistic_write');
      assertEditable(slot.date);
      const changes: Partial<ScheduleSlotEntity> = {};
      const trainingTimeId = await resolveTrainingTime(m, dto, false);
      if (trainingTimeId && trainingTimeId !== slot.trainingTimeId) {
        if (await bookingCount(m, id)) {
          throw new ConflictException(
            'This training has bookings, so its time cannot change',
          );
        }
        changes.trainingTimeId = trainingTimeId;
      }
      if (dto.trainerId !== undefined) {
        await checkTrainer(m, dto.trainerId);
        changes.trainerId = dto.trainerId;
      }
      if (dto.workoutId !== undefined) {
        await checkWorkout(m, dto.workoutId, slot.date);
        changes.workoutId = dto.workoutId ?? null;
      }
      await m.update(
        ScheduleSlotEntity,
        { id },
        { ...changes, updatedAt: new Date() },
      );
    });
    return this.slot(id);
  }

  async deleteSlot(id: string) {
    await this.slotRepo.manager.transaction(async (m) => {
      // Locked, so a booking can't slip in between the count and the delete (and be deleted
      // with the training by the cascade).
      const slot = await lockSlot(m, id, 'pessimistic_write');
      assertEditable(slot.date);
      if (await bookingCount(m, id)) {
        throw new ConflictException(
          'This training has bookings, so it cannot be removed',
        );
      }
      await m.delete(ScheduleSlotEntity, { id });
    });
    return { deleted: true };
  }

  /**
   * One training of a week for staff: when and where, the trainer, the workout, and the trainees
   * who booked it with what is left of their subscriptions (`training-bookings.ts`: projected
   * until attendance is saved for the training, i.e. for the same trainee, gym and start time).
   */
  async training(id: string) {
    const m = this.slotRepo.manager;
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: {
        trainingTime: true,
        trainer: true,
        workout: true,
        week: { gym: true },
      },
    });
    if (!slot) throw new NotFoundException('Schedule slot not found');
    const gym = slot.week!.gym!;
    const startsAt = slotStartsAt(slot.date, slot.trainingTime!.startTime);
    const bookings = await m.find(ScheduleBookingEntity, {
      where: { slotId: id },
      relations: { trainee: true },
    });
    const traineeIds = bookings.map((b) => b.traineeId);
    const [subscriptions, attendance] = traineeIds.length
      ? await Promise.all([
          m.find(SubscriptionEntity, {
            where: {
              traineeId: In(traineeIds),
              status: SubscriptionStatus.ACTIVE,
            },
            relations: { plan: true },
          }),
          m.find(AttendanceEntity, {
            where: {
              traineeId: In(traineeIds),
              locationId: gym.id,
              trainedAt: startsAt,
            },
            relations: { subscription: { plan: true } },
          }),
        ])
      : [[], []];

    return {
      ...presentSlot(slot, bookings.length),
      gym: { id: gym.id, name: gym.name },
      weekStart: slot.week!.weekStart,
      startsAt,
      trainees: buildTrainingBookings(
        bookings.map((b) => ({
          traineeId: b.traineeId,
          name: b.trainee!.name,
          nickname: b.trainee!.nickname,
          isActive: b.trainee!.isActive,
          bookedAt: b.createdAt,
        })),
        subscriptions.map((sub) => ({
          id: sub.id,
          traineeId: sub.traineeId,
          type: sub.type,
          planTitle: sub.plan.title,
          startsAt: sub.startsAt,
          endsAt: sub.endsAt,
          remainingCredits: sub.remainingCredits,
          createdAt: sub.createdAt,
        })),
        attendance.map((a) => ({
          traineeId: a.traineeId,
          paymentStatus: a.paymentStatus,
          subscription: a.subscription
            ? {
                type: a.subscription.type,
                planTitle: a.subscription.plan.title,
                endsAt: a.subscription.endsAt,
              }
            : null,
        })),
        startsAt,
        new Date(),
      ),
    };
  }

  private async slot(id: string) {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: { trainingTime: true, trainer: true, workout: true },
    });
    if (!slot) throw new NotFoundException('Schedule slot not found');
    const counts = await bookingCounts(this.slotRepo.manager, [slot.id]);
    return presentSlot(slot, counts.get(slot.id) ?? 0);
  }

  private async weekSlots(weekId: string) {
    const slots = await this.slotRepo.find({
      where: { weekId },
      relations: { trainingTime: true, trainer: true, workout: true },
    });
    const counts = await bookingCounts(
      this.slotRepo.manager,
      slots.map((s) => s.id),
    );
    return slots
      .map((s) => presentSlot(s, counts.get(s.id) ?? 0))
      .sort(compareSlots);
  }

  private async gym(id: string) {
    const gym = await this.weekRepo.manager.findOne(GymLocationEntity, {
      where: { id },
    });
    if (!gym) throw new NotFoundException('Gym not found');
    return gym;
  }
}

function assertEditable(date: string) {
  if (!isEditableDate(date, today())) {
    throw new BadRequestException(
      'Trainings of today and earlier days can no longer be changed',
    );
  }
}

/**
 * The training time a slot names: by id, or by its hours (an existing training time with the
 * same hours, else a new one). Returns null when neither is sent and none is `required`.
 */
async function resolveTrainingTime(
  m: EntityManager,
  fields: SlotFields,
  required: boolean,
): Promise<string | null> {
  if (fields.trainingTimeId && fields.trainingTime) {
    throw new BadRequestException(
      'Send either trainingTimeId or trainingTime, not both',
    );
  }
  if (fields.trainingTimeId) {
    const found = await m.exists(TrainingTimeEntity, {
      where: { id: fields.trainingTimeId },
    });
    if (!found) throw new BadRequestException('Unknown training time');
    return fields.trainingTimeId;
  }
  if (fields.trainingTime) {
    const { startTime, endTime } = fields.trainingTime;
    if (endTime <= startTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
    const existing = await m
      .createQueryBuilder(TrainingTimeEntity, 't')
      .where('t.startTime = :startTime', { startTime })
      .andWhere('t.endTime = :endTime', { endTime })
      .orderBy('t.createdAt', 'ASC')
      .getOne();
    if (existing) return existing.id;
    const created = await m.save(
      m.create(TrainingTimeEntity, { startTime, endTime }),
    );
    return created.id;
  }
  if (required) {
    throw new BadRequestException('Send trainingTimeId or trainingTime');
  }
  return null;
}

/** A trainer newly put on a slot must exist and be active. */
async function checkTrainer(m: EntityManager, trainerId: string) {
  const trainer = await m.findOne(TrainerProfileEntity, {
    where: { id: trainerId },
  });
  if (!trainer) throw new BadRequestException('Unknown trainer');
  if (!trainer.isActive) throw new BadRequestException('Trainer is inactive');
}

/** A slot's workout must be one of the same day. */
async function checkWorkout(
  m: EntityManager,
  workoutId: string | null | undefined,
  date: string,
) {
  if (!workoutId) return;
  const workout = await m.findOne(WorkoutEntity, { where: { id: workoutId } });
  if (!workout) throw new BadRequestException('Unknown workout');
  if (workout.date !== date) {
    throw new BadRequestException("The workout must be on the training's day");
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

function presentTrainingTime(time: TrainingTimeEntity) {
  return { id: time.id, startTime: time.startTime, endTime: time.endTime };
}

function presentTrainer(trainer: TrainerProfileEntity) {
  return {
    id: trainer.id,
    name: trainer.name,
    nickname: trainer.nickname,
    isActive: trainer.isActive,
  };
}

function presentTemplateSlot(slot: ScheduleTemplateSlotEntity) {
  return {
    id: slot.id,
    weekday: slot.weekday,
    trainingTime: presentTrainingTime(slot.trainingTime!),
    trainer: presentTrainer(slot.trainer!),
  };
}

/**
 * Locks a week slot's row for the rest of the transaction. Staff changes that depend on its
 * bookings take it for update; a booking takes it for share, so the two wait for each other
 * while bookings of the same training don't.
 */
export async function lockSlot(
  m: EntityManager,
  id: string,
  mode: 'pessimistic_write' | 'pessimistic_read',
): Promise<ScheduleSlotEntity> {
  const slot = await m.findOne(ScheduleSlotEntity, {
    where: { id },
    lock: { mode },
  });
  if (!slot) throw new NotFoundException('Schedule slot not found');
  return slot;
}

/** How many trainees booked each of these trainings. */
export async function bookingCounts(
  m: EntityManager,
  slotIds: string[],
): Promise<Map<string, number>> {
  if (!slotIds.length) return new Map();
  const rows = await m
    .createQueryBuilder(ScheduleBookingEntity, 'b')
    .select('b.slotId', 'slotId')
    .addSelect('COUNT(*)', 'count')
    .where('b.slotId IN (:...slotIds)', { slotIds })
    .groupBy('b.slotId')
    .getRawMany<{ slotId: string; count: string }>();
  return new Map(rows.map((r) => [r.slotId, Number(r.count)]));
}

async function bookingCount(m: EntityManager, slotId: string) {
  return m.count(ScheduleBookingEntity, { where: { slotId } });
}

export function presentSlot(slot: ScheduleSlotEntity, bookedCount: number) {
  return {
    id: slot.id,
    date: slot.date,
    weekday: weekdayOf(slot.date),
    trainingTime: presentTrainingTime(slot.trainingTime!),
    trainer: presentTrainer(slot.trainer!),
    workout: slot.workout
      ? { id: slot.workout.id, title: slot.workout.title }
      : null,
    /** Trainees who booked it (a plan to come, not attendance). */
    bookedCount,
  };
}

export type TemplateSlotResponse = ReturnType<typeof presentTemplateSlot>;
export type ScheduleSlotResponse = ReturnType<typeof presentSlot>;
