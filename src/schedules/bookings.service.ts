import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import {
  bookingClosesAt,
  canBook,
  canCancel,
  cancelUntil,
  slotEndsAt,
  slotStartsAt,
} from './booking-rules';
import {
  InvalidCalendarTokenError,
  signCalendarToken,
  verifyCalendarToken,
} from './calendar-token';
import { DayRangeQueryDto, ScheduleWeekQueryDto } from './dto/schedule.dto';
import {
  ScheduleBookingEntity,
  ScheduleSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import { ScheduleWeekStatus } from './enums/schedule-week-status.enum';
import {
  addDays,
  compareGymSlots,
  compareSlots,
  weekStartOf,
  weekdayOf,
} from './schedule-week';
import {
  assertDayRange,
  bookingCounts,
  isUniqueViolation,
  lockSlot,
  today,
  trainingWorkout,
} from './schedules.service';
import { CalendarLanguage, trainingIcs } from './training-ics';
import { isWorkoutReleased, workoutReleasesAt } from './workout-release';

/**
 * Trainees' side of the weekly schedules: the gyms' published weeks, and booking a place in a
 * training. A draft week is unknown here (as if not created). Booking opens when the week is
 * published and closes 30 minutes before the training;
 * a booking can be cancelled until 1 hour before. Trainees see how many booked, never who.
 * A training's workout shows only once its day's workouts are out (`workout-release.ts`: from
 * 20:00 gym-local the day before); until then it is null, as if none were chosen.
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

  /**
   * A gym's week as a trainee sees it; `week` is null (and no trainings) until it is created and
   * published.
   */
  async week(traineeId: string, query: ScheduleWeekQueryDto) {
    const m = this.bookingRepo.manager;
    const gym = await m.findOne(GymLocationEntity, {
      where: { id: query.gymId, isActive: true },
    });
    if (!gym) throw new NotFoundException('Gym not found');
    const weekStart = weekStartOf(query.week ?? today());
    const week = await m.findOne(ScheduleWeekEntity, {
      where: { gymId: gym.id, weekStart, status: ScheduleWeekStatus.PUBLISHED },
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
   * The trainings of every active gym's published weeks on a range of days (at most 14), as in
   * `week`, each with its gym: the trainee's dashboard (today and tomorrow).
   */
  async trainings(traineeId: string, query: DayRangeQueryDto) {
    assertDayRange(query);
    const slots = await this.bookingRepo.manager.find(ScheduleSlotEntity, {
      where: {
        date: Between(query.from, query.to),
        week: {
          status: ScheduleWeekStatus.PUBLISHED,
          gym: { isActive: true },
        },
      },
      relations: {
        trainingTime: true,
        trainer: true,
        workout: true,
        week: { gym: true },
      },
    });
    const views = await this.present(traineeId, slots);
    return {
      from: query.from,
      to: query.to,
      slots: views
        .map((view, i) => ({
          ...view,
          gym: { id: slots[i].week!.gym!.id, name: slots[i].week!.gym!.name },
        }))
        .sort(compareGymSlots),
    };
  }

  /**
   * One training of an active gym as a trainee sees it, with its end, its gym (name and address)
   * and its whole workout: the title, the summary and the exercises in order, with their
   * descriptions and videos (never the source PDF). Any training of a published week, booked or not, so the trainee can decide.
   * The workout is null until its day's workouts are out.
   */
  async training(traineeId: string, slotId: string) {
    const m = this.bookingRepo.manager;
    const slot = await m.findOne(ScheduleSlotEntity, {
      where: { id: slotId },
      relations: { trainingTime: true, trainer: true, week: { gym: true } },
    });
    if (
      !slot ||
      !slot.week?.gym?.isActive ||
      slot.week.status !== ScheduleWeekStatus.PUBLISHED
    ) {
      throw new NotFoundException('Training not found');
    }
    const workout = isWorkoutReleased(slot.date, new Date())
      ? await trainingWorkout(m, slot.workoutId)
      : null;
    const [view] = await this.present(traineeId, [slot]);
    const endsAt = slotEndsAt(slot.date, slot.trainingTime!.endTime);
    return {
      ...view,
      /** When it ends (gym-local end time of its day), e.g. for a calendar event. */
      endsAt,
      /** While booked: for its calendar file (`GET /api/bookings/calendar.ics?token=`). */
      calendarToken: view.bookedByMe
        ? signCalendarToken(
            { slotId: slot.id, traineeId },
            endsAt,
            process.env.JWT_SECRET ?? '',
          )
        : null,
      gym: {
        id: slot.week.gym.id,
        name: slot.week.gym.name,
        address: slot.week.gym.address,
      },
      // The workout by its content only: trainees never get its id.
      workout: workout && {
        title: workout.title,
        summary: workout.summary,
        exercises: workout.exercises,
      },
    };
  }

  /**
   * A booked training as an iCalendar file (`training-ics.ts`), for the link the trainee's
   * calendar opens without their login: the token (from `training`) names the training and the
   * trainee. 404 for a bad or expired token, and once the booking is cancelled or the training is
   * gone from trainees' view. The workout's name only once it is out.
   */
  async calendar(token: string, language: CalendarLanguage) {
    let claims: { slotId: string; traineeId: string };
    try {
      claims = verifyCalendarToken(token, process.env.JWT_SECRET ?? '');
    } catch (error) {
      if (error instanceof InvalidCalendarTokenError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
    const m = this.bookingRepo.manager;
    const slot = await m.findOne(ScheduleSlotEntity, {
      where: { id: claims.slotId },
      relations: {
        trainingTime: true,
        trainer: true,
        workout: true,
        week: { gym: true },
      },
    });
    if (
      !slot ||
      !slot.week?.gym?.isActive ||
      slot.week.status !== ScheduleWeekStatus.PUBLISHED
    ) {
      throw new NotFoundException('Training not found');
    }
    const booked = await this.bookingRepo.exists({
      where: { slotId: slot.id, traineeId: claims.traineeId },
    });
    if (!booked) {
      throw new NotFoundException("You haven't booked this training");
    }
    const now = new Date();
    return trainingIcs(
      {
        slotId: slot.id,
        startsAt: slotStartsAt(slot.date, slot.trainingTime!.startTime),
        endsAt: slotEndsAt(slot.date, slot.trainingTime!.endTime),
        gym: { name: slot.week.gym.name, address: slot.week.gym.address },
        trainerName: slot.trainer!.name,
        workoutTitle:
          slot.workout && isWorkoutReleased(slot.date, now)
            ? slot.workout.title
            : null,
      },
      language,
      now,
    );
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
          relations: { trainingTime: true, week: true },
        });
        // A draft week's trainings are unknown to trainees.
        if (slot!.week!.status !== ScheduleWeekStatus.PUBLISHED) {
          throw new NotFoundException('Training not found');
        }
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
        workout:
          slot.workout && isWorkoutReleased(slot.date, now)
            ? { title: slot.workout.title }
            : null,
        /** The training's day's workouts are shown from this moment (20:00 the day before). */
        workoutReleasesAt: workoutReleasesAt(slot.date),
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
