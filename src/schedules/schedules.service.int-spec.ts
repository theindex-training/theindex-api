import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { TrainingTimesModule } from '../training-times/training-times.module';
import { TrainingTimesService } from '../training-times/training-times.service';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import {
  ScheduleSlotEntity,
  ScheduleTemplateSlotEntity,
  ScheduleWeekEntity,
} from './schedule.entity';
import { SchedulesModule } from './schedules.module';
import { SchedulesService } from './schedules.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
/** Thursday 12 Nov 2026, noon in Sofia. This week runs 9-15 Nov; 13 Nov is the first editable day. */
const NOW = '2026-11-12T10:00:00Z';

describe('SchedulesService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [SchedulesModule, TrainingTimesModule, WorkoutsModule],
  });
  const svc = (fx: Fixtures) => fx.moduleRef.get(SchedulesService);
  const times = (fx: Fixtures) => fx.ds.getRepository(TrainingTimeEntity);

  async function setup(fx: Fixtures) {
    const gym = await fx.location('Center');
    const velcho = await fx.trainer('Velcho');
    const vasko = await fx.trainer('Vasko');
    const morning = await times(fx).save({
      startTime: '07:10',
      endTime: '08:10',
    });
    const evening = await times(fx).save({
      startTime: '17:00',
      endTime: '18:00',
    });
    return { gym, velcho, vasko, morning, evening };
  }

  const line = (s: {
    date?: string;
    weekday?: number;
    trainingTime: { startTime: string };
    trainer: { name: string };
  }) => `${s.date ?? s.weekday} ${s.trainingTime.startTime} ${s.trainer.name}`;

  describe('template', () => {
    it('lists a gym template by weekday, then time, then trainer', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const add = (
        weekday: number,
        trainingTimeId: string,
        trainerId: string,
      ) =>
        svc(fx).addTemplateSlot(s.gym.id, {
          weekday,
          trainingTimeId,
          trainerId,
        });
      await add(2, s.morning.id, s.velcho.id);
      await add(1, s.evening.id, s.vasko.id);
      await add(1, s.morning.id, s.velcho.id);
      await add(1, s.morning.id, s.vasko.id);

      const template = await svc(fx).template(s.gym.id);

      expect(template.gym).toEqual({ id: s.gym.id, name: 'Center' });
      expect(template.slots.map(line)).toEqual([
        '1 07:10:00 Vasko',
        '1 07:10:00 Velcho',
        '1 17:00:00 Vasko',
        '2 07:10:00 Velcho',
      ]);
      expect(template.slots[0]).toMatchObject({
        weekday: 1,
        trainingTime: {
          id: s.morning.id,
          startTime: '07:10:00',
          endTime: '08:10:00',
        },
        trainer: { id: s.vasko.id, name: 'Vasko', isActive: true },
      });
    });

    it('keeps each gym template apart', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const other = await fx.location('North');
      await svc(fx).addTemplateSlot(other.id, {
        weekday: 1,
        trainingTimeId: s.morning.id,
        trainerId: s.velcho.id,
      });

      expect((await svc(fx).template(s.gym.id)).slots).toEqual([]);
      expect((await svc(fx).template(other.id)).slots).toHaveLength(1);
    });

    it('reuses a training time with the same hours, and creates one that does not exist', async () => {
      const fx = fixtures();
      const s = await setup(fx);

      const reused = await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 1,
        trainingTime: { startTime: '07:10', endTime: '08:10' },
        trainerId: s.velcho.id,
      });
      const created = await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 1,
        trainingTime: { startTime: '12:30', endTime: '13:30' },
        trainerId: s.vasko.id,
      });

      expect(reused.trainingTime.id).toBe(s.morning.id);
      expect(created.trainingTime).toMatchObject({
        startTime: '12:30:00',
        endTime: '13:30:00',
      });
      expect(await times(fx).count()).toBe(3);
    });

    it.each([
      ['no training time', {}, 'Send trainingTimeId or trainingTime'],
      [
        'both forms of training time',
        {
          trainingTimeId: 'MORNING',
          trainingTime: { startTime: '09:00', endTime: '10:00' },
        },
        'Send either trainingTimeId or trainingTime, not both',
      ],
      [
        'an end before the start',
        { trainingTime: { startTime: '10:00', endTime: '09:00' } },
        'endTime must be after startTime',
      ],
      [
        'an unknown training time',
        { trainingTimeId: UNKNOWN_ID },
        'Unknown training time',
      ],
    ])('refuses %s (400) and saves nothing', async (_, fields, message) => {
      const fx = fixtures();
      const s = await setup(fx);
      const body = { ...fields } as Record<string, unknown>;
      if (body.trainingTimeId === 'MORNING') body.trainingTimeId = s.morning.id;

      const error = await rejectionOf(
        svc(fx).addTemplateSlot(s.gym.id, {
          weekday: 1,
          trainerId: s.velcho.id,
          ...body,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(message);
      expect(
        await fx.ds.getRepository(ScheduleTemplateSlotEntity).count(),
      ).toBe(0);
      expect(await times(fx).count()).toBe(2);
    });

    it('refuses an unknown or inactive trainer, and creates no training time for it', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const retired = await fx.trainer('Retired', { isActive: false });
      const attempt = (trainerId: string) =>
        rejectionOf(
          svc(fx).addTemplateSlot(s.gym.id, {
            weekday: 1,
            trainingTime: { startTime: '20:00', endTime: '21:00' },
            trainerId,
          }),
        );

      expect((await attempt(UNKNOWN_ID)).message).toBe('Unknown trainer');
      expect((await attempt(retired.id)).message).toBe('Trainer is inactive');
      expect(await times(fx).count()).toBe(2);
    });

    it('404s for an unknown gym', async () => {
      const fx = fixtures();
      expect(await rejectionOf(svc(fx).template(UNKNOWN_ID))).toBeInstanceOf(
        NotFoundException,
      );
    });

    it('changes the fields sent, and deletes a slot', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const slot = await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 1,
        trainingTimeId: s.morning.id,
        trainerId: s.velcho.id,
      });

      const moved = await svc(fx).updateTemplateSlot(slot.id, { weekday: 3 });
      expect(line(moved)).toBe('3 07:10:00 Velcho');
      const changed = await svc(fx).updateTemplateSlot(slot.id, {
        trainerId: s.vasko.id,
        trainingTimeId: s.evening.id,
      });
      expect(line(changed)).toBe('3 17:00:00 Vasko');

      await svc(fx).deleteTemplateSlot(slot.id);
      expect((await svc(fx).template(s.gym.id)).slots).toEqual([]);
      expect(
        await rejectionOf(svc(fx).deleteTemplateSlot(slot.id)),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('weeks', () => {
    async function withTemplate(fx: Fixtures) {
      const s = await setup(fx);
      const add = (
        weekday: number,
        trainingTimeId: string,
        trainerId: string,
      ) =>
        svc(fx).addTemplateSlot(s.gym.id, {
          weekday,
          trainingTimeId,
          trainerId,
        });
      await add(1, s.morning.id, s.velcho.id);
      await add(5, s.evening.id, s.vasko.id);
      await add(5, s.morning.id, s.velcho.id);
      await add(7, s.morning.id, s.vasko.id);
      return s;
    }

    it('shows a week not created yet as empty, with its dates and the first editable day', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);

      expect(await svc(fx).week({ gymId: s.gym.id })).toEqual({
        gym: { id: s.gym.id, name: 'Center' },
        weekStart: '2026-11-09',
        weekEnd: '2026-11-15',
        editableFrom: '2026-11-13',
        week: null,
        slots: [],
      });
      expect(
        (await svc(fx).week({ gymId: s.gym.id, week: '2026-11-18' })).weekStart,
      ).toBe('2026-11-16');
    });

    it('creates the week from the template, past days included, in reading order', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);

      const week = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-12' },
        null,
      );

      expect(week.week).toMatchObject({ status: 'DRAFT', publishedAt: null });
      expect(week.slots.map(line)).toEqual([
        '2026-11-09 07:10:00 Velcho',
        '2026-11-13 07:10:00 Velcho',
        '2026-11-13 17:00:00 Vasko',
        '2026-11-15 07:10:00 Vasko',
      ]);
      expect(week.slots[0]).toMatchObject({ weekday: 1, workout: null });
      expect(
        await svc(fx).week({ gymId: s.gym.id, week: '2026-11-15' }),
      ).toEqual(week);
    });

    it("puts a day's only workout on its trainings; a day with several workouts gets none", async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      const workouts = fx.moduleRef.get(WorkoutsService);
      const monday = await workouts.create(
        { date: '2026-11-16', title: 'Helen', summary: 'Run' },
        null,
      );
      await workouts.create(
        { date: '2026-11-20', title: 'Regular', summary: 'A' },
        null,
      );
      await workouts.create(
        { date: '2026-11-20', title: 'Competitors', summary: 'B' },
        null,
      );
      // The next Monday's workout belongs to another week.
      await workouts.create(
        { date: '2026-11-23', title: 'Next week', summary: 'C' },
        null,
      );

      const week = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-16' },
        null,
      );

      expect(
        week.slots.map((slot) => [slot.date, slot.workout?.title ?? '-']),
      ).toEqual([
        ['2026-11-16', 'Helen'],
        ['2026-11-20', '-'],
        ['2026-11-20', '-'],
        ['2026-11-22', '-'],
      ]);
      expect(week.slots[0].workout).toEqual({ id: monday.id, title: 'Helen' });
    });

    it('refuses to create a week twice (409)', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      await svc(fx).createWeek({ gymId: s.gym.id, week: '2026-11-16' }, null);

      const error = await rejectionOf(
        svc(fx).createWeek({ gymId: s.gym.id, week: '2026-11-20' }, null),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe('This week has already been created');
    });

    it('refuses a week that is over, and a gym without a template', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      const bare = await fx.location('Bare');

      const over = await rejectionOf(
        svc(fx).createWeek({ gymId: s.gym.id, week: '2026-11-08' }, null),
      );
      const empty = await rejectionOf(
        svc(fx).createWeek({ gymId: bare.id, week: '2026-11-16' }, null),
      );

      expect(over.message).toBe('This week is over');
      expect(empty.message).toBe('This gym has no schedule template yet');
      expect(
        (await svc(fx).week({ gymId: bare.id, week: '2026-11-16' })).week,
      ).toBeNull();
    });

    it('can still create the current week on its Sunday', async () => {
      freezeTime('2026-11-15T20:00:00Z');
      const fx = fixtures();
      const s = await withTemplate(fx);

      const week = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-09' },
        null,
      );

      expect(week.slots).toHaveLength(4);
    });

    it('publishes a draft week once, and stamps when and by whom', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      const adminId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
      const draft = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-16' },
        null,
      );

      const published = await svc(fx).publishWeek(draft.week!.id, adminId);

      expect(published.week).toEqual({
        id: draft.week!.id,
        createdAt: draft.week!.createdAt,
        status: 'PUBLISHED',
        publishedAt: new Date(NOW),
      });
      expect(published.slots).toEqual(draft.slots);
      const row = await fx.ds
        .getRepository(ScheduleWeekEntity)
        .findOneByOrFail({ id: draft.week!.id });
      expect(row.publishedByAccountId).toBe(adminId);

      const again = await rejectionOf(
        svc(fx).publishWeek(draft.week!.id, null),
      );
      expect(again).toBeInstanceOf(ConflictException);
      expect(again.message).toBe('This week is already published');
      const unknown = await rejectionOf(svc(fx).publishWeek(UNKNOWN_ID, null));
      expect(unknown).toBeInstanceOf(NotFoundException);
    });

    it('discards a draft week with its trainings, so it can be created again; never a published one', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      const draft = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-16' },
        null,
      );

      expect(await svc(fx).deleteWeek(draft.week!.id)).toEqual({
        deleted: true,
      });

      const gone = await svc(fx).week({ gymId: s.gym.id, week: '2026-11-16' });
      expect(gone.week).toBeNull();
      expect(
        await fx.ds
          .getRepository(ScheduleSlotEntity)
          .countBy({ weekId: draft.week!.id }),
      ).toBe(0);
      const again = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-16' },
        null,
      );
      await svc(fx).publishWeek(again.week!.id, null);

      const refused = await rejectionOf(svc(fx).deleteWeek(again.week!.id));
      expect(refused).toBeInstanceOf(ConflictException);
      expect(refused.message).toBe(
        'A published week cannot be discarded, only changed',
      );
      expect(
        (await svc(fx).week({ gymId: s.gym.id, week: '2026-11-16' })).slots,
      ).toHaveLength(4);
      const unknown = await rejectionOf(svc(fx).deleteWeek(UNKNOWN_ID));
      expect(unknown).toBeInstanceOf(NotFoundException);
    });

    it('keeps the week and the template independent of each other', async () => {
      freezeTime(NOW);
      const fx = fixtures();
      const s = await withTemplate(fx);
      const week = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-16' },
        null,
      );
      const template = await svc(fx).template(s.gym.id);

      await svc(fx).deleteTemplateSlot(template.slots[0].id);
      await svc(fx).deleteSlot(week.slots[3].id);

      expect(
        (await svc(fx).week({ gymId: s.gym.id, week: '2026-11-16' })).slots.map(
          line,
        ),
      ).toEqual([
        '2026-11-16 07:10:00 Velcho',
        '2026-11-20 07:10:00 Velcho',
        '2026-11-20 17:00:00 Vasko',
      ]);
      expect((await svc(fx).template(s.gym.id)).slots.map(line)).toEqual([
        '5 07:10:00 Velcho',
        '5 17:00:00 Vasko',
        '7 07:10:00 Vasko',
      ]);
    });
  });

  describe('week slots', () => {
    async function createdWeek(fx: Fixtures) {
      freezeTime(NOW);
      const s = await setup(fx);
      await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 4,
        trainingTimeId: s.morning.id,
        trainerId: s.velcho.id,
      });
      await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 5,
        trainingTimeId: s.morning.id,
        trainerId: s.velcho.id,
      });
      const week = await svc(fx).createWeek(
        { gymId: s.gym.id, week: '2026-11-12' },
        null,
      );
      const [today, tomorrow] = week.slots;
      return { ...s, weekId: week.week!.id, today, tomorrow };
    }

    it('adds a training from tomorrow on, with a new training time and a workout of that day', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const workout = await fx.moduleRef
        .get(WorkoutsService)
        .create({ date: '2026-11-14', title: 'Helen', summary: 'Run' }, null);

      const added = await svc(fx).addSlot(s.weekId, {
        date: '2026-11-14',
        trainingTime: { startTime: '12:30', endTime: '13:30' },
        trainerId: s.vasko.id,
        workoutId: workout.id,
      });

      expect(added).toMatchObject({
        date: '2026-11-14',
        weekday: 6,
        trainingTime: { startTime: '12:30:00' },
        trainer: { id: s.vasko.id },
        workout: { id: workout.id, title: 'Helen' },
      });
      expect(await times(fx).count()).toBe(3);
    });

    it.each([
      [
        'today',
        '2026-11-12',
        'Trainings of today and earlier days can no longer be changed',
      ],
      [
        'an earlier day',
        '2026-11-10',
        'Trainings of today and earlier days can no longer be changed',
      ],
      ['a day of another week', '2026-11-16', 'The day must be in this week'],
    ])('refuses a training on %s', async (_, date, message) => {
      const fx = fixtures();
      const s = await createdWeek(fx);

      const error = await rejectionOf(
        svc(fx).addSlot(s.weekId, {
          date,
          trainingTimeId: s.evening.id,
          trainerId: s.vasko.id,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(message);
    });

    it('allows two trainings at the same time with different trainers', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);

      await svc(fx).addSlot(s.weekId, {
        date: '2026-11-13',
        trainingTimeId: s.morning.id,
        trainerId: s.vasko.id,
      });

      expect((await svc(fx).week({ gymId: s.gym.id })).slots.map(line)).toEqual(
        [
          '2026-11-12 07:10:00 Velcho',
          '2026-11-13 07:10:00 Vasko',
          '2026-11-13 07:10:00 Velcho',
        ],
      );
    });

    it('changes the trainer, time and workout of a later training; null removes the workout', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const workout = await fx.moduleRef
        .get(WorkoutsService)
        .create({ date: '2026-11-13', summary: 'Squats' }, null);

      const changed = await svc(fx).updateSlot(s.tomorrow.id, {
        trainerId: s.vasko.id,
        trainingTimeId: s.evening.id,
        workoutId: workout.id,
      });
      expect(line(changed)).toBe('2026-11-13 17:00:00 Vasko');
      expect(changed.workout).toEqual({ id: workout.id, title: null });

      const cleared = await svc(fx).updateSlot(s.tomorrow.id, {
        workoutId: null,
      });
      expect(cleared.workout).toBeNull();
      expect(line(cleared)).toBe('2026-11-13 17:00:00 Vasko');
    });

    it('refuses a workout of another day', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const other = await fx.moduleRef
        .get(WorkoutsService)
        .create({ date: '2026-11-14', summary: 'Squats' }, null);

      const error = await rejectionOf(
        svc(fx).updateSlot(s.tomorrow.id, { workoutId: other.id }),
      );

      expect(error.message).toBe("The workout must be on the training's day");
    });

    it('drops the workout from a training when the workout is deleted', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const workouts = fx.moduleRef.get(WorkoutsService);
      const workout = await workouts.create(
        { date: '2026-11-13', summary: 'Squats' },
        null,
      );
      await svc(fx).updateSlot(s.tomorrow.id, { workoutId: workout.id });

      await workouts.delete(workout.id);

      const week = await svc(fx).week({ gymId: s.gym.id });
      expect(week.slots[1]).toMatchObject({ id: s.tomorrow.id, workout: null });
    });

    it("keeps today's trainings read-only, and removes a later one", async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);

      const change = await rejectionOf(
        svc(fx).updateSlot(s.today.id, { trainerId: s.vasko.id }),
      );
      const remove = await rejectionOf(svc(fx).deleteSlot(s.today.id));
      await svc(fx).deleteSlot(s.tomorrow.id);

      expect(change.message).toBe(
        'Trainings of today and earlier days can no longer be changed',
      );
      expect(remove).toBeInstanceOf(BadRequestException);
      expect((await svc(fx).week({ gymId: s.gym.id })).slots.map(line)).toEqual(
        ['2026-11-12 07:10:00 Velcho'],
      );
    });

    it('a workout moved to another day leaves the trainings that named it', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const workouts = fx.moduleRef.get(WorkoutsService);
      const workout = await workouts.create(
        { date: '2026-11-13', title: 'Helen', summary: 'Run' },
        null,
      );
      await svc(fx).updateSlot(s.tomorrow.id, { workoutId: workout.id });

      // Other changes, and the same day, keep the link.
      await workouts.update(workout.id, { title: 'Fran', date: '2026-11-13' });
      expect(
        (await svc(fx).week({ gymId: s.gym.id })).slots[1].workout,
      ).toEqual({
        id: workout.id,
        title: 'Fran',
      });

      await workouts.update(workout.id, { date: '2026-11-14' });
      expect((await svc(fx).week({ gymId: s.gym.id })).slots[1]).toMatchObject({
        id: s.tomorrow.id,
        workout: null,
      });
    });

    it("a training time a schedule uses keeps its hours (409); one that isn't used can change", async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);
      const trainingTimes = fx.moduleRef.get(TrainingTimesService);

      const error = await rejectionOf(
        trainingTimes.update(s.morning.id, { startTime: '07:00' }),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'This training time is used in a schedule, so its hours cannot change; add a new training time instead',
      );
      expect(
        (await svc(fx).week({ gymId: s.gym.id })).slots[0].trainingTime,
      ).toMatchObject({
        startTime: '07:10:00',
      });
      // Sending the same hours changes nothing and is fine.
      await trainingTimes.update(s.morning.id, {
        startTime: '07:10',
        endTime: '08:10',
      });

      const changed = await trainingTimes.update(s.evening.id, {
        startTime: '16:30',
      });
      expect(changed.startTime).toBe('16:30');
    });

    it('a training time only a template uses keeps its hours too', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      await svc(fx).addTemplateSlot(s.gym.id, {
        weekday: 1,
        trainingTimeId: s.evening.id,
        trainerId: s.velcho.id,
      });

      const error = await rejectionOf(
        fx.moduleRef
          .get(TrainingTimesService)
          .update(s.evening.id, { endTime: '18:30' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
    });

    it('a training time a schedule uses cannot be deleted (409)', async () => {
      const fx = fixtures();
      const s = await createdWeek(fx);

      const error = await rejectionOf(
        fx.moduleRef.get(TrainingTimesService).delete(s.morning.id),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(await times(fx).count()).toBe(2);
      await fx.moduleRef.get(TrainingTimesService).delete(s.evening.id);
      expect(await times(fx).count()).toBe(1);
    });
  });
});
