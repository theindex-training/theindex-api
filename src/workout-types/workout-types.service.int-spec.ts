import { ConflictException, NotFoundException } from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ExerciseMeasure, ExerciseModality } from '../exercises/exercise.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutLevel } from '../workouts/workout.enums';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import { WorkoutTypeEntity } from './workout-type.entity';
import { ScoreType, WorkoutTypeCode } from './workout-type.enums';
import { WorkoutTypesService } from './workout-types.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

describe('WorkoutTypesService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [WorkoutsModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(WorkoutTypesService);
  const names = async (fx: Fixtures) =>
    (await svc(fx).list()).map((t) => t.name);

  describe('seedSystemTypes', () => {
    it('adds the built-in types with their scores, once', async () => {
      const fx = fixtures();

      await svc(fx).seedSystemTypes();
      await svc(fx).seedSystemTypes();

      expect(
        (await svc(fx).list()).map((t) => [t.code, t.name, t.scoreType]),
      ).toEqual([
        ['FOR_TIME', 'For time', 'TIME'],
        ['AMRAP', 'AMRAP', 'ROUNDS_REPS'],
        ['EMOM', 'EMOM', 'NONE'],
        ['TABATA', 'Tabata', 'REPS'],
        ['FOR_LOAD', 'For load', 'LOAD'],
        ['QUALITY', 'For quality', 'NONE'],
      ]);
    });

    it('keeps a renamed built-in type and restores only a missing one', async () => {
      const fx = fixtures();
      await svc(fx).seedSystemTypes();
      const types = await svc(fx).byCode();
      await svc(fx).update(types.get(WorkoutTypeCode.FOR_TIME)!.id, {
        name: 'За време',
        description: 'Възможно най-бързо.',
      });
      await fx.ds
        .getRepository(WorkoutTypeEntity)
        .delete({ code: WorkoutTypeCode.TABATA });

      await svc(fx).seedSystemTypes();

      expect(await names(fx)).toEqual([
        'За време',
        'AMRAP',
        'EMOM',
        'Tabata',
        'For load',
        'For quality',
      ]);
    });

    it('steps aside when a trainer’s own type already has a built-in name', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'tabata' });

      await svc(fx).seedSystemTypes();

      expect((await svc(fx).byCode()).get(WorkoutTypeCode.TABATA)!.name).toBe(
        'Tabata (2)',
      );
    });
  });

  describe('create / update', () => {
    it('stores a type of the trainers’ own after the built-in ones, by name', async () => {
      const fx = fixtures();
      await svc(fx).seedSystemTypes();

      const chipper = await svc(fx).create({
        name: 'Chipper',
        description: 'One long list, once through.',
        scoreType: ScoreType.TIME,
      });
      await svc(fx).create({ name: 'Buy-in' });

      expect(chipper).toMatchObject({
        name: 'Chipper',
        description: 'One long list, once through.',
        scoreType: ScoreType.TIME,
        code: null,
      });
      expect((await names(fx)).slice(6)).toEqual(['Buy-in', 'Chipper']);
      expect((await svc(fx).list())[6].scoreType).toBe(ScoreType.NONE);
    });

    it('refuses a name in use, ignoring case (409)', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Chipper' });
      const other = await svc(fx).create({ name: 'Ladder' });

      const created = await rejectionOf(svc(fx).create({ name: 'CHIPPER' }));
      expect(created).toBeInstanceOf(ConflictException);
      expect(created.message).toBe(
        'A workout type named "CHIPPER" already exists',
      );
      expect(
        await rejectionOf(svc(fx).update(other.id, { name: 'chipper' })),
      ).toBeInstanceOf(ConflictException);
      // Its own name in another case is fine.
      expect((await svc(fx).update(other.id, { name: 'LADDER' })).name).toBe(
        'LADDER',
      );
    });

    it('clears the description with an empty one and leaves unsent fields alone', async () => {
      const fx = fixtures();
      const type = await svc(fx).create({
        name: 'Chipper',
        description: 'Long.',
        scoreType: ScoreType.TIME,
      });

      expect(await svc(fx).update(type.id, { description: '' })).toMatchObject({
        name: 'Chipper',
        description: null,
        scoreType: ScoreType.TIME,
      });
      expect(
        await rejectionOf(svc(fx).update(UNKNOWN_ID, { name: 'X' })),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an unused type of the trainers’ own', async () => {
      const fx = fixtures();
      const type = await svc(fx).create({ name: 'Chipper' });

      expect(await svc(fx).delete(type.id)).toEqual({ deleted: true });
      expect(await names(fx)).toEqual([]);
    });

    it('refuses to delete a built-in type (409)', async () => {
      const fx = fixtures();
      await svc(fx).seedSystemTypes();
      const amrap = (await svc(fx).byCode()).get(WorkoutTypeCode.AMRAP)!;

      const error = await rejectionOf(svc(fx).delete(amrap.id));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        '"AMRAP" is a built-in workout type and can\'t be deleted',
      );
    });

    it('refuses to delete a type a workout uses (409)', async () => {
      const fx = fixtures();
      const type = await svc(fx).create({ name: 'Chipper' });
      const burpee = await fx.moduleRef
        .get(ExercisesService)
        .create({ name: 'Burpee', modality: ExerciseModality.GYMNASTICS });
      await fx.moduleRef.get(WorkoutsService).create(
        {
          date: '2026-11-09',
          parts: [
            {
              workoutTypeId: type.id,
              variants: [
                {
                  level: WorkoutLevel.RX,
                  items: [
                    {
                      exerciseId: burpee.id,
                      measure: ExerciseMeasure.REPS,
                      quantity: 100,
                    },
                  ],
                },
              ],
            },
          ],
        },
        null,
      );

      const error = await rejectionOf(svc(fx).delete(type.id));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        '"Chipper" is used in workouts and can\'t be deleted',
      );
    });
  });
});
