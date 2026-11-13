import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ExercisesService } from '../exercises/exercises.service';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { TrainingTimesModule } from '../training-times/training-times.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import { BookingsService } from './bookings.service';
import { ScheduleBookingEntity, ScheduleSlotEntity } from './schedule.entity';
import { SchedulesModule } from './schedules.module';
import { SchedulesService } from './schedules.service';

/**
 * The week is 9-15 Nov 2026. Times are frozen in UTC; Sofia is UTC+2 in November, so the
 * 18:00 training on Friday 13 Nov starts at 16:00Z: booking closes at 15:30Z, cancelling at 15:00Z.
 */
const THURSDAY_NOON = '2026-11-12T10:00:00Z';

describe('BookingsService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [SchedulesModule, TrainingTimesModule, WorkoutsModule],
  });
  const bookings = (fx: Fixtures) => fx.moduleRef.get(BookingsService);
  const schedules = (fx: Fixtures) => fx.moduleRef.get(SchedulesService);

  /** A created week with an evening training on Friday and a morning one on Saturday. */
  async function week(fx: Fixtures) {
    freezeTime(THURSDAY_NOON);
    const gym = await fx.location('Center');
    const velcho = await fx.trainer('Velcho');
    const vasko = await fx.trainer('Vasko');
    const times = fx.ds.getRepository(TrainingTimeEntity);
    const evening = await times.save({ startTime: '18:00', endTime: '19:00' });
    const morning = await times.save({ startTime: '07:10', endTime: '08:10' });
    await schedules(fx).addTemplateSlot(gym.id, {
      weekday: 5,
      trainingTimeId: evening.id,
      trainerId: velcho.id,
    });
    await schedules(fx).addTemplateSlot(gym.id, {
      weekday: 6,
      trainingTimeId: morning.id,
      trainerId: vasko.id,
    });
    const created = await schedules(fx).createWeek(
      { gymId: gym.id, week: '2026-11-09' },
      null,
    );
    const [friday, saturday] = created.slots;
    const ana = await fx.trainee('Ana');
    const boris = await fx.trainee('Boris');
    return {
      gym,
      velcho,
      vasko,
      evening,
      morning,
      friday,
      saturday,
      ana,
      boris,
    };
  }

  it("shows a trainee the week's trainings with the count, their own booking and what they can do", async () => {
    const fx = fixtures();
    const w = await week(fx);
    await bookings(fx).book(w.ana.id, w.friday.id);
    await bookings(fx).book(w.boris.id, w.friday.id);

    const seen = await bookings(fx).week(w.ana.id, { gymId: w.gym.id });

    expect(seen).toMatchObject({
      gym: { id: w.gym.id, name: 'Center' },
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
    });
    expect(seen.week).not.toBeNull();
    expect(seen.slots).toEqual([
      {
        id: w.friday.id,
        date: '2026-11-13',
        weekday: 5,
        trainingTime: { startTime: '18:00:00', endTime: '19:00:00' },
        trainer: { name: 'Velcho', nickname: null },
        workout: null,
        startsAt: new Date('2026-11-13T16:00:00Z'),
        bookedCount: 2,
        bookedByMe: true,
        bookingClosesAt: new Date('2026-11-13T15:30:00Z'),
        cancelUntil: new Date('2026-11-13T15:00:00Z'),
        canBook: false,
        canCancel: true,
      },
      expect.objectContaining({
        id: w.saturday.id,
        bookedCount: 0,
        bookedByMe: false,
        canBook: true,
        canCancel: false,
      }),
    ]);
    // Never who booked: no trainee ids or names in the answer.
    expect(JSON.stringify(seen)).not.toContain(w.boris.id);
    expect(JSON.stringify(seen)).not.toContain('Boris');
  });

  it('shows a week not created yet as empty, so nothing can be booked', async () => {
    const fx = fixtures();
    const w = await week(fx);

    const next = await bookings(fx).week(w.ana.id, {
      gymId: w.gym.id,
      week: '2026-11-18',
    });

    expect(next).toMatchObject({
      weekStart: '2026-11-16',
      week: null,
      slots: [],
    });
  });

  it("names the training's workout by its title only", async () => {
    const fx = fixtures();
    const w = await week(fx);
    const workout = await fx.moduleRef
      .get(WorkoutsService)
      .create(
        { date: '2026-11-13', title: 'Helen', summary: 'Secret plan' },
        null,
      );
    await schedules(fx).updateSlot(w.friday.id, { workoutId: workout.id });

    const seen = await bookings(fx).week(w.ana.id, { gymId: w.gym.id });

    expect(seen.slots[0].workout).toEqual({ title: 'Helen' });
    expect(JSON.stringify(seen)).not.toContain('Secret plan');
  });

  describe('one training', () => {
    it('shows its gym, booking state and whole workout: summary and exercises in order, with descriptions and videos', async () => {
      const fx = fixtures();
      const w = await week(fx);
      const exercises = fx.moduleRef.get(ExercisesService);
      const thruster = await exercises.create({
        name: 'Thruster',
        description: 'Front squat into a push press.',
        videoUrl: 'https://youtu.be/L219ltL15zk',
      });
      const pullUp = await exercises.create({ name: 'Pull-up' });
      const workout = await fx.moduleRef.get(WorkoutsService).create(
        {
          date: '2026-11-13',
          title: 'Fran',
          summary: '21-15-9\nThrusters\nPull-ups',
          exerciseIds: [pullUp.id, thruster.id],
        },
        null,
      );
      await schedules(fx).updateSlot(w.friday.id, { workoutId: workout.id });
      // An exercise made inactive later still shows in the workout that uses it.
      await exercises.update(pullUp.id, { isActive: false });
      await bookings(fx).book(w.boris.id, w.friday.id);

      const seen = await bookings(fx).training(w.ana.id, w.friday.id);

      expect(seen).toEqual({
        id: w.friday.id,
        date: '2026-11-13',
        weekday: 5,
        trainingTime: { startTime: '18:00:00', endTime: '19:00:00' },
        trainer: { name: 'Velcho', nickname: null },
        gym: { id: w.gym.id, name: 'Center' },
        workout: {
          title: 'Fran',
          summary: '21-15-9\nThrusters\nPull-ups',
          exercises: [
            {
              id: pullUp.id,
              name: 'Pull-up',
              description: null,
              videoUrl: null,
            },
            {
              id: thruster.id,
              name: 'Thruster',
              description: 'Front squat into a push press.',
              videoUrl: 'https://www.youtube.com/watch?v=L219ltL15zk',
            },
          ],
        },
        startsAt: new Date('2026-11-13T16:00:00Z'),
        bookedCount: 1,
        bookedByMe: false,
        bookingClosesAt: new Date('2026-11-13T15:30:00Z'),
        cancelUntil: new Date('2026-11-13T15:00:00Z'),
        canBook: true,
        canCancel: false,
      });
      // Never who booked.
      expect(JSON.stringify(seen)).not.toContain('Boris');
    });

    it('shows a training without a workout, and its own booking', async () => {
      const fx = fixtures();
      const w = await week(fx);
      await bookings(fx).book(w.ana.id, w.saturday.id);

      const seen = await bookings(fx).training(w.ana.id, w.saturday.id);

      expect(seen).toMatchObject({
        id: w.saturday.id,
        gym: { name: 'Center' },
        workout: null,
        bookedCount: 1,
        bookedByMe: true,
        canBook: false,
        canCancel: true,
      });
    });

    it("is a 404 for an unknown training or one of an inactive gym's", async () => {
      const fx = fixtures();
      const w = await week(fx);
      const unknown = await rejectionOf(
        bookings(fx).training(w.ana.id, '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b'),
      );
      await fx.ds
        .getRepository(GymLocationEntity)
        .update({ id: w.gym.id }, { isActive: false });
      const closed = await rejectionOf(
        bookings(fx).training(w.ana.id, w.friday.id),
      );

      expect(unknown).toBeInstanceOf(NotFoundException);
      expect(unknown.message).toBe('Training not found');
      expect(closed).toBeInstanceOf(NotFoundException);
      expect(closed.message).toBe('Training not found');
    });
  });

  it("lists the active gyms only, by name, marking the trainee's preferred one", async () => {
    const fx = fixtures();
    const west = await fx.location('West');
    await fx.location('Center');
    await fx.location('Closed', { isActive: false });
    const ana = await fx.trainee('Ana', { preferredGymId: west.id });
    const boris = await fx.trainee('Boris');

    expect(
      (await bookings(fx).gyms(ana.id)).map((g) => [g.name, g.preferred]),
    ).toEqual([
      ['Center', false],
      ['West', true],
    ]);
    expect((await bookings(fx).gyms(boris.id)).map((g) => g.preferred)).toEqual(
      [false, false],
    );
  });

  it('a trainee books a training once (409 the second time)', async () => {
    const fx = fixtures();
    const w = await week(fx);

    const booked = await bookings(fx).book(w.ana.id, w.saturday.id);
    const again = await rejectionOf(bookings(fx).book(w.ana.id, w.saturday.id));

    expect(booked).toMatchObject({
      bookedCount: 1,
      bookedByMe: true,
      canBook: false,
    });
    expect(again).toBeInstanceOf(ConflictException);
    expect(again.message).toBe('You have already booked this training');
    expect(await fx.ds.getRepository(ScheduleBookingEntity).count()).toBe(1);
  });

  it('booking closes 30 minutes before the training starts', async () => {
    const fx = fixtures();
    const w = await week(fx);

    freezeTime('2026-11-13T15:29:00Z');
    await bookings(fx).book(w.ana.id, w.friday.id);
    freezeTime('2026-11-13T15:30:00Z');
    const late = await rejectionOf(bookings(fx).book(w.boris.id, w.friday.id));

    expect(late).toBeInstanceOf(BadRequestException);
    expect(late.message).toBe(
      'Booking for this training has closed (30 minutes before it starts)',
    );
    expect(
      (await bookings(fx).week(w.ana.id, { gymId: w.gym.id })).slots[0],
    ).toMatchObject({ bookedCount: 1, canBook: false, canCancel: false });
  });

  it('a booking can be cancelled until 1 hour before the training', async () => {
    const fx = fixtures();
    const w = await week(fx);
    await bookings(fx).book(w.ana.id, w.friday.id);
    await bookings(fx).book(w.boris.id, w.friday.id);

    freezeTime('2026-11-13T15:00:00Z');
    const cancelled = await bookings(fx).cancel(w.ana.id, w.friday.id);
    freezeTime('2026-11-13T15:00:01Z');
    const late = await rejectionOf(
      bookings(fx).cancel(w.boris.id, w.friday.id),
    );

    expect(cancelled).toMatchObject({ bookedCount: 1, bookedByMe: false });
    expect(late.message).toBe(
      'A booking can be cancelled only until 1 hour before the training',
    );
    expect(await fx.ds.getRepository(ScheduleBookingEntity).count()).toBe(1);
  });

  it("cancelling someone else's training or nothing is a 404", async () => {
    const fx = fixtures();
    const w = await week(fx);
    await bookings(fx).book(w.boris.id, w.friday.id);

    const error = await rejectionOf(bookings(fx).cancel(w.ana.id, w.friday.id));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe("You haven't booked this training");
    expect(await fx.ds.getRepository(ScheduleBookingEntity).count()).toBe(1);
  });

  it('an inactive trainee cannot book', async () => {
    const fx = fixtures();
    const w = await week(fx);
    const gone = await fx.trainee('Gone', { isActive: false });

    const error = await rejectionOf(bookings(fx).book(gone.id, w.saturday.id));

    expect(error.message).toBe('An inactive trainee cannot book trainings');
  });

  describe('at the same time', () => {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

    it('a booking waits for a training being removed, then finds it gone', async () => {
      const fx = fixtures();
      const w = await week(fx);
      // Staff are removing Saturday's training: its row is locked for update.
      const staff = fx.ds.createQueryRunner();
      await staff.connect();
      await staff.startTransaction();
      await staff.manager.findOne(ScheduleSlotEntity, {
        where: { id: w.saturday.id },
        lock: { mode: 'pessimistic_write' },
      });

      let done = false;
      const booking = rejectionOf(
        bookings(fx).book(w.ana.id, w.saturday.id),
      ).finally(() => (done = true));
      await pause();
      expect(done).toBe(false);
      await staff.manager.delete(ScheduleSlotEntity, { id: w.saturday.id });
      await staff.commitTransaction();
      await staff.release();

      expect(await booking).toBeInstanceOf(NotFoundException);
      expect(await fx.ds.getRepository(ScheduleBookingEntity).count()).toBe(0);
    });

    it('removing or moving a training waits for a booking in progress, then refuses', async () => {
      const fx = fixtures();
      const w = await week(fx);
      // A trainee is booking Saturday's training: its row is locked for share.
      const trainee = fx.ds.createQueryRunner();
      await trainee.connect();
      await trainee.startTransaction();
      await trainee.manager.findOne(ScheduleSlotEntity, {
        where: { id: w.saturday.id },
        lock: { mode: 'pessimistic_read' },
      });
      await trainee.manager.insert(ScheduleBookingEntity, {
        slotId: w.saturday.id,
        traineeId: w.ana.id,
      });

      let done = false;
      const removal = rejectionOf(schedules(fx).deleteSlot(w.saturday.id));
      const move = rejectionOf(
        schedules(fx).updateSlot(w.saturday.id, {
          trainingTimeId: w.evening.id,
        }),
      );
      void Promise.all([removal, move]).finally(() => (done = true));
      await pause();
      expect(done).toBe(false);
      await trainee.commitTransaction();
      await trainee.release();

      expect((await removal).message).toBe(
        'This training has bookings, so it cannot be removed',
      );
      expect((await move).message).toBe(
        'This training has bookings, so its time cannot change',
      );
      const staffView = await schedules(fx).week({ gymId: w.gym.id });
      expect(staffView.slots[1]).toMatchObject({
        id: w.saturday.id,
        trainingTime: { startTime: '07:10:00' },
        bookedCount: 1,
      });
    });
  });

  describe('staff side', () => {
    it("shows each training's booking count", async () => {
      const fx = fixtures();
      const w = await week(fx);
      await bookings(fx).book(w.ana.id, w.saturday.id);
      await bookings(fx).book(w.boris.id, w.saturday.id);

      const staff = await schedules(fx).week({ gymId: w.gym.id });

      expect(staff.slots.map((s) => s.bookedCount)).toEqual([0, 2]);
    });

    it('a training with bookings cannot be removed or moved to another time; its trainer can change', async () => {
      const fx = fixtures();
      const w = await week(fx);
      await bookings(fx).book(w.ana.id, w.saturday.id);

      const remove = await rejectionOf(schedules(fx).deleteSlot(w.saturday.id));
      const move = await rejectionOf(
        schedules(fx).updateSlot(w.saturday.id, {
          trainingTimeId: w.evening.id,
        }),
      );
      const changed = await schedules(fx).updateSlot(w.saturday.id, {
        trainerId: w.velcho.id,
        trainingTimeId: w.morning.id,
      });

      expect(remove).toBeInstanceOf(ConflictException);
      expect(remove.message).toBe(
        'This training has bookings, so it cannot be removed',
      );
      expect(move.message).toBe(
        'This training has bookings, so its time cannot change',
      );
      expect(changed).toMatchObject({
        trainer: { name: 'Velcho' },
        trainingTime: { startTime: '07:10:00' },
        bookedCount: 1,
      });
    });

    it('once the bookings are cancelled, the training can be removed', async () => {
      const fx = fixtures();
      const w = await week(fx);
      await bookings(fx).book(w.ana.id, w.saturday.id);
      await bookings(fx).cancel(w.ana.id, w.saturday.id);

      await schedules(fx).deleteSlot(w.saturday.id);

      expect(
        (await schedules(fx).week({ gymId: w.gym.id })).slots,
      ).toHaveLength(1);
    });
  });
});
