import { lessonPlanPdf } from '../int/pdf-fixture';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Exercises and workouts over HTTP: request validation, status codes and the journey from a PDF
 * to a saved workout. The rules themselves are covered in the services' `*.int-spec.ts` and the
 * lesson-plan reader's spec; access is in the role matrix.
 */
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

type Named = { id: string; name: string };
type Draft = {
  date: string;
  title: string | null;
  summary: string;
  exercises: {
    name: string;
    exerciseId: string | null;
    exerciseName: string | null;
  }[];
};

describe('Exercises and workouts (e2e)', () => {
  const ctx = setupE2eSuite();

  async function staff() {
    const c = ctx();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const post = (path: string, body: object) =>
      c.http().post(`/api/${path}`).set(auth).send(body);
    const exercise = async (name: string) =>
      (await post('exercises', { name }).expect(201)).body as Named;
    return { auth, post, exercise };
  }

  it('exercises: trims and validates the fields, and answers 409 for a taken spelling', async () => {
    const { auth, post } = await staff();

    const created = await post('exercises', {
      name: '  Pull-up  ',
      aliases: [' Kipping pull-up '],
    }).expect(201);
    expect(created.body).toMatchObject({
      name: 'Pull-up',
      aliases: ['Kipping pull-up'],
      description: null,
      videoUrl: null,
      isActive: true,
    });
    expect(created.body).not.toHaveProperty('nameKey');
    expect(created.body).not.toHaveProperty('aliasKeys');
    // Category and measure are gone.
    expect(created.body).not.toHaveProperty('modality');
    expect(created.body).not.toHaveProperty('defaultMeasure');

    expect(
      messageOf((await post('exercises', { name: ' ' }).expect(400)).body),
    ).toEqual(['name must not be empty']);
    expect(
      messageOf(
        (
          await post('exercises', { name: 'Row', modality: 'OTHER' }).expect(
            400,
          )
        ).body,
      ),
    ).toEqual(['property modality should not exist']);
    expect(
      messageOf(
        (await post('exercises', { name: 'pull ups' }).expect(409)).body,
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

  it('exercises: adds another spelling, and validates it', async () => {
    const { post, exercise } = await staff();
    const swing = await exercise('Kettlebell swing');
    const pullUp = await exercise('Pull-up');

    const added = await post(`exercises/${swing.id}/aliases`, {
      alias: '  Russian KB swings ',
    }).expect(200);
    expect(added.body).toMatchObject({ aliases: ['Russian KB swings'] });

    expect(
      messageOf(
        (
          await post(`exercises/${swing.id}/aliases`, { alias: ' ' }).expect(
            400,
          )
        ).body,
      ),
    ).toEqual(['alias must not be empty']);
    expect(
      messageOf(
        (
          await post(`exercises/${pullUp.id}/aliases`, {
            alias: 'russian kb swing',
          }).expect(409)
        ).body,
      ),
    ).toBe('"russian kb swing" is already the exercise "Kettlebell swing"');
    await post(`exercises/${UNKNOWN_ID}/aliases`, { alias: 'X' }).expect(404);
  });

  it('workouts: a trainer creates, reads, updates and deletes one', async () => {
    const c = ctx();
    const { exercise } = await staff();
    const run = await exercise('Run');
    const pullUp = await exercise('Pull-up');
    const trainer = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainer', (await c.trainer()).id)}`,
    };

    const created = await c
      .http()
      .post('/api/workouts')
      .set(trainer)
      .send({
        date: '2026-11-09',
        title: ' Helen ',
        summary: '3 rounds for time:  \r\n400-m run\r\n\r\n\r\n12 pull-ups\n',
        exerciseIds: [run.id, pullUp.id],
      })
      .expect(201);
    const workout = created.body as { id: string };
    expect(created.body).toMatchObject({
      date: '2026-11-09',
      title: 'Helen',
      // Line breaks kept; trailing spaces, extra empty lines and Windows breaks cleaned.
      summary: '3 rounds for time:\n400-m run\n\n12 pull-ups',
      exercises: [
        { id: run.id, name: 'Run' },
        { id: pullUp.id, name: 'Pull-up' },
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
      .send({ date: '2026-11-10', exerciseIds: [pullUp.id] })
      .expect(200);
    expect(updated.body).toMatchObject({
      date: '2026-11-10',
      title: 'Helen',
      exercises: [{ name: 'Pull-up' }],
    });

    await c
      .http()
      .delete(`/api/workouts/${workout.id}`)
      .set(trainer)
      .expect(200);
    await c.http().get(`/api/workouts/${workout.id}`).set(trainer).expect(404);
  });

  it('workouts: validates the fields (400)', async () => {
    const { post, exercise } = await staff();
    const run = await exercise('Run');
    const workout = (extra: object = {}) => ({
      date: '2026-11-09',
      summary: 'For time',
      ...extra,
    });
    const messages = async (body: object) =>
      messageOf((await post('workouts', body).expect(400)).body);

    expect(await messages(workout({ summary: undefined }))).toEqual([
      'summary must be shorter than or equal to 3000 characters',
      'summary must not be empty',
      'summary must be a string',
    ]);
    expect(await messages(workout({ summary: ' \n\n ' }))).toEqual([
      'summary must not be empty',
    ]);
    expect(await messages(workout({ summary: 'x'.repeat(3001) }))).toEqual([
      'summary must be shorter than or equal to 3000 characters',
    ]);
    expect(await messages(workout({ date: '9.11.2026' }))).toEqual([
      'date must be a real date',
      'date must be YYYY-MM-DD',
    ]);
    expect(await messages(workout({ date: '2026-02-30' }))).toEqual([
      'date must be a real date',
    ]);
    expect(await messages(workout({ exerciseIds: [run.id, run.id] }))).toEqual([
      'an exercise can be listed only once',
    ]);
    expect(await messages(workout({ exerciseIds: ['abc'] }))).toEqual([
      'each value in exerciseIds must be a UUID',
    ]);
    expect(await messages(workout({ notes: 'x' }))).toEqual([
      'property notes should not exist',
    ]);
    expect(
      messageOf(
        (
          await post('workouts', workout({ exerciseIds: [UNKNOWN_ID] })).expect(
            400,
          )
        ).body,
      ),
    ).toBe('Unknown exercise');
  });

  it('from a PDF to a saved workout: the draft is reviewed, a missing exercise created, another linked, then it is saved', async () => {
    const c = ctx();
    const { auth, post, exercise } = await staff();
    const run = await exercise('Run');
    const swing = await exercise('Kettlebell swing');
    const pdf = lessonPlanPdf('261109 // HELEN | TASK PRIORITY', {
      rx: [
        '3 rounds for time:',
        '400-m run',
        '21 Russian KB swings (35/53 lb)',
        '12 pull-ups',
      ],
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
      summary:
        '3 rounds for time:\n400-m run\n21 Russian KB swings (35/53 lb)\n12 pull-ups',
      exercises: [
        { name: 'Run', exerciseId: run.id },
        { name: 'Russian KB swing', exerciseId: null },
        { name: 'Pull-up', exerciseId: null },
      ],
    });
    await c.http().get('/api/workouts').set(auth).expect(200, []);

    // The trainer links one to an existing exercise and creates the other.
    await post(`exercises/${swing.id}/aliases`, {
      alias: 'Russian KB swing',
    }).expect(200);
    const pullUp = await exercise('Pull-up');
    const saved = await post('workouts', {
      date: draft.date,
      title: draft.title,
      summary: draft.summary,
      exerciseIds: [run.id, swing.id, pullUp.id],
    }).expect(201);

    expect(saved.body).toMatchObject({
      date: '2026-11-09',
      title: 'Helen',
      summary: draft.summary,
      exercises: [
        { name: 'Run' },
        { name: 'Kettlebell swing' },
        { name: 'Pull-up' },
      ],
    });

    // The next PDF with that spelling finds the exercise.
    const again = await c
      .http()
      .post('/api/workouts/import-pdf')
      .set(auth)
      .attach('file', pdf, '261109.pdf')
      .expect(200);
    expect((again.body as Draft).exercises.map((e) => e.exerciseName)).toEqual([
      'Run',
      'Kettlebell swing',
      'Pull-up',
    ]);
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
