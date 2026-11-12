import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { toGymLocalDate } from '../attendance/attendance-timezone.util';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
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
  ScheduleSlotEntity,
  ScheduleTemplateSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import {
  addDays,
  compareSlots,
  firstEditableDate,
  isEditableDate,
  isWeekOver,
  weekDates,
  weekStartOf,
  weekdayOf,
} from './schedule-week';

type SlotFields = {
  trainingTimeId?: string;
  trainingTime?: ScheduleTrainingTimeDto;
  trainerId?: string;
};

/** Today's gym-local date. Read on every call, so tests can freeze `Date`. */
function today(): string {
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
        await m.insert(
          ScheduleSlotEntity,
          template.map((slot) => ({
            weekId: week.id,
            date: dates[slot.weekday - 1],
            trainingTimeId: slot.trainingTimeId,
            trainerId: slot.trainerId,
            workoutId: null,
          })),
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
    const slot = await this.slotRepo.findOne({ where: { id } });
    if (!slot) throw new NotFoundException('Schedule slot not found');
    assertEditable(slot.date);
    await this.slotRepo.manager.transaction(async (m) => {
      const changes: Partial<ScheduleSlotEntity> = {};
      const trainingTimeId = await resolveTrainingTime(m, dto, false);
      if (trainingTimeId) changes.trainingTimeId = trainingTimeId;
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
    const slot = await this.slotRepo.findOne({ where: { id } });
    if (!slot) throw new NotFoundException('Schedule slot not found');
    assertEditable(slot.date);
    await this.slotRepo.delete({ id });
    return { deleted: true };
  }

  private async slot(id: string) {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: { trainingTime: true, trainer: true, workout: true },
    });
    if (!slot) throw new NotFoundException('Schedule slot not found');
    return presentSlot(slot);
  }

  private async weekSlots(weekId: string) {
    const slots = await this.slotRepo.find({
      where: { weekId },
      relations: { trainingTime: true, trainer: true, workout: true },
    });
    return slots.map(presentSlot).sort(compareSlots);
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

function isUniqueViolation(error: unknown): boolean {
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

function presentSlot(slot: ScheduleSlotEntity) {
  return {
    id: slot.id,
    date: slot.date,
    weekday: weekdayOf(slot.date),
    trainingTime: presentTrainingTime(slot.trainingTime!),
    trainer: presentTrainer(slot.trainer!),
    workout: slot.workout
      ? { id: slot.workout.id, title: slot.workout.title }
      : null,
  };
}

export type TemplateSlotResponse = ReturnType<typeof presentTemplateSlot>;
export type ScheduleSlotResponse = ReturnType<typeof presentSlot>;
