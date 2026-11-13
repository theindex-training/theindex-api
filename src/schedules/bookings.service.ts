import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { WorkoutEntity } from '../workouts/workout.entity';
import {
  bookingClosesAt,
  canBook,
  canCancel,
  cancelUntil,
  slotStartsAt,
} from './booking-rules';
import { ScheduleWeekQueryDto } from './dto/schedule.dto';
import {
  ScheduleBookingEntity,
  ScheduleSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import { addDays, compareSlots, weekStartOf, weekdayOf } from './schedule-week';
import {
  bookingCounts,
  isUniqueViolation,
  lockSlot,
  today,
} from './schedules.service';

/**
 * Trainees' side of the weekly schedules: the gyms' created weeks, and booking a place in a
 * training. Booking opens when the week is created and closes 30 minutes before the training;
 * a booking can be cancelled until 1 hour before. Trainees see how many booked, never who.
 */
@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(ScheduleBookingEntity)
    private readonly bookingRepo: Repository<ScheduleBookingEntity>,
  ) {}

  /** The active gyms, by name; `preferred` marks the trainee's preferred gym. */
  async gyms(traineeId: string) {
    const m = this.bookingRepo.manager;
    const [gyms, trainee] = await Promise.all([
      m.find(GymLocationEntity, {
        where: { isActive: true },
        order: { name: 'ASC' },
      }),
      m.findOne(TraineeProfileEntity, { where: { id: traineeId } }),
    ]);
    return gyms.map((g) => ({
      id: g.id,
      name: g.name,
      preferred: g.id === trainee?.preferredGymId,
    }));
  }

  /** A gym's week as a trainee sees it; `week` is null (and no trainings) until it is created. */
  async week(traineeId: string, query: ScheduleWeekQueryDto) {
    const m = this.bookingRepo.manager;
    const gym = await m.findOne(GymLocationEntity, {
      where: { id: query.gymId, isActive: true },
    });
    if (!gym) throw new NotFoundException('Gym not found');
    const weekStart = weekStartOf(query.week ?? today());
    const week = await m.findOne(ScheduleWeekEntity, {
      where: { gymId: gym.id, weekStart },
    });
    const slots = week
      ? await m.find(ScheduleSlotEntity, {
          where: { weekId: week.id },
          relations: { trainingTime: true, trainer: true, workout: true },
        })
      : [];
    const views = await this.present(traineeId, slots);
    return {
      gym: { id: gym.id, name: gym.name },
      weekStart,
      weekEnd: addDays(weekStart, 6),
      week: week ? { id: week.id } : null,
      slots: views.sort(compareSlots),
    };
  }

  /**
   * One training of an active gym as a trainee sees it, with its gym and its whole workout: the
   * title, the summary and the exercises in order, with their descriptions and videos (never the
   * source PDF). Any training of a created week, booked or not, so the trainee can decide.
   */
  async training(traineeId: string, slotId: string) {
    const m = this.bookingRepo.manager;
    const slot = await m.findOne(ScheduleSlotEntity, {
      where: { id: slotId },
      relations: { trainingTime: true, trainer: true, week: { gym: true } },
    });
    if (!slot || !slot.week?.gym?.isActive) {
      throw new NotFoundException('Training not found');
    }
    const workout = slot.workoutId
      ? await m
          .getRepository(WorkoutEntity)
          .createQueryBuilder('w')
          .leftJoinAndSelect('w.exercises', 'we')
          .leftJoinAndSelect('we.exercise', 'e')
          .where('w.id = :id', { id: slot.workoutId })
          .orderBy('we.position', 'ASC')
          .getOne()
      : null;
    const [view] = await this.present(traineeId, [slot]);
    return {
      ...view,
      gym: { id: slot.week.gym.id, name: slot.week.gym.name },
      workout: workout
        ? {
            title: workout.title,
            summary: workout.summary,
            exercises: [...workout.exercises]
              .sort((a, b) => a.position - b.position)
              .map(({ exercise }) => ({
                id: exercise!.id,
                name: exercise!.name,
                description: exercise!.description,
                videoUrl: exercise!.videoUrl,
              })),
          }
        : null,
    };
  }

  async book(traineeId: string, slotId: string) {
    await this.checkTrainee(traineeId);
    try {
      await this.bookingRepo.manager.transaction(async (m) => {
        // Shares the slot's lock with staff changes (SchedulesService), so a training can't be
        // removed or moved to another time while it is being booked.
        await lockSlot(m, slotId, 'pessimistic_read').catch(
          (error: unknown) => {
            throw error instanceof NotFoundException
              ? new NotFoundException('Training not found')
              : error;
          },
        );
        const slot = await m.findOne(ScheduleSlotEntity, {
          where: { id: slotId },
          relations: { trainingTime: true },
        });
        const startsAt = slotStartsAt(
          slot!.date,
          slot!.trainingTime!.startTime,
        );
        if (!canBook(new Date(), startsAt)) {
          throw new BadRequestException(
            'Booking for this training has closed (30 minutes before it starts)',
          );
        }
        await m.insert(ScheduleBookingEntity, { slotId, traineeId });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('You have already booked this training');
      }
      throw error;
    }
    return (await this.present(traineeId, [await this.slot(slotId)]))[0];
  }

  async cancel(traineeId: string, slotId: string) {
    const slot = await this.slot(slotId);
    const booking = await this.bookingRepo.findOne({
      where: { slotId, traineeId },
    });
    if (!booking) {
      throw new NotFoundException("You haven't booked this training");
    }
    const startsAt = slotStartsAt(slot.date, slot.trainingTime!.startTime);
    if (!canCancel(new Date(), startsAt)) {
      throw new BadRequestException(
        'A booking can be cancelled only until 1 hour before the training',
      );
    }
    await this.bookingRepo.delete({ id: booking.id });
    return (await this.present(traineeId, [slot]))[0];
  }

  private async checkTrainee(traineeId: string) {
    const trainee = await this.bookingRepo.manager.findOne(
      TraineeProfileEntity,
      { where: { id: traineeId } },
    );
    if (!trainee) throw new NotFoundException('Trainee not found');
    if (!trainee.isActive) {
      throw new BadRequestException(
        'An inactive trainee cannot book trainings',
      );
    }
  }

  private async slot(slotId: string) {
    const slot = await this.bookingRepo.manager.findOne(ScheduleSlotEntity, {
      where: { id: slotId },
      relations: { trainingTime: true, trainer: true, workout: true },
    });
    if (!slot) throw new NotFoundException('Training not found');
    return slot;
  }

  /** Trainings with their booking state for this trainee. */
  private async present(traineeId: string, slots: ScheduleSlotEntity[]) {
    const ids = slots.map((s) => s.id);
    const m = this.bookingRepo.manager;
    const counts = await bookingCounts(m, ids);
    const mine = ids.length
      ? new Set(
          (
            await this.bookingRepo.find({
              where: { traineeId, slotId: In(ids) },
            })
          ).map((b) => b.slotId),
        )
      : new Set<string>();
    const now = new Date();
    return slots.map((slot) => {
      const startsAt = slotStartsAt(slot.date, slot.trainingTime!.startTime);
      const booked = mine.has(slot.id);
      return {
        id: slot.id,
        date: slot.date,
        weekday: weekdayOf(slot.date),
        trainingTime: {
          startTime: slot.trainingTime!.startTime,
          endTime: slot.trainingTime!.endTime,
        },
        trainer: { name: slot.trainer!.name, nickname: slot.trainer!.nickname },
        workout: slot.workout ? { title: slot.workout.title } : null,
        startsAt,
        bookedCount: counts.get(slot.id) ?? 0,
        bookedByMe: booked,
        /** Booking is open until this moment (30 minutes before the start). */
        bookingClosesAt: bookingClosesAt(startsAt),
        /** A booking can be cancelled until this moment (1 hour before the start). */
        cancelUntil: cancelUntil(startsAt),
        canBook: !booked && canBook(now, startsAt),
        canCancel: booked && canCancel(now, startsAt),
      };
    });
  }
}
