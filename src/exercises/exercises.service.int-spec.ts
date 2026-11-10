import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { WorkoutTypesService } from '../workout-types/workout-types.service';
import { WorkoutsModule } from '../workouts/workouts.module';
import { WorkoutsService } from '../workouts/workouts.service';
import { WorkoutLevel } from '../workouts/workout.enums';
import { exerciseKey } from './exercise-key';
import { EXERCISE_LIBRARY } from './exercise-library';
import { ExerciseEntity } from './exercise.entity';
import { ExerciseMeasure, ExerciseModality } from './exercise.enums';
import { ExercisesService } from './exercises.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
const { GYMNASTICS, WEIGHTLIFTING } = ExerciseModality;

describe('ExercisesService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [WorkoutsModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(ExercisesService);
  const count = (fx: Fixtures) => fx.ds.getRepository(ExerciseEntity).count();

  describe('create', () => {
    it('stores the exercise with defaults and never returns the internal keys', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        name: 'Kettlebell swing',
        aliases: ['American swing'],
        modality: WEIGHTLIFTING,
      });

      expect(created).toMatchObject({
        name: 'Kettlebell swing',
        aliases: ['American swing'],
        modality: WEIGHTLIFTING,
        defaultMeasure: ExerciseMeasure.REPS,
        isActive: true,
      });
      const sent = JSON.parse(JSON.stringify(created)) as object;
      expect(sent).not.toHaveProperty('nameKey');
      expect(sent).not.toHaveProperty('aliasKeys');
    });

    it('refuses a name that is another spelling of an existing exercise (409)', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Pull-up', modality: GYMNASTICS });

      for (const name of ['pull up', 'PULL-UPS', 'Pull-Up']) {
        const error = await rejectionOf(
          svc(fx).create({ name, modality: GYMNASTICS }),
        );
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(
          `"${name}" is already the exercise "Pull-up"`,
        );
      }
      expect(await count(fx)).toBe(1);
    });

    it('refuses a name or alias that another exercise answers to, in either direction', async () => {
      const fx = fixtures();
      await svc(fx).create({
        name: 'Kettlebell swing',
        aliases: ['American swing'],
        modality: WEIGHTLIFTING,
      });

      // "KB swings" is the same key as the name "Kettlebell swing".
      expect(
        (
          await rejectionOf(
            svc(fx).create({
              name: 'Russian swing',
              aliases: ['KB swings'],
              modality: WEIGHTLIFTING,
            }),
          )
        ).message,
      ).toBe('"KB swings" is already the exercise "Kettlebell swing"');
      // A new name that is the other one's alias.
      expect(
        (
          await rejectionOf(
            svc(fx).create({
              name: 'American swings',
              modality: WEIGHTLIFTING,
            }),
          )
        ).message,
      ).toBe('"American swings" is already the exercise "Kettlebell swing"');
      expect(await count(fx)).toBe(1);
    });

    it('drops aliases that repeat the name or each other', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        name: 'Toes-to-bar',
        aliases: ['T2B', 'toes to bars', 'TTB', 'Toes 2 bar'],
        modality: GYMNASTICS,
      });

      expect(created.aliases).toEqual(['Toes 2 bar']);
    });

    it('stores a description and a YouTube link in one form, both optional', async () => {
      const fx = fixtures();

      const plain = await svc(fx).create({
        name: 'Burpee',
        modality: GYMNASTICS,
      });
      const full = await svc(fx).create({
        name: 'Air squat',
        modality: GYMNASTICS,
        description: 'Hips back and down, below the knees.',
        videoUrl: 'https://youtu.be/rMvwVtlqjTE?si=share',
      });

      expect(plain).toMatchObject({ description: null, videoUrl: null });
      expect(full).toMatchObject({
        description: 'Hips back and down, below the knees.',
        videoUrl: 'https://www.youtube.com/watch?v=rMvwVtlqjTE',
      });
    });

    it('refuses a video link that is not a YouTube video (400) and saves nothing', async () => {
      const fx = fixtures();

      const error = await rejectionOf(
        svc(fx).create({
          name: 'Air squat',
          modality: GYMNASTICS,
          videoUrl: 'https://www.crossfit.com/essentials/the-air-squat',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'videoUrl must be a link to a YouTube video, e.g. https://www.youtube.com/watch?v=rMvwVtlqjTE',
      );
      expect(await count(fx)).toBe(0);
    });

    it('refuses a name without letters or digits (400)', async () => {
      const fx = fixtures();

      const error = await rejectionOf(
        svc(fx).create({ name: '---', modality: GYMNASTICS }),
      );

      expect(error.message).toBe('name must contain letters or digits');
    });
  });

  describe('list', () => {
    it('orders by name and filters by status and by part of a name or alias', async () => {
      const fx = fixtures();
      await svc(fx).create({
        name: 'Run',
        modality: ExerciseModality.MONOSTRUCTURAL,
      });
      await svc(fx).create({
        name: 'Kettlebell swing',
        aliases: ['American swing'],
        modality: WEIGHTLIFTING,
      });
      await svc(fx).create({
        name: 'Air squat',
        modality: GYMNASTICS,
        isActive: false,
      });
      const names = async (q: object) =>
        (await svc(fx).list(q)).map((e) => e.name);

      expect(await names({})).toEqual(['Air squat', 'Kettlebell swing', 'Run']);
      expect(await names({ active: 'true' })).toEqual([
        'Kettlebell swing',
        'Run',
      ]);
      expect(await names({ active: 'false' })).toEqual(['Air squat']);
      expect(await names({ q: 'SWING' })).toEqual(['Kettlebell swing']);
      expect(await names({ q: 'americ' })).toEqual(['Kettlebell swing']);
      // Wildcards are text, not patterns.
      expect(await names({ q: '%' })).toEqual([]);
    });
  });

  describe('update', () => {
    it('changes the sent fields only, and lets an exercise keep its own name', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({
        name: 'Pull-up',
        aliases: ['Kipping pull-up'],
        modality: GYMNASTICS,
      });

      const renamed = await svc(fx).update(created.id, { name: 'Pull-ups' });
      expect(renamed).toMatchObject({
        name: 'Pull-ups',
        aliases: ['Kipping pull-up'],
        isActive: true,
      });

      const hidden = await svc(fx).update(created.id, { isActive: false });
      expect(hidden).toMatchObject({ name: 'Pull-ups', isActive: false });
    });

    it('changes or removes the description and the video, and leaves them alone when not sent', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({
        name: 'Air squat',
        modality: GYMNASTICS,
        description: 'Old text.',
        videoUrl: 'https://www.youtube.com/watch?v=rMvwVtlqjTE',
      });

      expect(
        await svc(fx).update(created.id, { isActive: false }),
      ).toMatchObject({
        description: 'Old text.',
        videoUrl: 'https://www.youtube.com/watch?v=rMvwVtlqjTE',
      });
      expect(
        await svc(fx).update(created.id, {
          description: 'New text.',
          videoUrl: 'https://www.youtube.com/embed/_-9_46by2JI',
        }),
      ).toMatchObject({
        description: 'New text.',
        videoUrl: 'https://www.youtube.com/watch?v=_-9_46by2JI',
      });
      expect(
        await svc(fx).update(created.id, { description: '', videoUrl: null }),
      ).toMatchObject({ description: null, videoUrl: null });

      const error = await rejectionOf(
        svc(fx).update(created.id, { videoUrl: 'https://vimeo.com/1' }),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect((await svc(fx).get(created.id)).videoUrl).toBeNull();
    });

    it('refuses a spelling another exercise has (409) and an unknown id (404)', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Pull-up', modality: GYMNASTICS });
      const other = await svc(fx).create({
        name: 'Ring row',
        modality: GYMNASTICS,
      });

      expect(
        await rejectionOf(svc(fx).update(other.id, { aliases: ['pull ups'] })),
      ).toBeInstanceOf(ConflictException);
      expect((await svc(fx).get(other.id)).aliases).toEqual([]);
      expect(
        await rejectionOf(svc(fx).update(UNKNOWN_ID, { name: 'X' })),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an unused exercise', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({
        name: 'Burpee',
        modality: GYMNASTICS,
      });

      expect(await svc(fx).delete(created.id)).toEqual({ deleted: true });
      expect(await count(fx)).toBe(0);
    });

    it('refuses to delete an exercise a workout uses (409); it can be made inactive', async () => {
      const fx = fixtures();
      const burpee = await svc(fx).create({
        name: 'Burpee',
        modality: GYMNASTICS,
      });
      await fx.moduleRef.get(WorkoutTypesService).seedSystemTypes();
      const [forTime] = await fx.moduleRef.get(WorkoutTypesService).list();
      await fx.moduleRef.get(WorkoutsService).create(
        {
          date: '2026-11-09',
          parts: [
            {
              workoutTypeId: forTime.id,
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

      const error = await rejectionOf(svc(fx).delete(burpee.id));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        '"Burpee" is used in workouts and can\'t be deleted. Make it inactive instead.',
      );
      expect(
        (await svc(fx).update(burpee.id, { isActive: false })).isActive,
      ).toBe(false);
    });
  });

  describe('findByKeys', () => {
    it('finds an exercise by its name or an alias, the name first', async () => {
      const fx = fixtures();
      const swing = await svc(fx).create({
        name: 'Kettlebell swing',
        aliases: ['American swing'],
        modality: WEIGHTLIFTING,
      });
      const squat = await svc(fx).create({
        name: 'Air squat',
        aliases: ['Squat'],
        modality: GYMNASTICS,
      });

      const found = await svc(fx).findByKeys(
        ['KB swings', 'american swings', 'squats', 'Thrusters', ''].map(
          exerciseKey,
        ),
      );

      expect([...found].map(([key, e]) => [key, e.id])).toEqual([
        ['kettlebell swing', swing.id],
        ['american swing', swing.id],
        ['squat', squat.id],
      ]);
    });
  });

  describe('seedLibrary', () => {
    it('adds the starter library once, and never on top of existing exercises', async () => {
      const fx = fixtures();
      const size = Object.values(EXERCISE_LIBRARY).flat().length;

      expect(await svc(fx).seedLibrary()).toBe(size);
      expect(await svc(fx).seedLibrary()).toBe(0);
      expect(await count(fx)).toBe(size);

      await fx.ds.getRepository(ExerciseEntity).deleteAll();
      await svc(fx).create({ name: 'My only move', modality: GYMNASTICS });
      expect(await svc(fx).seedLibrary()).toBe(0);
      expect(await count(fx)).toBe(1);
    });

    it('stores the videos of the crossfit.com movements, and no descriptions', async () => {
      const fx = fixtures();
      await svc(fx).seedLibrary();
      const byName = new Map((await svc(fx).list()).map((e) => [e.name, e]));

      expect(byName.get('Air Squat')).toMatchObject({
        modality: GYMNASTICS,
        defaultMeasure: ExerciseMeasure.REPS,
        aliases: ['Squat'],
        videoUrl: 'https://www.youtube.com/watch?v=rMvwVtlqjTE',
        description: null,
      });
      expect(byName.get('Burpee')?.videoUrl).toBe(
        'https://www.youtube.com/watch?v=auBLPXO8Fww',
      );
      expect(byName.get('Run')).toMatchObject({
        defaultMeasure: ExerciseMeasure.DISTANCE,
        videoUrl: null,
      });
      const withVideo = [...byName.values()].filter((e) => e.videoUrl);
      expect(withVideo).toHaveLength(118);
      expect([...byName.values()].every((e) => e.description === null)).toBe(
        true,
      );
    });

    it('the spellings the lesson plans use find their movement', async () => {
      const fx = fixtures();
      await svc(fx).seedLibrary();
      const spellings = {
        'Pull-ups': 'Kipping Pull-up',
        'KB swings': 'Kettlebell Swing',
        'Russian KB swings': 'Russian kettlebell swing',
        'ring muscle-ups': 'Kipping Muscle-up',
        'sit-ups': 'AbMat Sit-up',
        'squat snatches': 'Snatch',
        'skin-the-cats': 'Skin the Cat',
        'ring rows': 'Ring Row',
        Run: 'Run',
        bike: 'Bike',
        'wall balls': 'Wall-ball Shot',
        T2B: 'Kipping Toes-to-bar',
        HSPU: 'Kipping Handstand Push-up',
        Pistols: 'Single-leg Squat (Pistol)',
        'Push-ups from the knees': 'Knee push-up',
      };

      const found = await svc(fx).findByKeys(
        Object.keys(spellings).map(exerciseKey),
      );

      expect(
        Object.fromEntries(
          Object.keys(spellings).map((s) => [
            s,
            found.get(exerciseKey(s))?.name,
          ]),
        ),
      ).toEqual(spellings);
    });
  });
});
