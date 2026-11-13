import { NotFoundException } from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { TrainingTimesModule } from '../training-times/training-times.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import { BookingsService } from './bookings.service';
import { SchedulesModule } from './schedules.module';
import { SchedulesService } from './schedules.service';

/**
 * The staff's page of one training (`SchedulesService.training`): who booked it and what their
 * subscriptions have left. The week is 9-15 Nov 2026; the training is Friday 13 Nov at 18:00
 * in Sofia (16:00Z). Now is Thursday noon.
 */
const THURSDAY_NOON = '2026-11-12T10:00:00Z';
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

describe('SchedulesService.training (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [SchedulesModule, TrainingTimesModule, WorkoutsModule],
  });
  const schedules = (fx: Fixtures) => fx.moduleRef.get(SchedulesService);
  const bookings = (fx: Fixtures) => fx.moduleRef.get(BookingsService);

  async function friday(fx: Fixtures) {
    freezeTime(THURSDAY_NOON);
    const gym = await fx.location('Center');
    const other = await fx.location('Lozenets');
    const velcho = await fx.trainer('Velcho', { nickname: 'Vel' });
    const evening = await fx.ds
      .getRepository(TrainingTimeEntity)
      .save({ startTime: '18:00', endTime: '19:00' });
    await schedules(fx).addTemplateSlot(gym.id, {
      weekday: 5,
      trainingTimeId: evening.id,
      trainerId: velcho.id,
    });
    const week = await schedules(fx).createWeek(
      { gymId: gym.id, week: '2026-11-09' },
      null,
    );
    return { gym, other, velcho, slot: week.slots[0] };
  }

  it('shows the training with its gym and week, and the trainees who booked it with what would be left after it', async () => {
    const fx = fixtures();
    const f = await friday(fx);
    const workout = await fx.moduleRef
      .get(WorkoutsService)
      .create({ date: '2026-11-13', title: 'Fran', summary: '21-15-9' }, null);
    await schedules(fx).updateSlot(f.slot.id, { workoutId: workout.id });

    const ana = await fx.trainee('Ana', { nickname: 'Ani' });
    const boris = await fx.trainee('Boris');
    const cveta = await fx.trainee('Cveta');
    const dimo = await fx.trainee('Dimo');
    await fx.buy(ana.id, (await fx.punchPlan(8, 8000)).id);
    await fx.buy(boris.id, (await fx.timePlan(30, 9000)).id);
    await fx.buy(dimo.id, (await fx.punchPlan(1, 1500)).id);
    for (const t of [ana, boris, cveta, dimo]) {
      await bookings(fx).book(t.id, f.slot.id);
    }

    const seen = await schedules(fx).training(f.slot.id);

    expect(seen).toMatchObject({
      id: f.slot.id,
      date: '2026-11-13',
      weekday: 5,
      trainingTime: { startTime: '18:00:00', endTime: '19:00:00' },
      trainer: { id: f.velcho.id, name: 'Velcho', nickname: 'Vel' },
      workout: { id: workout.id, title: 'Fran' },
      bookedCount: 4,
      gym: { id: f.gym.id, name: 'Center' },
      weekStart: '2026-11-09',
      startsAt: new Date('2026-11-13T16:00:00Z'),
    });
    expect(
      seen.trainees.map((t) => [
        t.name,
        t.attendanceSaved,
        t.paymentStatus,
        t.level,
        t.subscription?.type ?? null,
        t.subscription?.remainingCredits ?? null,
        t.subscription?.daysLeft ?? null,
      ]),
    ).toEqual([
      ['Cveta', false, 'UNPAID', 'UNPAID', null, null, null],
      ['Dimo', false, 'PAID', 'LAST', 'PUNCH', 0, null],
      ['Ana', false, 'PAID', 'OK', 'PUNCH', 7, null],
      ['Boris', false, 'PAID', 'OK', 'TIME', null, 30],
    ]);
    expect(seen.trainees[2]).toMatchObject({
      traineeId: ana.id,
      nickname: 'Ani',
      isActive: true,
      subscription: { planTitle: 'Punch 8' },
    });
    expect(seen.trainees[2].bookedAt).toBeInstanceOf(Date);
  });

  it('stops projecting once attendance is saved for the training (same trainee, gym and start), and only then', async () => {
    const fx = fixtures();
    const f = await friday(fx);
    const ana = await fx.trainee('Ana');
    const boris = await fx.trainee('Boris');
    const plan = await fx.punchPlan(5, 5000);
    await fx.buy(ana.id, plan.id);
    await fx.buy(boris.id, plan.id);
    await bookings(fx).book(ana.id, f.slot.id);
    await bookings(fx).book(boris.id, f.slot.id);

    // What Register attendance saves from the training: its day and start, in its gym.
    await fx.attend(ana.id, f.velcho.id, f.gym.id, '2026-11-13T18:00');
    // Boris trained the same day, but at another time and in another gym: not this training.
    await fx.attend(boris.id, f.velcho.id, f.gym.id, '2026-11-13T12:00');
    await fx.attend(boris.id, f.velcho.id, f.other.id, '2026-11-13T18:00');

    const seen = await schedules(fx).training(f.slot.id);

    expect(
      seen.trainees.map((t) => [
        t.name,
        t.attendanceSaved,
        t.subscription?.remainingCredits,
      ]),
    ).toEqual([
      // 5 - 2 trainings saved, then one more projected for this training.
      ['Boris', false, 2],
      // 5 - this training: what is left now, not one less again.
      ['Ana', true, 4],
    ]);
  });

  it('shows a training nobody booked with an empty list', async () => {
    const fx = fixtures();
    const f = await friday(fx);

    const seen = await schedules(fx).training(f.slot.id);

    expect(seen.bookedCount).toBe(0);
    expect(seen.trainees).toEqual([]);
  });

  it('answers 404 for an unknown training', async () => {
    const fx = fixtures();

    const error = await rejectionOf(schedules(fx).training(UNKNOWN_ID));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Schedule slot not found');
  });
});
