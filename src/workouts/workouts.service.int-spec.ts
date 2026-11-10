import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { lessonPlanPdf, pdfWithText } from '../../test/int/pdf-fixture';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ExerciseEntity } from '../exercises/exercise.entity';
import { ExerciseMeasure, ExerciseModality } from '../exercises/exercise.enums';
import { ExercisesService } from '../exercises/exercises.service';
import { WorkoutTypeEntity } from '../workout-types/workout-type.entity';
import {
  ScoreType,
  WorkoutTypeCode,
} from '../workout-types/workout-type.enums';
import { WorkoutTypesService } from '../workout-types/workout-types.service';
import { CreateWorkoutDto } from './dto/workout.dto';
import { WorkoutImportService } from './import/workout-import.service';
import { WorkoutItemEntity, WorkoutPartEntity } from './workout.entity';
import { WorkoutLevel } from './workout.enums';
import { WorkoutsModule } from './workouts.module';
import { WorkoutsService } from './workouts.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
const { REPS, DISTANCE, TIME, CALORIES } = ExerciseMeasure;
const { RX, INTERMEDIATE, BEGINNER } = WorkoutLevel;

describe('WorkoutsService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [WorkoutsModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(WorkoutsService);

  /** The built-in types by code and a few exercises by name. */
  async function catalogue(fx: Fixtures) {
    await fx.moduleRef.get(WorkoutTypesService).seedSystemTypes();
    const types = await fx.moduleRef.get(WorkoutTypesService).byCode();
    const exercises = fx.moduleRef.get(ExercisesService);
    const add = (name: string, aliases: string[] = []) =>
      exercises.create({ name, aliases, modality: ExerciseModality.OTHER });
    return {
      type: (code: keyof typeof WorkoutTypeCode) =>
        types.get(WorkoutTypeCode[code])!,
      run: await add('Run'),
      swing: await add('Kettlebell swing'),
      pullUp: await add('Pull-up'),
      ringRow: await add('Ring row'),
      snatch: await add('Snatch'),
    };
  }
  type Catalogue = Awaited<ReturnType<typeof catalogue>>;

  const HELEN_SUMMARY = {
    blocks: [
      { type: 'paragraph', data: { text: '<b>3 rounds for time:</b>' } },
      {
        type: 'paragraph',
        data: { text: '400-m run<br>21 KB swings<br>12 pull-ups' },
      },
    ],
  };

  const helen = (c: Catalogue): CreateWorkoutDto => ({
    date: '2026-11-09',
    title: 'Helen',
    summary: HELEN_SUMMARY,
    parts: [
      {
        workoutTypeId: c.type('FOR_TIME').id,
        variants: [
          {
            level: RX,
            rounds: 3,
            items: [
              { exerciseId: c.run.id, measure: DISTANCE, quantity: 400 },
              {
                exerciseId: c.swing.id,
                measure: REPS,
                quantity: 21,
                loadKg: 24,
                loadFemaleKg: 16,
              },
              { exerciseId: c.pullUp.id, measure: REPS, quantity: 12 },
            ],
          },
          {
            level: BEGINNER,
            rounds: 3,
            items: [
              { exerciseId: c.run.id, measure: DISTANCE, quantity: 200 },
              { exerciseId: c.ringRow.id, measure: REPS, quantity: 12 },
            ],
          },
        ],
      },
    ],
  });

  describe('create / get', () => {
    it('stores the whole tree and returns it in order, with names and the type’s score', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const created = await svc(fx).create(helen(c), null);

      expect(created).toMatchObject({
        date: '2026-11-09',
        title: 'Helen',
        notes: null,
        summary: {
          blocks: [
            { type: 'paragraph', data: { text: '<b>3 rounds for time:</b>' } },
            {
              type: 'paragraph',
              data: { text: '400-m run<br />21 KB swings<br />12 pull-ups' },
            },
          ],
        },
        summaryText: '3 rounds for time:\n400-m run\n21 KB swings\n12 pull-ups',
      });
      expect(created.parts).toHaveLength(1);
      const [part] = created.parts;
      expect(part).toMatchObject({
        title: null,
        workoutType: {
          id: c.type('FOR_TIME').id,
          name: 'For time',
          code: 'FOR_TIME',
        },
        scoreType: ScoreType.TIME,
      });
      expect(part.variants.map((v) => v.level)).toEqual([RX, BEGINNER]);
      expect(part.variants[0]).toMatchObject({
        rounds: 3,
        repScheme: null,
        durationSeconds: null,
      });
      expect(part.variants[0].items).toEqual([
        {
          exerciseId: c.run.id,
          exercise: { id: c.run.id, name: 'Run' },
          measure: DISTANCE,
          quantity: 400,
          quantityMax: null,
          quantityFemale: null,
          maxEffort: false,
          loadKg: null,
          loadFemaleKg: null,
          loadPercent: null,
          slot: null,
          notes: null,
        },
        expect.objectContaining({
          exercise: { id: c.swing.id, name: 'Kettlebell swing' },
          quantity: 21,
          loadKg: 24,
          loadFemaleKg: 16,
        }),
        expect.objectContaining({
          exercise: { id: c.pullUp.id, name: 'Pull-up' },
        }),
      ]);
      expect(await svc(fx).get(created.id)).toEqual(created);
    });

    it('stores every way of saying how much: scheme, range, max effort, slots, decimals', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const created = await svc(fx).create(
        {
          date: '2026-11-12',
          notes: 'Hard week.',
          summary: HELEN_SUMMARY,
          parts: [
            {
              title: 'Strength',
              workoutTypeId: c.type('FOR_LOAD').id,
              variants: [
                {
                  level: RX,
                  repScheme: [5, 3, 1],
                  items: [
                    {
                      exerciseId: c.snatch.id,
                      measure: REPS,
                      loadPercent: 80,
                      loadKg: 42.5,
                    },
                  ],
                },
              ],
            },
            {
              workoutTypeId: c.type('EMOM').id,
              scoreType: ScoreType.REPS,
              variants: [
                {
                  level: RX,
                  intervalSeconds: 60,
                  durationSeconds: 1200,
                  notes: 'Rest the remaining :20.',
                  items: [
                    {
                      exerciseId: c.run.id,
                      measure: TIME,
                      quantity: 40,
                      maxEffort: true,
                      slot: 1,
                    },
                    {
                      exerciseId: c.pullUp.id,
                      measure: REPS,
                      quantity: 10,
                      quantityMax: 15,
                      slot: 2,
                    },
                    {
                      exerciseId: c.run.id,
                      measure: CALORIES,
                      quantity: 20,
                      quantityFemale: 15,
                      slot: 3,
                      notes: 'Bike',
                    },
                    {
                      exerciseId: c.ringRow.id,
                      measure: TIME,
                      maxEffort: true,
                      slot: 4,
                    },
                  ],
                },
              ],
            },
          ],
        },
        null,
      );

      expect(created.notes).toBe('Hard week.');
      expect(created.parts.map((p) => [p.title, p.scoreType])).toEqual([
        ['Strength', ScoreType.LOAD],
        [null, ScoreType.REPS],
      ]);
      expect(created.parts[0].variants[0]).toMatchObject({
        repScheme: [5, 3, 1],
        items: [{ quantity: null, loadPercent: 80, loadKg: 42.5 }],
      });
      expect(created.parts[1].variants[0]).toMatchObject({
        intervalSeconds: 60,
        durationSeconds: 1200,
        notes: 'Rest the remaining :20.',
        items: [
          { measure: TIME, quantity: 40, maxEffort: true, slot: 1 },
          { quantity: 10, quantityMax: 15, slot: 2 },
          {
            measure: CALORIES,
            quantity: 20,
            quantityFemale: 15,
            notes: 'Bike',
          },
          { measure: TIME, quantity: null, maxEffort: true, slot: 4 },
        ],
      });
    });

    it('refuses a workout that breaks the rules, listing every problem, and saves nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const dto = helen(c);
      dto.parts[0].variants[0].level = INTERMEDIATE;
      dto.parts[0].variants[1].items[0].quantity = null;

      const error = await rejectionOf(svc(fx).create(dto, null));

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: [
          'Part 1: the RX level is required',
          'Part 1, BEGINNER, exercise 1: an amount is required, or mark it max effort',
        ],
      });
      expect(await svc(fx).list()).toEqual([]);
    });

    it('refuses an unknown exercise or workout type (400) and saves nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const withExercise = helen(c);
      withExercise.parts[0].variants[0].items[0].exerciseId = UNKNOWN_ID;
      const withType = helen(c);
      withType.parts[0].workoutTypeId = UNKNOWN_ID;

      expect(
        (await rejectionOf(svc(fx).create(withExercise, null))).message,
      ).toBe('Unknown exercise');
      expect((await rejectionOf(svc(fx).create(withType, null))).message).toBe(
        'Unknown workout type',
      );
      expect(await svc(fx).list()).toEqual([]);
    });

    it('refuses a part id on a new workout (400), leaving the workout that owns the part untouched', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const original = await svc(fx).create(helen(c), null);
      // The body of an existing workout sent back as a new one, part ids included.
      const copy = helen(c);
      copy.date = '2026-11-10';
      copy.parts[0].id = original.parts[0].id;

      const error = await rejectionOf(svc(fx).create(copy, null));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe("A new workout's parts can't have an id");
      expect(await svc(fx).get(original.id)).toEqual(original);
      expect((await svc(fx).list()).map((w) => w.id)).toEqual([original.id]);
    });

    it('refuses a missing, empty or unsafe-shaped summary (400) and saves nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const message = async (summary: unknown) => {
        const error = await rejectionOf(
          svc(fx).create({ ...helen(c), summary } as CreateWorkoutDto, null),
        );
        expect(error).toBeInstanceOf(BadRequestException);
        return (error as BadRequestException).getResponse();
      };

      expect(await message({ blocks: [] })).toMatchObject({
        message: ['summary must not be empty'],
      });
      expect(
        await message({ blocks: [{ type: 'image', data: { mediaId: 'x' } }] }),
      ).toMatchObject({
        message: [
          'summary paragraph 1: only paragraphs are allowed (bold and italic inside them)',
        ],
      });
      expect(await svc(fx).list()).toEqual([]);
    });

    it('stores the summary sanitized', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const created = await svc(fx).create(
        {
          ...helen(c),
          summary: {
            blocks: [
              {
                type: 'paragraph',
                data: {
                  text: '<strong>AMRAP 12</strong> <a href="https://x.test">go</a><img src=x onerror=alert(1)>',
                },
              },
            ],
          },
        },
        null,
      );

      expect(created.summary.blocks).toEqual([
        { type: 'paragraph', data: { text: '<b>AMRAP 12</b> go' } },
      ]);
      expect(created.summaryText).toBe('AMRAP 12 go');
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
        await svc(fx).create({ ...helen(c), date }, null);
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
      // Each one comes whole.
      expect(
        (await svc(fx).list({}))[0].parts[0].variants[0].items,
      ).toHaveLength(3);
    });
  });

  describe('update', () => {
    it('replaces the summary when sent, and refuses an empty one', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(helen(c), null);

      const updated = await svc(fx).update(created.id, {
        summary: { blocks: [{ type: 'paragraph', data: { text: 'Fran' } }] },
      });

      expect(updated.summary.blocks).toEqual([
        { type: 'paragraph', data: { text: 'Fran' } },
      ]);
      expect(updated.summaryText).toBe('Fran');
      expect(updated.parts).toEqual(created.parts);
      expect(
        await rejectionOf(
          svc(fx).update(created.id, { summary: { blocks: [] } }),
        ),
      ).toBeInstanceOf(BadRequestException);
      expect((await svc(fx).get(created.id)).summaryText).toBe('Fran');
    });

    it('changes only the fields sent', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(helen(c), null);

      const updated = await svc(fx).update(created.id, {
        date: '2026-11-10',
        title: '',
      });

      expect(updated).toMatchObject({ date: '2026-11-10', title: null });
      expect(updated.parts).toEqual(created.parts);
      expect(updated.summary).toEqual(created.summary);
    });

    it('replaces the content; a part sent with its id keeps it, the others are new', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(helen(c), null);
      const keptId = created.parts[0].id;

      const updated = await svc(fx).update(created.id, {
        parts: [
          {
            title: 'Skill',
            workoutTypeId: c.type('QUALITY').id,
            variants: [
              {
                level: RX,
                items: [
                  { exerciseId: c.pullUp.id, measure: REPS, quantity: 5 },
                ],
              },
            ],
          },
          {
            id: keptId,
            workoutTypeId: c.type('AMRAP').id,
            variants: [
              {
                level: RX,
                durationSeconds: 720,
                items: [
                  { exerciseId: c.run.id, measure: DISTANCE, quantity: 200 },
                ],
              },
            ],
          },
        ],
      });

      expect(updated.parts.map((p) => [p.title, p.workoutType.code])).toEqual([
        ['Skill', 'QUALITY'],
        [null, 'AMRAP'],
      ]);
      expect(updated.parts[1].id).toBe(keptId);
      expect(updated.parts[1].scoreType).toBe(ScoreType.ROUNDS_REPS);
      expect(updated.parts[1].variants).toHaveLength(1);
      expect(updated.parts[1].variants[0]).toMatchObject({
        rounds: null,
        durationSeconds: 720,
        items: [{ quantity: 200 }],
      });
      // Nothing of the old content is left behind.
      expect(await fx.ds.getRepository(WorkoutPartEntity).count()).toBe(2);
      expect(await fx.ds.getRepository(WorkoutItemEntity).count()).toBe(2);
    });

    it('refuses a part id of another workout, a broken rule or an unknown workout, changing nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(helen(c), null);
      const other = await svc(fx).create(
        { ...helen(c), date: '2026-11-10' },
        null,
      );
      const foreign = helen(c).parts.map((p) => ({
        ...p,
        id: other.parts[0].id,
      }));
      const broken = helen(c).parts;
      broken[0].variants[0].items[1].quantity = null;

      expect(
        (await rejectionOf(svc(fx).update(created.id, { parts: foreign })))
          .message,
      ).toBe('A part id is not of this workout');
      expect(
        await rejectionOf(
          svc(fx).update(created.id, { title: 'X', parts: broken }),
        ),
      ).toBeInstanceOf(BadRequestException);
      expect(
        await rejectionOf(svc(fx).update(UNKNOWN_ID, { title: 'X' })),
      ).toBeInstanceOf(NotFoundException);
      expect(await svc(fx).get(created.id)).toEqual(created);
    });
  });

  describe('delete', () => {
    it('removes the workout with everything in it, and leaves the catalogue', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(helen(c), null);

      expect(await svc(fx).delete(created.id)).toEqual({ deleted: true });

      expect(await fx.ds.getRepository(WorkoutPartEntity).count()).toBe(0);
      expect(await fx.ds.getRepository(WorkoutItemEntity).count()).toBe(0);
      expect(await fx.ds.getRepository(ExerciseEntity).count()).toBe(5);
      expect(await fx.ds.getRepository(WorkoutTypeEntity).count()).toBe(6);
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

    it('reads the top band into a draft with known exercises and types resolved, saving nothing', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const pdf = lessonPlanPdf('261109 // HELEN | TASK PRIORITY', {
        rx: [
          '3 rounds for time:',
          '400-m run',
          '21 KB swings (35/53 lb)',
          '15 wall balls (20/14 lb)',
          '12 pull-ups',
        ],
        intermediate: ['Same as Rx’d'.replace('’', "'")],
        beginner: [
          '3 rounds for time:',
          '200-m run',
          '15 wall balls (10/14 lb)',
          '12 ring rows',
        ],
        skill: ['Post-workout skill', 'Accumulate:', '10-15 skin-the-cats'],
      });

      const draft = await importer(fx).fromPdf(file(pdf));

      expect(draft).toMatchObject({
        sourceCode: '261109',
        date: '2026-11-09',
        title: 'Helen',
        unknownExercises: ['Wall ball'],
        warnings: [],
      });
      // The RX column as printed, the heading line in bold.
      expect(draft.summary).toEqual({
        blocks: [
          { type: 'paragraph', data: { text: '<b>3 rounds for time:</b>' } },
          { type: 'paragraph', data: { text: '400-m run' } },
          { type: 'paragraph', data: { text: '21 KB swings (35/53 lb)' } },
          { type: 'paragraph', data: { text: '15 wall balls (20/14 lb)' } },
          { type: 'paragraph', data: { text: '12 pull-ups' } },
        ],
      });
      // Only the RX workout: no other levels, no skill part.
      expect(
        draft.parts.map((p) => [
          p.title,
          p.typeCode,
          p.workoutTypeId,
          p.scoreType,
          p.variants.map((v) => v.level),
        ]),
      ).toEqual([[null, 'FOR_TIME', c.type('FOR_TIME').id, 'TIME', [RX]]]);
      expect(
        draft.parts[0].variants[0].items.map((i) => [
          i.exerciseId,
          i.exerciseName,
          i.quantity,
        ]),
      ).toEqual([
        [c.run.id, 'Run', 400],
        // "KB swings" is found under its catalogue name.
        [c.swing.id, 'Kettlebell swing', 21],
        [null, 'Wall ball', 15],
        [c.pullUp.id, 'Pull-up', 12],
      ]);
      expect(draft.parts[0].variants[0].items[2]).toMatchObject({
        loadKg: 9,
        loadFemaleKg: 6,
      });
      expect(await svc(fx).list()).toEqual([]);
    });

    it('leaves the type unresolved when the built-in types are missing', async () => {
      const fx = fixtures();
      const pdf = lessonPlanPdf('261114 | TIME PRIORITY', {
        rx: ['AMRAP 12:', '5 burpees'],
        intermediate: [],
        beginner: [],
        skill: ['Rest, stretch, recover.'],
      });

      const draft = await importer(fx).fromPdf(file(pdf));

      expect(draft.parts[0]).toMatchObject({
        typeCode: 'AMRAP',
        workoutTypeId: null,
      });
      expect(draft.unknownExercises).toEqual(['Burpee']);
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
