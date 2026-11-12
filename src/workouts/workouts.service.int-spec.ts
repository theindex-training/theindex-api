import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { lessonPlanPdf, pdfWithText } from '../../test/int/pdf-fixture';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ExerciseEntity } from '../exercises/exercise.entity';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutImportService } from './import/workout-import.service';
import { WorkoutExerciseEntity } from './workout.entity';
import { WorkoutsModule } from './workouts.module';
import { WorkoutsService } from './workouts.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
const HELEN = '3 rounds for time:\n400-m run\n21 KB swings\n12 pull-ups';

describe('WorkoutsService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [WorkoutsModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(WorkoutsService);

  /** A few exercises, by name. */
  async function catalogue(fx: Fixtures) {
    const exercises = fx.moduleRef.get(ExercisesService);
    const add = (name: string, extra: object = {}) =>
      exercises.create({ name, ...extra });
    return {
      run: await add('Run'),
      swing: await add('Kettlebell swing', {
        videoUrl: 'https://youtu.be/mKDIuUbH94Q',
      }),
      pullUp: await add('Pull-up', { aliases: ['Kipping pull-up'] }),
    };
  }

  describe('create / get', () => {
    it('stores the day, name, summary and exercises in order, and returns them with names and videos', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const created = await svc(fx).create(
        {
          date: '2026-11-09',
          title: 'Helen',
          summary: HELEN,
          exerciseIds: [c.run.id, c.swing.id, c.pullUp.id],
        },
        null,
      );

      expect(created).toMatchObject({
        date: '2026-11-09',
        title: 'Helen',
        summary: HELEN,
        exercises: [
          { id: c.run.id, name: 'Run', videoUrl: null, isActive: true },
          {
            id: c.swing.id,
            name: 'Kettlebell swing',
            videoUrl: 'https://www.youtube.com/watch?v=mKDIuUbH94Q',
            isActive: true,
          },
          { id: c.pullUp.id, name: 'Pull-up', videoUrl: null, isActive: true },
        ],
      });
      expect(await svc(fx).get(created.id)).toEqual(created);
    });

    it('takes a workout without exercises and without a name', async () => {
      const fx = fixtures();

      const created = await svc(fx).create(
        { date: '2026-11-09', title: '', summary: 'Mobility' },
        null,
      );

      expect(created).toMatchObject({
        title: null,
        summary: 'Mobility',
        exercises: [],
      });
    });

    it('several workouts may share a day', async () => {
      const fx = fixtures();
      await svc(fx).create(
        { date: '2026-11-09', title: 'Regular', summary: 'A' },
        null,
      );
      await svc(fx).create(
        { date: '2026-11-09', title: 'Competitors', summary: 'B' },
        null,
      );

      expect(
        (await svc(fx).list({ from: '2026-11-09', to: '2026-11-09' })).map(
          (w) => w.title,
        ),
      ).toEqual(['Regular', 'Competitors']);
    });

    it('refuses an unknown exercise (400) and saves nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const error = await rejectionOf(
        svc(fx).create(
          {
            date: '2026-11-09',
            summary: HELEN,
            exerciseIds: [c.run.id, UNKNOWN_ID],
          },
          null,
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Unknown exercise');
      expect(await svc(fx).list()).toEqual([]);
    });

    it('answers 404 for an unknown workout', async () => {
      const fx = fixtures();

      expect(await rejectionOf(svc(fx).get(UNKNOWN_ID))).toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('returns the days of a range, oldest first; without a range the newest first', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      for (const date of [
        '2026-11-10',
        '2026-11-09',
        '2026-11-16',
        '2026-11-12',
      ]) {
        await svc(fx).create(
          { date, summary: HELEN, exerciseIds: [c.pullUp.id, c.run.id] },
          null,
        );
      }
      const dates = async (q: object) =>
        (await svc(fx).list(q)).map((w) => w.date);

      expect(await dates({ from: '2026-11-09', to: '2026-11-15' })).toEqual([
        '2026-11-09',
        '2026-11-10',
        '2026-11-12',
      ]);
      expect(await dates({ from: '2026-11-12' })).toEqual([
        '2026-11-12',
        '2026-11-16',
      ]);
      expect(await dates({ to: '2026-11-09' })).toEqual(['2026-11-09']);
      expect(await dates({})).toEqual([
        '2026-11-16',
        '2026-11-12',
        '2026-11-10',
        '2026-11-09',
      ]);
      // Each one with its exercises in order.
      expect((await svc(fx).list({}))[0].exercises.map((e) => e.name)).toEqual([
        'Pull-up',
        'Run',
      ]);
    });
  });

  describe('update', () => {
    it('changes only the fields sent', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(
        {
          date: '2026-11-09',
          title: 'Helen',
          summary: HELEN,
          exerciseIds: [c.run.id],
        },
        null,
      );

      const updated = await svc(fx).update(created.id, {
        date: '2026-11-10',
        title: '',
      });

      expect(updated).toMatchObject({
        date: '2026-11-10',
        title: null,
        summary: HELEN,
      });
      expect(updated.exercises).toEqual(created.exercises);
    });

    it('replaces the summary and the list of exercises when sent', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(
        {
          date: '2026-11-09',
          summary: HELEN,
          exerciseIds: [c.run.id, c.swing.id],
        },
        null,
      );

      const updated = await svc(fx).update(created.id, {
        summary: 'Fran',
        exerciseIds: [c.pullUp.id, c.run.id],
      });

      expect(updated.summary).toBe('Fran');
      expect(updated.exercises.map((e) => e.name)).toEqual(['Pull-up', 'Run']);
      expect(await fx.ds.getRepository(WorkoutExerciseEntity).count()).toBe(2);

      const cleared = await svc(fx).update(created.id, { exerciseIds: [] });
      expect(cleared.exercises).toEqual([]);
    });

    it('refuses an unknown exercise or workout, changing nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(
        { date: '2026-11-09', summary: HELEN, exerciseIds: [c.run.id] },
        null,
      );

      expect(
        await rejectionOf(
          svc(fx).update(created.id, {
            title: 'X',
            exerciseIds: [UNKNOWN_ID],
          }),
        ),
      ).toBeInstanceOf(BadRequestException);
      expect(
        await rejectionOf(svc(fx).update(UNKNOWN_ID, { title: 'X' })),
      ).toBeInstanceOf(NotFoundException);
      expect(await svc(fx).get(created.id)).toEqual(created);
    });
  });

  describe('delete', () => {
    it('removes the workout and its list, and leaves the exercises', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(
        {
          date: '2026-11-09',
          summary: HELEN,
          exerciseIds: [c.run.id, c.pullUp.id],
        },
        null,
      );

      expect(await svc(fx).delete(created.id)).toEqual({ deleted: true });

      expect(await fx.ds.getRepository(WorkoutExerciseEntity).count()).toBe(0);
      expect(await fx.ds.getRepository(ExerciseEntity).count()).toBe(3);
      expect(await rejectionOf(svc(fx).delete(created.id))).toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('import from a PDF', () => {
    const importer = (fx: Fixtures) => fx.moduleRef.get(WorkoutImportService);
    const file = (buffer: Buffer) => ({
      buffer,
      mimetype: 'application/pdf',
      size: buffer.length,
    });

    it('reads the RX column as the summary and its exercises, matching the catalogue, saving nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const pdf = lessonPlanPdf('261109 // HELEN | TASK PRIORITY', {
        rx: [
          '3 rounds for time:',
          '400-m run',
          '21 KB swings (35/53 lb)',
          '15 wall balls (20/14 lb)',
          '12 pull-ups',
          '- 30-ft handstand walk after',
          'each round.',
        ],
        intermediate: ["Same as Rx'd"],
        beginner: ['3 rounds for time:', '200-m run', '12 ring rows'],
        skill: ['Post-workout skill', 'Accumulate:', '10-15 skin-the-cats'],
      });

      const draft = await importer(fx).fromPdf(file(pdf));

      expect(draft).toEqual({
        sourceCode: '261109',
        date: '2026-11-09',
        title: 'Helen',
        summary:
          '3 rounds for time:\n400-m run\n21 KB swings (35/53 lb)\n15 wall balls (20/14 lb)\n12 pull-ups\n- 30-ft handstand walk after each round.',
        exercises: [
          { name: 'Run', exerciseId: c.run.id, exerciseName: 'Run' },
          // "KB swings" is found under its catalogue name.
          {
            name: 'KB swing',
            exerciseId: c.swing.id,
            exerciseName: 'Kettlebell swing',
          },
          { name: 'Wall ball', exerciseId: null, exerciseName: null },
          { name: 'Pull-up', exerciseId: c.pullUp.id, exerciseName: 'Pull-up' },
          { name: 'Handstand walk', exerciseId: null, exerciseName: null },
        ],
        warnings: [],
      });
      // Only the RX column: no ring rows, no skin-the-cats; nothing saved.
      expect(await svc(fx).list()).toEqual([]);
    });

    it('lists an exercise once when the PDF names it in two ways', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const pdf = lessonPlanPdf('261109 | X', {
        rx: ['For time:', '10 pull-ups', '10 kipping pull-ups'],
        intermediate: [],
        beginner: [],
        skill: [],
      });

      const draft = await importer(fx).fromPdf(file(pdf));

      expect(draft.exercises).toEqual([
        { name: 'Pull-up', exerciseId: c.pullUp.id, exerciseName: 'Pull-up' },
      ]);
    });

    it('warns about a heading without a day and an empty RX column', async () => {
      const fx = fixtures();
      const pdf = lessonPlanPdf('WORKOUT OF THE DAY', {
        rx: [],
        intermediate: [],
        beginner: [],
        skill: ['Rest, stretch, recover.'],
      });

      const draft = await importer(fx).fromPdf(file(pdf));

      expect(draft).toMatchObject({
        date: null,
        summary: '',
        exercises: [],
        warnings: [
          'The date could not be read from the heading',
          'The RX workout could not be read',
        ],
      });
    });

    it('refuses a missing file, a file that is not a PDF, a broken PDF and a PDF without the columns', async () => {
      const fx = fixtures();
      const message = async (
        f: Parameters<WorkoutImportService['fromPdf']>[0],
      ) => {
        const error = await rejectionOf(importer(fx).fromPdf(f));
        expect(error).toBeInstanceOf(BadRequestException);
        return error.message;
      };

      expect(await message(undefined)).toBe(
        'A PDF file is required (field "file")',
      );
      expect(
        await message(file(Buffer.from('3 rounds for time: 400-m run'))),
      ).toBe('The file is not a PDF');
      expect(
        await message(file(Buffer.from('%PDF-1.4\nnot really a pdf'))),
      ).toBe('The PDF could not be read');
      expect(
        await message(
          file(pdfWithText([{ text: 'An invoice', x: 20, y: 700 }])),
        ),
      ).toBe(
        'No workout was found in the PDF: the RX, INTERMEDIATE, BEGINNER and SKILL columns are missing',
      );
    });
  });
});
