import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountRole } from '../common/enums/account-role.enum';
import { ExercisesService } from '../exercises/exercises.service';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { Requester } from './benchmark-owner';
import {
  BenchmarkResultsService,
  LEADERBOARD_PREVIEW_SIZE,
  NO_PROFILE_MESSAGE,
  NOT_YOURS_MESSAGE,
} from './benchmark-results.service';
import { BenchmarkResultEntity } from './benchmark.entity';
import { BenchmarksModule } from './benchmarks.module';
import { BenchmarksService } from './benchmarks.service';
import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
/** 01:30 on 2026-06-21 in Sofia (UTC+3), still the 20th in UTC. */
const NOW = '2026-06-20T22:30:00Z';

const ADMIN: Requester = { role: AccountRole.ADMIN, owner: null };

describe('BenchmarkResultsService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [BenchmarksModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(BenchmarkResultsService);

  async function setup(fx: Fixtures) {
    freezeTime(NOW);
    const exercises = fx.moduleRef.get(ExercisesService);
    const benchmarks = fx.moduleRef.get(BenchmarksService);
    const thruster = await exercises.create({ name: 'Thruster' });
    const pullUp = await exercises.create({ name: 'Pull-up' });
    const deadlift = await exercises.create({ name: 'Deadlift' });
    const fran = await benchmarks.create({
      kind: BenchmarkKind.BENCHMARK,
      name: 'Fran',
      scoreType: BenchmarkScoreType.TIME,
      timeCapSeconds: 600,
      description: '21-15-9',
      exerciseIds: [thruster.id, pullUp.id],
    });
    const cindy = await benchmarks.create({
      kind: BenchmarkKind.BENCHMARK,
      name: 'Cindy',
      scoreType: BenchmarkScoreType.ROUNDS_REPS,
      description: 'AMRAP 20',
      exerciseIds: [pullUp.id],
    });
    const deadliftMax = await benchmarks.create({
      kind: BenchmarkKind.LIFT,
      name: 'Deadlift',
      exerciseIds: [deadlift.id],
    });
    const trainee = async (name: string, extra: object = {}) => {
      const profile = await fx.trainee(name, extra);
      return {
        profile,
        as: {
          role: AccountRole.TRAINEE,
          owner: { traineeProfileId: profile.id, trainerProfileId: null },
        } as Requester,
      };
    };
    const coachProfile = await fx.trainer('Coach Ivo');
    const coach: Requester = {
      role: AccountRole.TRAINER,
      owner: { traineeProfileId: null, trainerProfileId: coachProfile.id },
    };
    return {
      fran,
      cindy,
      deadliftMax,
      benchmarks,
      john: await trainee('John Doe', { nickname: 'JD' }),
      mia: await trainee('Mia'),
      coach,
    };
  }

  describe('create', () => {
    it("stores a trainee's result with the score fields of its benchmark and the note", async () => {
      const fx = fixtures();
      const s = await setup(fx);

      const result = await svc(fx).create(s.john.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-20',
        timeSeconds: 266,
        note: '  felt great  ',
      });

      expect(result).toMatchObject({
        benchmark: {
          id: s.fran.id,
          name: 'Fran',
          kind: 'BENCHMARK',
          scoreType: 'TIME',
          timeCapSeconds: 600,
        },
        performedOn: '2026-06-20',
        scaled: false,
        timeSeconds: 266,
        capped: false,
        rounds: null,
        reps: null,
        loadKg: null,
        note: 'felt great',
        personalBest: true,
      });
      const [row] = await fx.ds.getRepository(BenchmarkResultEntity).find();
      expect(row).toMatchObject({
        traineeProfileId: s.john.profile.id,
        trainerProfileId: null,
        timeSeconds: 266,
      });
    });

    it("stores a trainer's own result, a scaled one, and a load in half kilos", async () => {
      const fx = fixtures();
      const s = await setup(fx);

      const scaled = await svc(fx).create(s.coach, {
        benchmarkId: s.cindy.id,
        performedOn: '2026-06-01',
        scaled: true,
        rounds: 15,
        note: 'Ring rows instead of pull-ups',
      });
      const lift = await svc(fx).create(s.coach, {
        benchmarkId: s.deadliftMax.id,
        performedOn: '2026-06-01',
        loadKg: 142.5,
      });

      expect(scaled).toMatchObject({ scaled: true, rounds: 15, reps: 0 });
      expect(lift).toMatchObject({ loadKg: 142.5 });
      const rows = await fx.ds.getRepository(BenchmarkResultEntity).find();
      expect(rows.map((r) => r.trainerProfileId)).toEqual([
        s.coach.owner!.trainerProfileId,
        s.coach.owner!.trainerProfileId,
      ]);
      expect(rows.find((r) => r.id === lift.id)!.loadKg).toBe(142.5);
    });

    it('accepts the gym-local today (already the next day in UTC terms) and refuses tomorrow (400)', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const log = (performedOn: string) =>
        svc(fx).create(s.john.as, {
          benchmarkId: s.fran.id,
          performedOn,
          timeSeconds: 300,
        });

      await log('2026-06-21');
      const error = await rejectionOf(log('2026-06-22'));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe("performedOn can't be in the future");
    });

    it.each([
      [
        'a scaled heavy lift',
        'deadliftMax',
        { scaled: true, loadKg: 100 },
        'A heavy lift has no scaled version',
      ],
      [
        'a score that does not fit the benchmark',
        'fran',
        { rounds: 3 },
        "rounds doesn't apply to a result scored by time",
      ],
      [
        'a time over the time cap',
        'fran',
        { timeSeconds: 700 },
        "The time can't be over the time cap (10:00): log the reps done instead",
      ],
    ] as const)('refuses %s (400)', async (_label, which, score, message) => {
      const fx = fixtures();
      const s = await setup(fx);

      const error = await rejectionOf(
        svc(fx).create(s.john.as, {
          benchmarkId: s[which].id,
          performedOn: '2026-06-20',
          ...score,
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(message);
      expect(await fx.ds.getRepository(BenchmarkResultEntity).count()).toBe(0);
    });

    it('refuses an unknown or inactive benchmark (400)', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      await s.benchmarks.update(s.cindy.id, { isActive: false });

      const unknown = await rejectionOf(
        svc(fx).create(s.john.as, {
          benchmarkId: UNKNOWN_ID,
          performedOn: '2026-06-20',
          reps: 1,
        }),
      );
      const inactive = await rejectionOf(
        svc(fx).create(s.john.as, {
          benchmarkId: s.cindy.id,
          performedOn: '2026-06-20',
          rounds: 1,
        }),
      );

      expect(unknown.message).toBe('Unknown benchmark');
      expect(inactive.message).toBe(
        '"Cindy" is inactive and takes no new results',
      );
    });

    it('refuses an account without a profile (403)', async () => {
      const fx = fixtures();
      const s = await setup(fx);

      const error = await rejectionOf(
        svc(fx).create(ADMIN, {
          benchmarkId: s.fran.id,
          performedOn: '2026-06-20',
          timeSeconds: 200,
        }),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.message).toBe(NO_PROFILE_MESSAGE);
    });
  });

  describe('update / delete / get', () => {
    it('lets the owner change the fields sent; score fields replace the whole score', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const created = await svc(fx).create(s.john.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-10',
        timeSeconds: 700 - 100,
        note: 'first try',
      });

      const capped = await svc(fx).update(s.john.as, created.id, {
        capped: true,
        reps: 80,
      });
      const renoted = await svc(fx).update(s.john.as, created.id, {
        note: '',
        scaled: true,
      });

      expect(capped).toMatchObject({
        timeSeconds: null,
        capped: true,
        reps: 80,
        note: 'first try',
        performedOn: '2026-06-10',
      });
      expect(renoted).toMatchObject({
        capped: true,
        reps: 80,
        scaled: true,
        note: null,
      });
    });

    it("applies the benchmark's rules to the result as it ends up (400)", async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const lift = await svc(fx).create(s.john.as, {
        benchmarkId: s.deadliftMax.id,
        performedOn: '2026-06-10',
        loadKg: 100,
      });

      const scaled = await rejectionOf(
        svc(fx).update(s.john.as, lift.id, { scaled: true }),
      );
      const future = await rejectionOf(
        svc(fx).update(s.john.as, lift.id, { performedOn: '2026-07-01' }),
      );

      expect(scaled.message).toBe('A heavy lift has no scaled version');
      expect(future.message).toBe("performedOn can't be in the future");
      expect(await svc(fx).get(s.john.as, lift.id)).toMatchObject({
        scaled: false,
        performedOn: '2026-06-10',
      });
    });

    it('keeps a result as logged when the time cap changes: a note-only edit still works, a new score follows the new rules', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const capped = await svc(fx).create(s.john.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-10',
        capped: true,
        reps: 80,
      });
      await s.benchmarks.update(s.fran.id, { timeCapSeconds: null });

      const renoted = await svc(fx).update(s.john.as, capped.id, {
        note: 'Grip gave out',
        performedOn: '2026-06-11',
      });
      const refused = await rejectionOf(
        svc(fx).update(s.john.as, capped.id, { capped: true, reps: 90 }),
      );

      expect(renoted).toMatchObject({
        capped: true,
        reps: 80,
        note: 'Grip gave out',
        performedOn: '2026-06-11',
      });
      expect(refused.message).toBe('This benchmark has no time cap');
    });

    it("refuses someone else's result to read, change or delete (403), but an admin deletes any", async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const johns = await svc(fx).create(s.john.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-10',
        timeSeconds: 300,
      });

      for (const attempt of [
        svc(fx).get(s.mia.as, johns.id),
        svc(fx).update(s.mia.as, johns.id, { timeSeconds: 100 }),
        svc(fx).delete(s.mia.as, johns.id),
        svc(fx).delete(s.coach, johns.id),
      ]) {
        const error = await rejectionOf(attempt);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.message).toBe(NOT_YOURS_MESSAGE);
      }
      expect(await fx.ds.getRepository(BenchmarkResultEntity).count()).toBe(1);

      expect(await svc(fx).delete(ADMIN, johns.id)).toEqual({ deleted: true });
      expect(await fx.ds.getRepository(BenchmarkResultEntity).count()).toBe(0);
    });

    it('lets the owner delete their own; 404 for an unknown result', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const created = await svc(fx).create(s.mia.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-10',
        timeSeconds: 300,
      });

      expect(await svc(fx).delete(s.mia.as, created.id)).toEqual({
        deleted: true,
      });
      expect(
        await rejectionOf(svc(fx).delete(s.mia.as, created.id)),
      ).toBeInstanceOf(NotFoundException);
      expect(
        await rejectionOf(svc(fx).get(s.mia.as, UNKNOWN_ID)),
      ).toBeInstanceOf(NotFoundException);
    });

    it("deletes a person's results with their profile", async () => {
      const fx = fixtures();
      const s = await setup(fx);
      await svc(fx).create(s.mia.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-10',
        timeSeconds: 300,
      });

      await fx.ds.getRepository(TraineeProfileEntity).delete(s.mia.profile.id);

      expect(await fx.ds.getRepository(BenchmarkResultEntity).count()).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('never lets a first result and a score-type change both go through', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const results = fx.ds.getRepository(BenchmarkResultEntity);

      for (let round = 0; round < 8; round++) {
        const benchmark = await s.benchmarks.create({
          kind: BenchmarkKind.BENCHMARK,
          name: `Race ${round}`,
          scoreType: BenchmarkScoreType.TIME,
          description: 'For time',
          exerciseIds: [s.fran.exercises[0].id],
        });

        const [logged, changed] = await Promise.allSettled([
          svc(fx).create(s.john.as, {
            benchmarkId: benchmark.id,
            performedOn: '2026-06-20',
            timeSeconds: 266,
          }),
          s.benchmarks.update(benchmark.id, {
            scoreType: BenchmarkScoreType.REPS,
          }),
        ]);

        // Exactly one wins, and what is stored fits the benchmark as it ends up.
        expect(
          [logged.status, changed.status].filter((x) => x === 'fulfilled'),
        ).toHaveLength(1);
        const final = await s.benchmarks.get(benchmark.id);
        const stored = await results.find({
          where: { benchmarkId: benchmark.id },
        });
        if (final.scoreType === BenchmarkScoreType.REPS) {
          expect(stored).toHaveLength(0);
        } else {
          expect(stored.map((r) => r.timeSeconds)).toEqual([266]);
        }
      }
    });

    it('never deletes a benchmark that a result was logged on meanwhile', async () => {
      const fx = fixtures();
      const s = await setup(fx);

      const [logged, deleted] = await Promise.allSettled([
        svc(fx).create(s.john.as, {
          benchmarkId: s.cindy.id,
          performedOn: '2026-06-20',
          rounds: 10,
        }),
        s.benchmarks.delete(s.cindy.id),
      ]);

      expect(
        [logged.status, deleted.status].filter((x) => x === 'fulfilled'),
      ).toHaveLength(1);
      if (deleted.status === 'rejected') {
        expect((deleted.reason as Error).message).toContain(
          "has results and can't be deleted",
        );
      }
    });
  });

  describe('mine', () => {
    it('lists only my results, newest first, flagging my best of each benchmark (Rx and scaled apart)', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const log = (as: Requester, performedOn: string, score: object) =>
        svc(fx).create(as, { benchmarkId: s.fran.id, performedOn, ...score });
      const slow = await log(s.john.as, '2026-06-01', { timeSeconds: 400 });
      const fast = await log(s.john.as, '2026-06-10', { timeSeconds: 266 });
      const scaled = await log(s.john.as, '2026-06-05', {
        timeSeconds: 500,
        scaled: true,
      });
      const lift = await svc(fx).create(s.john.as, {
        benchmarkId: s.deadliftMax.id,
        performedOn: '2026-06-15',
        loadKg: 120,
      });
      await log(s.mia.as, '2026-06-11', { timeSeconds: 200 });

      const mine = await svc(fx).mine(s.john.as);

      expect(mine.map((r) => [r.id, r.personalBest])).toEqual([
        [lift.id, true],
        [fast.id, true],
        [scaled.id, true],
        [slow.id, false],
      ]);
      expect(
        (await svc(fx).mine(s.john.as, { benchmarkId: s.deadliftMax.id })).map(
          (r) => r.id,
        ),
      ).toEqual([lift.id]);
      expect(await rejectionOf(svc(fx).mine(ADMIN))).toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('leaderboard', () => {
    it('ranks each person once with their best, Rx and scaled apart, with names (never nicknames) and notes', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      const log = (as: Requester, score: object) =>
        svc(fx).create(as, {
          benchmarkId: s.fran.id,
          performedOn: '2026-06-20',
          ...score,
        });
      await log(s.john.as, { timeSeconds: 300 });
      const johnBest = await log(s.john.as, { timeSeconds: 266 });
      await log(s.mia.as, { capped: true, reps: 70 });
      await log(s.coach, { timeSeconds: 180 });
      await log(s.mia.as, {
        timeSeconds: 400,
        scaled: true,
        note: 'Band pull-ups, 30 kg',
      });

      const board = await svc(fx).leaderboard(s.john.as, s.fran.id);

      expect(board.rx).toEqual([
        expect.objectContaining({
          rank: 1,
          name: 'Coach Ivo',
          personType: 'TRAINER',
          isMe: false,
          timeSeconds: 180,
        }),
        {
          rank: 2,
          resultId: johnBest.id,
          name: 'John Doe',
          personType: 'TRAINEE',
          isMe: true,
          performedOn: '2026-06-20',
          timeSeconds: 266,
          capped: false,
          rounds: null,
          reps: null,
          loadKg: null,
          note: null,
        },
        expect.objectContaining({
          rank: 3,
          name: 'Mia',
          capped: true,
          reps: 70,
        }),
      ]);
      expect(board.scaled).toEqual([
        expect.objectContaining({
          rank: 1,
          name: 'Mia',
          timeSeconds: 400,
          note: 'Band pull-ups, 30 kg',
        }),
      ]);
      expect(JSON.stringify(board)).not.toContain('JD');
    });

    it('keeps inactive people on it, and is empty for a benchmark without results', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      await svc(fx).create(s.mia.as, {
        benchmarkId: s.deadliftMax.id,
        performedOn: '2026-06-20',
        loadKg: 90,
      });
      await fx.ds
        .getRepository(TraineeProfileEntity)
        .update(s.mia.profile.id, { isActive: false });

      expect(
        (await svc(fx).leaderboard(ADMIN, s.deadliftMax.id)).rx.map(
          (e) => e.name,
        ),
      ).toEqual(['Mia']);
      expect(await svc(fx).leaderboard(ADMIN, s.cindy.id)).toEqual({
        rx: [],
        scaled: [],
      });
      expect(
        await rejectionOf(svc(fx).leaderboard(ADMIN, UNKNOWN_ID)),
      ).toBeInstanceOf(NotFoundException);
    });
  });

  describe('overview', () => {
    it('gives the active benchmarks of a kind by name, each with the top of its boards, the counts and my places', async () => {
      const fx = fixtures();
      const s = await setup(fx);
      await s.benchmarks.create({
        kind: BenchmarkKind.BENCHMARK,
        name: 'Annie',
        scoreType: BenchmarkScoreType.TIME,
        description: '50-40-30-20-10',
        exerciseIds: [s.fran.exercises[0].id],
        isActive: false,
      });
      // Seven people on Fran Rx: the page shows the first five.
      for (let i = 0; i < 7; i++) {
        const t = await fx.trainee(`P${i}`);
        await svc(fx).create(
          {
            role: AccountRole.TRAINEE,
            owner: { traineeProfileId: t.id, trainerProfileId: null },
          },
          {
            benchmarkId: s.fran.id,
            performedOn: '2026-06-20',
            timeSeconds: 200 + i,
          },
        );
      }
      await svc(fx).create(s.john.as, {
        benchmarkId: s.fran.id,
        performedOn: '2026-06-20',
        timeSeconds: 500,
      });
      await svc(fx).create(s.john.as, {
        benchmarkId: s.cindy.id,
        performedOn: '2026-06-20',
        rounds: 10,
        scaled: true,
      });

      const page = await svc(fx).overview(s.john.as, BenchmarkKind.BENCHMARK);

      expect(page.map((b) => b.name)).toEqual(['Cindy', 'Fran']);
      const fran = page[1];
      expect(fran).toMatchObject({
        id: s.fran.id,
        kind: 'BENCHMARK',
        scoreType: 'TIME',
        timeCapSeconds: 600,
        exercises: [
          { id: s.fran.exercises[0].id, name: 'Thruster' },
          { id: s.fran.exercises[1].id, name: 'Pull-up' },
        ],
        rxCount: 8,
        scaled: [],
        scaledCount: 0,
        myRx: { rank: 8, name: 'John Doe', isMe: true, timeSeconds: 500 },
        myScaled: null,
      });
      expect(fran.rx).toHaveLength(LEADERBOARD_PREVIEW_SIZE);
      expect(fran.rx.map((e) => e.name)).toEqual([
        'P0',
        'P1',
        'P2',
        'P3',
        'P4',
      ]);
      expect(page[0]).toMatchObject({
        rx: [],
        rxCount: 0,
        scaledCount: 1,
        myRx: null,
        myScaled: { rank: 1, rounds: 10, reps: 0 },
      });

      const lifts = await svc(fx).overview(ADMIN, BenchmarkKind.LIFT);
      expect(lifts.map((b) => [b.name, b.rxCount, b.myRx])).toEqual([
        ['Deadlift', 0, null],
      ]);
    });
  });
});
