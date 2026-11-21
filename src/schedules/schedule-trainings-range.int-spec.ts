import { BadRequestException } from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { TrainingTimesModule } from '../training-times/training-times.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import { BookingsService } from './bookings.service';
import { SchedulesModule } from './schedules.module';
import { SchedulesService } from './schedules.service';

/**
 * The trainings of a range of days across gyms, for the dashboards: staff
 * (`SchedulesService.trainings`, with attendance) and trainees (`BookingsService.trainings`).
 * The range is Sunday 15 and Monday 16 Nov 2026, across two weeks (9-15 and 16-22).
 * Setup happens on Saturday 14 Nov at noon in Sofia (10:00Z).
 */
const SATURDAY_NOON = '2026-11-14T10:00:00Z';
const SUNDAY_NOON = '2026-11-15T10:00:00Z';
const RANGE = { from: '2026-11-15', to: '2026-11-16' };

describe('Trainings of a range of days (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [SchedulesModule, TrainingTimesModule, WorkoutsModule],
  });
  const schedules = (fx: Fixtures) => fx.moduleRef.get(SchedulesService);
  const bookings = (fx: Fixtures) => fx.moduleRef.get(BookingsService);

  async function time(fx: Fixtures, startTime: string, endTime: string) {
    return fx.ds.getRepository(TrainingTimeEntity).save({ startTime, endTime });
  }

  /**
   * Center: Sunday 09:00 (Velcho) and Monday 07:00 (Asen); its week 9-15 is published, 16-22 a
   * draft. Lozenets: Sunday 18:00 (Asen), week 9-15 published. Old: an inactive gym with a
   * published Sunday training.
   */
  async function twoWeeks(fx: Fixtures) {
    freezeTime(SATURDAY_NOON);
    const center = await fx.location('Center');
    const lozenets = await fx.location('Lozenets');
    const old = await fx.location('Old');
    const velcho = await fx.trainer('Velcho');
    const asen = await fx.trainer('Asen');
    const morning = await time(fx, '09:00', '10:00');
    const early = await time(fx, '07:00', '08:00');
    const evening = await time(fx, '18:00', '19:00');
    const s = schedules(fx);
    await s.addTemplateSlot(center.id, {
      weekday: 7,
      trainingTimeId: morning.id,
      trainerId: velcho.id,
    });
    await s.addTemplateSlot(center.id, {
      weekday: 1,
      trainingTimeId: early.id,
      trainerId: asen.id,
    });
    await s.addTemplateSlot(lozenets.id, {
      weekday: 7,
      trainingTimeId: evening.id,
      trainerId: asen.id,
    });
    await s.addTemplateSlot(old.id, {
      weekday: 7,
      trainingTimeId: evening.id,
      trainerId: velcho.id,
    });
    const publish = async (gymId: string, week: string) => {
      const draft = await s.createWeek({ gymId, week }, null);
      return s.publishWeek(draft.week!.id, null);
    };
    const centerWeek = await publish(center.id, '2026-11-09');
    const centerNext = await s.createWeek(
      { gymId: center.id, week: '2026-11-16' },
      null,
    );
    const lozenetsWeek = await publish(lozenets.id, '2026-11-09');
    await publish(old.id, '2026-11-09');
    await fx.ds
      .getRepository(GymLocationEntity)
      .update({ id: old.id }, { isActive: false });
    const slotOn = (
      week: { slots: { id: string; date: string }[] },
      date: string,
    ) => week.slots.find((slot) => slot.date === date)!.id;
    return {
      center,
      lozenets,
      velcho,
      asen,
      sunday: slotOn(centerWeek, '2026-11-15'),
      monday: slotOn(centerNext, '2026-11-16'),
      lozenetsSunday: slotOn(lozenetsWeek, '2026-11-15'),
    };
  }

  describe('for staff', () => {
    it("lists every active gym's trainings of the range, drafts included, by day, start and gym", async () => {
      const fx = fixtures();
      const f = await twoWeeks(fx);

      const seen = await schedules(fx).trainings(RANGE);

      expect(seen.from).toBe('2026-11-15');
      expect(seen.to).toBe('2026-11-16');
      expect(
        seen.slots.map((slot) => [
          slot.id,
          slot.date,
          slot.trainingTime.startTime,
          slot.gym.name,
          slot.trainer.name,
          slot.weekStatus,
        ]),
      ).toEqual([
        [f.sunday, '2026-11-15', '09:00:00', 'Center', 'Velcho', 'PUBLISHED'],
        [
          f.lozenetsSunday,
          '2026-11-15',
          '18:00:00',
          'Lozenets',
          'Asen',
          'PUBLISHED',
        ],
        // The next week is still a draft: staff see it, trainees don't.
        [f.monday, '2026-11-16', '07:00:00', 'Center', 'Asen', 'DRAFT'],
      ]);
      expect(seen.slots[0]).toMatchObject({
        gym: { id: f.center.id, name: 'Center' },
        trainer: { id: f.velcho.id, name: 'Velcho' },
        weekStart: '2026-11-09',
        // 09:00-10:00 in Sofia (UTC+2).
        startsAt: new Date('2026-11-15T07:00:00Z'),
        endsAt: new Date('2026-11-15T08:00:00Z'),
        bookedCount: 0,
        attendanceCount: 0,
        unregisteredTraineeIds: [],
      });
      expect(seen.slots[2].weekStart).toBe('2026-11-16');
    });

    it("counts a training's attendance by its gym and start, and lists the booked active trainees not registered yet", async () => {
      const fx = fixtures();
      const f = await twoWeeks(fx);
      const ana = await fx.trainee('Ana');
      const boris = await fx.trainee('Boris');
      const cveta = await fx.trainee('Cveta');
      const dimo = await fx.trainee('Dimo');
      const walkIn = await fx.trainee('Walk-in');
      for (const trainee of [ana, boris, cveta, dimo]) {
        await bookings(fx).book(trainee.id, f.sunday);
      }
      // Dimo stopped training after booking: Register attendance doesn't offer inactive trainees.
      await fx.ds
        .getRepository(TraineeProfileEntity)
        .update({ id: dimo.id }, { isActive: false });

      freezeTime(SUNDAY_NOON);
      // What Register attendance saves for the training: its gym and start.
      await fx.attend(ana.id, f.velcho.id, f.center.id, '2026-11-15T09:00');
      // Someone who came without booking counts too.
      await fx.attend(walkIn.id, f.velcho.id, f.center.id, '2026-11-15T09:00');
      // Boris trained, but at another time and in another gym: not this training.
      await fx.attend(boris.id, f.velcho.id, f.center.id, '2026-11-15T12:00');
      await fx.attend(boris.id, f.asen.id, f.lozenets.id, '2026-11-15T18:00');

      const seen = await schedules(fx).trainings(RANGE);

      const byId = new Map(seen.slots.map((slot) => [slot.id, slot]));
      expect(byId.get(f.sunday)).toMatchObject({
        bookedCount: 4,
        attendanceCount: 2,
        // In booking order; Ana is registered and Dimo inactive.
        unregisteredTraineeIds: [boris.id, cveta.id],
      });
      expect(byId.get(f.lozenetsSunday)).toMatchObject({
        bookedCount: 0,
        attendanceCount: 1,
        unregisteredTraineeIds: [],
      });
      expect(byId.get(f.monday)!.attendanceCount).toBe(0);
    });

    it('answers 400 for a range that ends before it starts or covers more than 14 days', async () => {
      const fx = fixtures();

      const backwards = await rejectionOf(
        schedules(fx).trainings({ from: '2026-11-16', to: '2026-11-15' }),
      );
      const tooLong = await rejectionOf(
        schedules(fx).trainings({ from: '2026-11-01', to: '2026-11-15' }),
      );

      expect(backwards).toBeInstanceOf(BadRequestException);
      expect(backwards.message).toBe('to must not be before from');
      expect(tooLong).toBeInstanceOf(BadRequestException);
      expect(tooLong.message).toBe('A range can cover at most 14 days');
    });
  });

  describe('for trainees', () => {
    it("lists the active gyms' published trainings of the range, each with its gym and the trainee's booking", async () => {
      const fx = fixtures();
      const f = await twoWeeks(fx);
      const ana = await fx.trainee('Ana');
      const boris = await fx.trainee('Boris');
      await bookings(fx).book(ana.id, f.lozenetsSunday);
      await bookings(fx).book(boris.id, f.lozenetsSunday);

      const seen = await bookings(fx).trainings(ana.id, RANGE);

      expect(seen.from).toBe('2026-11-15');
      expect(seen.to).toBe('2026-11-16');
      // Not Monday's draft, and not the inactive gym's training.
      expect(
        seen.slots.map((slot) => [
          slot.id,
          slot.gym.name,
          slot.bookedCount,
          slot.bookedByMe,
          slot.canBook,
          slot.canCancel,
        ]),
      ).toEqual([
        [f.sunday, 'Center', 0, false, true, false],
        [f.lozenetsSunday, 'Lozenets', 2, true, false, true],
      ]);
      expect(seen.slots[0]).toMatchObject({
        gym: { id: f.center.id, name: 'Center' },
        trainer: { name: 'Velcho' },
        startsAt: new Date('2026-11-15T07:00:00Z'),
      });
      // Trainees never see who leads it by id, nor who booked.
      expect(seen.slots[0].trainer).not.toHaveProperty('id');
      expect(seen.slots[1]).not.toHaveProperty('unregisteredTraineeIds');
    });

    it("shows a training's workout only once its day's workouts are out (20:00 the day before)", async () => {
      const fx = fixtures();
      const f = await twoWeeks(fx);
      const ana = await fx.trainee('Ana');
      const workout = await fx.moduleRef
        .get(WorkoutsService)
        .create(
          { date: '2026-11-15', title: 'Cindy', summary: 'AMRAP 20' },
          null,
        );
      await schedules(fx).updateSlot(f.lozenetsSunday, {
        workoutId: workout.id,
      });

      const before = await bookings(fx).trainings(ana.id, RANGE);
      freezeTime('2026-11-14T18:00:00Z'); // 20:00 in Sofia
      const after = await bookings(fx).trainings(ana.id, RANGE);

      const lozenets = (seen: typeof before) =>
        seen.slots.find((slot) => slot.id === f.lozenetsSunday)!;
      expect(lozenets(before).workout).toBeNull();
      expect(lozenets(after).workout).toEqual({ title: 'Cindy' });
    });

    it('answers 400 for a range of more than 14 days', async () => {
      const fx = fixtures();
      const ana = await fx.trainee('Ana');

      const error = await rejectionOf(
        bookings(fx).trainings(ana.id, {
          from: '2026-11-01',
          to: '2026-11-15',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('A range can cover at most 14 days');
    });
  });
});
