import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Benchmarks, heavy lifts and results over HTTP: request validation, status codes and the
 * journey from the catalogue to a result on the leaderboards. The rules themselves are in the
 * services' `*.int-spec.ts` and the pure specs; access is in the role matrix.
 */
type Benchmark = { id: string; name: string; kind: string; scoreType: string };
type Entry = {
  rank: number;
  resultId: string;
  name: string;
  isMe: boolean;
  timeSeconds: number | null;
  loadKg: number | null;
  note: string | null;
};

describe('Benchmarks and results (e2e)', () => {
  const ctx = setupE2eSuite();

  async function setup() {
    const c = ctx();
    const admin = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const exercise = async (name: string) =>
      (
        await c
          .http()
          .post('/api/exercises')
          .set(admin)
          .send({ name })
          .expect(201)
      ).body as { id: string };
    const thruster = await exercise('Thruster');
    const pullUp = await exercise('Pull-up');
    const deadlift = await exercise('Deadlift');
    const traineeProfile = await c.trainee('John Doe', { nickname: 'JD' });
    const trainee = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainee', traineeProfile.id)}`,
    };
    const trainer = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainer', (await c.trainer('Coach Ivo')).id)}`,
    };
    return { c, admin, trainee, trainer, thruster, pullUp, deadlift };
  }

  it('a trainer adds Fran and a lift; trainees and trainers log results that show up on the leaderboards', async () => {
    const s = await setup();
    const http = s.c.http();

    const fran = (
      await http
        .post('/api/benchmarks')
        .set(s.trainer)
        .send({
          kind: 'BENCHMARK',
          name: '  Fran ',
          scoreType: 'TIME',
          description:
            'For time:\r\n21-15-9 reps of:  \r\nThrusters\r\nPull-ups\r\n',
          exerciseIds: [s.thruster.id, s.pullUp.id],
        })
        .expect(201)
    ).body as Benchmark & { description: string };
    expect(fran).toMatchObject({
      name: 'Fran',
      description: 'For time:\n21-15-9 reps of:\nThrusters\nPull-ups',
    });
    const lift = (
      await http
        .post('/api/benchmarks')
        .set(s.admin)
        .send({ kind: 'LIFT', name: 'Deadlift', exerciseIds: [s.deadlift.id] })
        .expect(201)
    ).body as Benchmark;
    expect(lift.scoreType).toBe('LOAD');

    // Trainees read the catalogue and one benchmark with its exercises.
    const list = (
      await http
        .get('/api/benchmarks?kind=BENCHMARK')
        .set(s.trainee)
        .expect(200)
    ).body as Benchmark[];
    expect(list.map((b) => b.name)).toEqual(['Fran']);
    await http.get(`/api/benchmarks/${fran.id}`).set(s.trainee).expect(200);

    const johns = (
      await http
        .post('/api/benchmark-results')
        .set(s.trainee)
        .send({
          benchmarkId: fran.id,
          performedOn: '2026-06-20',
          timeSeconds: 266,
          note: '  ',
        })
        .expect(201)
    ).body as { id: string; note: string | null; personalBest: boolean };
    expect(johns).toMatchObject({ note: null, personalBest: true });
    await http
      .post('/api/benchmark-results')
      .set(s.trainer)
      .send({
        benchmarkId: fran.id,
        performedOn: '2026-06-19',
        timeSeconds: 400,
        scaled: true,
        note: 'Ring rows',
      })
      .expect(201);
    await http
      .post('/api/benchmark-results')
      .set(s.trainer)
      .send({ benchmarkId: lift.id, performedOn: '2026-06-19', loadKg: 182.5 })
      .expect(201);

    const board = (
      await http
        .get(`/api/benchmarks/${fran.id}/leaderboard`)
        .set(s.trainee)
        .expect(200)
    ).body as { rx: Entry[]; scaled: Entry[] };
    expect(board.rx).toMatchObject([
      { rank: 1, name: 'John Doe', isMe: true, timeSeconds: 266 },
    ]);
    expect(board.scaled).toMatchObject([
      { rank: 1, name: 'Coach Ivo', isMe: false, note: 'Ring rows' },
    ]);
    expect(JSON.stringify(board)).not.toContain('JD');

    const lifts = (
      await http.get('/api/leaderboards?kind=LIFT').set(s.trainee).expect(200)
    ).body as { name: string; rx: Entry[]; myRx: Entry | null }[];
    expect(lifts).toMatchObject([
      {
        name: 'Deadlift',
        rx: [{ name: 'Coach Ivo', loadKg: 182.5 }],
        myRx: null,
      },
    ]);

    // The owner changes their result; nobody else can; an admin deletes it.
    await http
      .patch(`/api/benchmark-results/${johns.id}`)
      .set(s.trainee)
      .send({ timeSeconds: 250 })
      .expect(200);
    const forbidden = await http
      .patch(`/api/benchmark-results/${johns.id}`)
      .set(s.trainer)
      .send({ timeSeconds: 100 })
      .expect(403);
    expect(messageOf(forbidden.body)).toBe(
      'You can only change your own results',
    );
    const mine = (
      await http.get('/api/benchmark-results/mine').set(s.trainee).expect(200)
    ).body as { timeSeconds: number }[];
    expect(mine.map((r) => r.timeSeconds)).toEqual([250]);

    await http
      .delete(`/api/benchmark-results/${johns.id}`)
      .set(s.admin)
      .expect(200);
    await http
      .get(`/api/benchmark-results/${johns.id}`)
      .set(s.trainee)
      .expect(404);

    // A benchmark with results can't be deleted, only made inactive.
    const conflict = await http
      .delete(`/api/benchmarks/${lift.id}`)
      .set(s.admin)
      .expect(409);
    expect(messageOf(conflict.body)).toBe(
      '"Deadlift" has results and can\'t be deleted. Make it inactive instead.',
    );
    await http
      .patch(`/api/benchmarks/${lift.id}`)
      .set(s.admin)
      .send({ isActive: false })
      .expect(200);
    expect(
      (await http.get('/api/benchmarks').set(s.trainee).expect(200)).body,
    ).toHaveLength(1);
  });

  it('validates benchmark fields (400) and taken names (409)', async () => {
    const s = await setup();
    const post = (body: object) =>
      s.c.http().post('/api/benchmarks').set(s.trainer).send(body);
    const base = {
      kind: 'BENCHMARK',
      name: 'Fran',
      scoreType: 'TIME',
      description: '21-15-9',
      exerciseIds: [s.thruster.id],
    };

    for (const [body, message] of [
      [
        { ...base, kind: 'WOD' },
        'kind must be one of the following values: BENCHMARK, LIFT',
      ],
      [{ ...base, name: ' ' }, 'name must not be empty'],
      [{ ...base, exerciseIds: [] }, 'list at least one exercise'],
      [
        { ...base, exerciseIds: [s.thruster.id, s.thruster.id] },
        'an exercise can be listed only once',
      ],
      [
        { ...base, timeCapSeconds: 0 },
        'timeCapSeconds must not be less than 1',
      ],
      [{ ...base, extra: 1 }, 'property extra should not exist'],
    ] as const) {
      const res = await post(body).expect(400);
      expect(messageOf(res.body)).toEqual(expect.arrayContaining([message]));
    }
    await post(base).expect(201);
    const taken = await post({ ...base, name: 'FRAN' }).expect(409);
    expect(messageOf(taken.body)).toBe(
      'A benchmark or lift named "FRAN" already exists',
    );
    await s.c
      .http()
      .patch('/api/benchmarks/not-a-uuid')
      .set(s.trainer)
      .send({})
      .expect(400);
  });

  it('validates result fields (400)', async () => {
    const s = await setup();
    const lift = (
      await s.c
        .http()
        .post('/api/benchmarks')
        .set(s.admin)
        .send({ kind: 'LIFT', name: 'Deadlift', exerciseIds: [s.deadlift.id] })
        .expect(201)
    ).body as Benchmark;
    const post = (body: object) =>
      s.c
        .http()
        .post('/api/benchmark-results')
        .set(s.trainee)
        .send({ benchmarkId: lift.id, performedOn: '2026-06-20', ...body });

    for (const [body, message] of [
      [{ loadKg: 100.25 }, 'loadKg must be in steps of 0.5 kg'],
      [{ loadKg: 0 }, 'loadKg must not be less than 0.5'],
      [{ loadKg: '100' }, 'loadKg must not be greater than 1000'],
      [
        { loadKg: 100, performedOn: '2026-02-30' },
        'performedOn must be a real date',
      ],
      [
        { loadKg: 100, performedOn: '20.06.2026' },
        'performedOn must be YYYY-MM-DD',
      ],
      [
        { loadKg: 100, note: 'x'.repeat(501) },
        'note must be shorter than or equal to 500 characters',
      ],
      [{ timeSeconds: 1.5 }, 'timeSeconds must be an integer number'],
      [{ loadKg: 100, scaled: true }, 'A heavy lift has no scaled version'],
      [{ reps: 5 }, "reps doesn't apply to a result scored by load"],
    ] as const) {
      const res = await post(body).expect(400);
      expect([messageOf(res.body)].flat()).toEqual(
        expect.arrayContaining([message]),
      );
    }
    await post({ loadKg: 100.5 }).expect(201);
  });
});
