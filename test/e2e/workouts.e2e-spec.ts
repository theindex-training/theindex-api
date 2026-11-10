import { WorkoutTypesService } from '../../src/workout-types/workout-types.service';
import { lessonPlanPdf } from '../int/pdf-fixture';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Exercises, workout types and workouts over HTTP: request validation, status codes and the
 * journey from a PDF to a saved workout. The rules themselves are covered in the services'
 * `*.int-spec.ts` and the parser's specs; access is in the role matrix.
 */
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

type Named = { id: string; name: string };
type TypeBody = Named & { code: string | null; scoreType: string };
type DraftItem = {
  exerciseId: string | null;
  exerciseName: string;
  measure: string;
  quantity: number | null;
  [field: string]: unknown;
};
type Draft = {
  date: string;
  title: string | null;
  unknownExercises: string[];
  summary: object | null;
  parts: {
    title: string | null;
    workoutTypeId: string;
    scoreType: string;
    variants: { level: string; items: DraftItem[]; [field: string]: unknown }[];
  }[];
};

describe('Exercises, workout types and workouts (e2e)', () => {
  const ctx = setupE2eSuite();

  async function staff() {
    const c = ctx();
    await c.app.get(WorkoutTypesService).seedSystemTypes();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const post = (path: string, body: object) =>
      c.http().post(`/api/${path}`).set(auth).send(body);
    const types = (
      await c.http().get('/api/workout-types').set(auth).expect(200)
    ).body as TypeBody[];
    const exercise = async (name: string) =>
      (await post('exercises', { name, modality: 'OTHER' }).expect(201))
        .body as Named;
    return {
      auth,
      post,
      exercise,
      type: (code: string) => types.find((t) => t.code === code)!,
    };
  }

  it('exercises: trims and validates the fields, and answers 409 for a taken spelling', async () => {
    const { auth, post } = await staff();

    const created = await post('exercises', {
      name: '  Pull-up  ',
      aliases: [' Kipping pull-up '],
      modality: 'GYMNASTICS',
    }).expect(201);
    expect(created.body).toMatchObject({
      name: 'Pull-up',
      aliases: ['Kipping pull-up'],
      defaultMeasure: 'REPS',
      isActive: true,
    });
    expect(created.body).not.toHaveProperty('nameKey');
    expect(created.body).not.toHaveProperty('aliasKeys');

    expect(
      messageOf((await post('exercises', { name: ' ' }).expect(400)).body),
    ).toEqual([
      'name must not be empty',
      'modality must be one of the following values: WEIGHTLIFTING, GYMNASTICS, MONOSTRUCTURAL, OTHER',
    ]);
    expect(
      messageOf(
        (
          await post('exercises', {
            name: 'Row',
            modality: 'OTHER',
            sets: 3,
          }).expect(400)
        ).body,
      ),
    ).toEqual(['property sets should not exist']);
    expect(
      messageOf(
        (
          await post('exercises', {
            name: 'pull ups',
            modality: 'GYMNASTICS',
          }).expect(409)
        ).body,
      ),
    ).toBe('"pull ups" is already the exercise "Pull-up"');

    const listed = await ctx()
      .http()
      .get('/api/exercises?q=kipping')
      .set(auth)
      .expect(200);
    expect((listed.body as Named[]).map((e) => e.name)).toEqual(['Pull-up']);
    await ctx().http().get('/api/exercises?active=maybe').set(auth).expect(400);
    await ctx().http().get('/api/exercises/not-a-uuid').set(auth).expect(400);
    await ctx()
      .http()
      .delete(`/api/exercises/${UNKNOWN_ID}`)
      .set(auth)
      .expect(404);
  });

  it('exercises: takes an optional description and a YouTube link, and validates both', async () => {
    const { auth, post } = await staff();

    const created = await post('exercises', {
      name: 'Air squat',
      modality: 'GYMNASTICS',
      description: '  Hips back and down.  ',
      videoUrl: '  https://youtu.be/rMvwVtlqjTE  ',
    }).expect(201);
    expect(created.body).toMatchObject({
      description: 'Hips back and down.',
      videoUrl: 'https://www.youtube.com/watch?v=rMvwVtlqjTE',
    });

    expect(
      messageOf(
        (
          await post('exercises', {
            name: 'Burpee',
            modality: 'GYMNASTICS',
            description: 'x'.repeat(2001),
            videoUrl: 42,
          }).expect(400)
        ).body,
      ),
    ).toEqual([
      'description must be shorter than or equal to 2000 characters',
      'videoUrl must be a string',
      'videoUrl must be shorter than or equal to 300 characters',
    ]);
    expect(
      messageOf(
        (
          await post('exercises', {
            name: 'Burpee',
            modality: 'GYMNASTICS',
            videoUrl: 'https://vimeo.com/1',
          }).expect(400)
        ).body,
      ),
    ).toBe(
      'videoUrl must be a link to a YouTube video, e.g. https://www.youtube.com/watch?v=rMvwVtlqjTE',
    );

    const cleared = await ctx()
      .http()
      .patch(`/api/exercises/${(created.body as Named).id}`)
      .set(auth)
      .send({ description: null, videoUrl: '' })
      .expect(200);
    expect(cleared.body).toMatchObject({ description: null, videoUrl: null });
  });

  it('workout types: lists the built-in ones, takes new ones and guards names and deletes', async () => {
    const { auth, post, type } = await staff();

    const chipper = await post('workout-types', {
      name: ' Chipper ',
      description: ' One long list. ',
      scoreType: 'TIME',
    }).expect(201);
    expect(chipper.body).toMatchObject({
      name: 'Chipper',
      description: 'One long list.',
      scoreType: 'TIME',
      code: null,
    });
    expect(
      messageOf(
        (await post('workout-types', { name: 'chipper' }).expect(409)).body,
      ),
    ).toBe('A workout type named "chipper" already exists');
    expect(
      messageOf(
        (
          await post('workout-types', { name: 'X', scoreType: 'FAST' }).expect(
            400,
          )
        ).body,
      ),
    ).toEqual([
      'scoreType must be one of the following values: TIME, ROUNDS_REPS, REPS, LOAD, CALORIES, DISTANCE, NONE',
    ]);
    // The code of a type is not something a request can set.
    await post('workout-types', { name: 'Mine', code: 'AMRAP' }).expect(400);

    const http = ctx().http();
    await http
      .delete(`/api/workout-types/${type('AMRAP').id}`)
      .set(auth)
      .expect(409);
    await http
      .delete(`/api/workout-types/${(chipper.body as Named).id}`)
      .set(auth)
      .expect(200, { deleted: true });
  });

  it('workouts: a trainer creates, reads, updates and deletes one', async () => {
    const c = ctx();
    const { exercise, type } = await staff();
    const run = await exercise('Run');
    const trainer = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainer', (await c.trainer()).id)}`,
    };
    const body = {
      date: '2026-11-09',
      title: ' Helen ',
      summary: {
        blocks: [{ type: 'paragraph', data: { text: '<b>3 rounds</b>' } }],
      },
      parts: [
        {
          workoutTypeId: type('FOR_TIME').id,
          variants: [
            {
              level: 'RX',
              rounds: 3,
              items: [
                { exerciseId: run.id, measure: 'DISTANCE', quantity: 400 },
              ],
            },
          ],
        },
      ],
    };

    const created = await c
      .http()
      .post('/api/workouts')
      .set(trainer)
      .send(body)
      .expect(201);
    const workout = created.body as { id: string; parts: { id: string }[] };
    expect(created.body).toMatchObject({
      date: '2026-11-09',
      title: 'Helen',
      parts: [
        {
          scoreType: 'TIME',
          workoutType: { name: 'For time', code: 'FOR_TIME' },
          variants: [
            {
              level: 'RX',
              rounds: 3,
              items: [{ exercise: { id: run.id, name: 'Run' }, quantity: 400 }],
            },
          ],
        },
      ],
    });

    const week = await c
      .http()
      .get('/api/workouts?from=2026-11-09&to=2026-11-15')
      .set(trainer)
      .expect(200);
    expect((week.body as { id: string }[]).map((w) => w.id)).toEqual([
      workout.id,
    ]);

    const updated = await c
      .http()
      .patch(`/api/workouts/${workout.id}`)
      .set(trainer)
      .send({ date: '2026-11-10' })
      .expect(200);
    expect(updated.body).toMatchObject({ date: '2026-11-10', title: 'Helen' });

    await c
      .http()
      .delete(`/api/workouts/${workout.id}`)
      .set(trainer)
      .expect(200);
    await c.http().get(`/api/workouts/${workout.id}`).set(trainer).expect(404);
  });

  it('workouts: validates the nested fields and the workout rules (400)', async () => {
    const { post, exercise, type } = await staff();
    const run = await exercise('Run');
    const item = { exerciseId: run.id, measure: 'REPS', quantity: 10 };
    const workout = (variant: object, extra: object = {}) => ({
      date: '2026-11-09',
      summary: {
        blocks: [{ type: 'paragraph', data: { text: '<b>3 rounds</b>' } }],
      },
      parts: [
        {
          workoutTypeId: type('FOR_TIME').id,
          variants: [{ level: 'RX', items: [item], ...variant }],
        },
      ],
      ...extra,
    });
    const messages = async (body: object) =>
      messageOf((await post('workouts', body).expect(400)).body);

    expect(
      await messages({
        date: '2026-11-09',
        summary: { blocks: [{ type: 'paragraph', data: { text: 'x' } }] },
        parts: [],
      }),
    ).toEqual(['a workout needs at least one part']);
    expect(await messages(workout({}, { summary: undefined }))).toEqual([
      'summary must be an object',
    ]);
    expect(await messages(workout({}, { summary: 'For time' }))).toEqual([
      'summary must be an object',
    ]);
    expect(
      await messages(
        workout(
          {},
          { summary: { blocks: [{ type: 'paragraph', data: { text: ' ' } }] } },
        ),
      ),
    ).toEqual(['summary must not be empty']);
    expect(await messages(workout({}, { date: '9.11.2026' }))).toEqual([
      'date must be a real date',
      'date must be YYYY-MM-DD',
    ]);
    expect(await messages(workout({}, { date: '2026-02-30' }))).toEqual([
      'date must be a real date',
    ]);
    expect(await messages(workout({ items: [] }))).toEqual([
      'parts.0.variants.0.each level needs at least one exercise',
    ]);
    expect(await messages(workout({ rounds: 0, repScheme: [21, 0] }))).toEqual([
      'parts.0.variants.0.rounds must not be less than 1',
      'parts.0.variants.0.each value in repScheme must not be less than 1',
    ]);
    expect(
      await messages(
        workout({
          items: [{ ...item, quantity: 2.5, loadKg: 20.123, reps: 3 }],
        }),
      ),
    ).toEqual([
      'parts.0.variants.0.items.0.property reps should not exist',
      'parts.0.variants.0.items.0.quantity must be an integer number',
      'parts.0.variants.0.items.0.loadKg must be a number conforming to the specified constraints',
    ]);
    // The rules across fields come from the service, as a list.
    expect(
      await messages(workout({ items: [{ ...item, quantity: null }] })),
    ).toEqual([
      'Part 1, RX, exercise 1: reps are required, unless the level has a rep scheme or the exercise is max effort',
    ]);
    await post(
      'workouts',
      workout({ repScheme: [21, 15, 9], items: [{ ...item, quantity: null }] }),
    ).expect(201);
  });

  it('from a PDF to a saved workout: the draft is reviewed, the missing exercise created, then it is saved', async () => {
    const c = ctx();
    const { auth, post, exercise } = await staff();
    await exercise('Run');
    const pdf = lessonPlanPdf('261109 // HELEN | TASK PRIORITY', {
      rx: ['3 rounds for time:', '400-m run', '12 pull-ups'],
      intermediate: ["Same as Rx'd"],
      beginner: ['3 rounds for time:', '200-m run', '12 ring rows'],
      skill: ['Post-workout skill', 'Accumulate:', '10-15 skin-the-cats'],
    });

    const imported = await c
      .http()
      .post('/api/workouts/import-pdf')
      .set(auth)
      .attach('file', pdf, '261109.pdf')
      .expect(200);
    const draft = imported.body as Draft;
    expect(draft).toMatchObject({
      date: '2026-11-09',
      title: 'Helen',
      // Only the RX column is read: no ring rows, no skin-the-cats.
      unknownExercises: ['Pull-up'],
      summary: {
        blocks: [
          { type: 'paragraph', data: { text: '<b>3 rounds for time:</b>' } },
          { type: 'paragraph', data: { text: '400-m run' } },
          { type: 'paragraph', data: { text: '12 pull-ups' } },
        ],
      },
    });
    expect(draft.parts).toHaveLength(1);
    await c.http().get('/api/workouts').set(auth).expect(200, []);

    // The form creates what is missing, then sends the draft as a workout.
    const ids = new Map<string, string>();
    for (const name of draft.unknownExercises) {
      const res = await post('exercises', {
        name,
        modality: 'GYMNASTICS',
      }).expect(201);
      ids.set(name, (res.body as Named).id);
    }
    const saved = await post('workouts', {
      date: draft.date,
      title: draft.title,
      summary: draft.summary,
      parts: draft.parts.map((part) => ({
        title: part.title,
        workoutTypeId: part.workoutTypeId,
        scoreType: part.scoreType,
        variants: part.variants.map((variant) => ({
          ...variant,
          items: variant.items.map(({ exerciseName, ...item }) => ({
            ...item,
            exerciseId: item.exerciseId ?? ids.get(exerciseName),
          })),
        })),
      })),
    }).expect(201);

    expect(saved.body).toMatchObject({
      date: '2026-11-09',
      title: 'Helen',
      summaryText: '3 rounds for time:\n400-m run\n12 pull-ups',
      parts: [
        {
          scoreType: 'TIME',
          variants: [
            {
              level: 'RX',
              rounds: 3,
              items: [
                {
                  exercise: { name: 'Run' },
                  measure: 'DISTANCE',
                  quantity: 400,
                },
                {
                  exercise: { name: 'Pull-up' },
                  measure: 'REPS',
                  quantity: 12,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('import: answers 400 without a file or for a file that is not a workout PDF', async () => {
    const { auth } = await staff();
    const upload = () =>
      ctx().http().post('/api/workouts/import-pdf').set(auth);

    expect(messageOf((await upload().expect(400)).body)).toBe(
      'A PDF file is required (field "file")',
    );
    expect(
      messageOf(
        (
          await upload()
            .attach('file', Buffer.from('hello'), 'a.pdf')
            .expect(400)
        ).body,
      ),
    ).toBe('The file is not a PDF');
  });
});
