import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountRole } from '../common/enums/account-role.enum';
import { ExercisesService } from '../exercises/exercises.service';
import { BENCHMARK_LIBRARY } from './benchmark-library';
import { BenchmarkResultsService } from './benchmark-results.service';
import { BenchmarkEntity, BenchmarkExerciseEntity } from './benchmark.entity';
import { BenchmarksModule } from './benchmarks.module';
import { BenchmarksService } from './benchmarks.service';
import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
const FRAN = 'For time:\n21-15-9 reps of:\nThrusters (43/29 kg)\nPull-ups';

describe('BenchmarksService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [BenchmarksModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(BenchmarksService);

  async function catalogue(fx: Fixtures) {
    const exercises = fx.moduleRef.get(ExercisesService);
    return {
      thruster: await exercises.create({
        name: 'Thruster',
        description: 'Front squat into a push press.',
        videoUrl: 'https://youtu.be/L219ltL15zk',
      }),
      pullUp: await exercises.create({ name: 'Pull-up' }),
      deadlift: await exercises.create({ name: 'Deadlift' }),
    };
  }

  const fran = (exerciseIds: string[]) => ({
    kind: BenchmarkKind.BENCHMARK,
    name: 'Fran',
    scoreType: BenchmarkScoreType.TIME,
    description: FRAN,
    exerciseIds,
  });

  /** A trainee's result on it, through the real results service. */
  async function logResult(fx: Fixtures, benchmarkId: string, score: object) {
    const trainee = await fx.trainee('Ana');
    return fx.moduleRef.get(BenchmarkResultsService).create(
      {
        role: AccountRole.TRAINEE,
        owner: { traineeProfileId: trainee.id, trainerProfileId: null },
      },
      { benchmarkId, performedOn: '2026-06-20', ...score },
    );
  }

  describe('create / get', () => {
    it('stores a benchmark with its exercises in order, returned with what beginners need', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const created = await svc(fx).create(fran([c.thruster.id, c.pullUp.id]));

      expect(created).toMatchObject({
        kind: 'BENCHMARK',
        name: 'Fran',
        scoreType: 'TIME',
        timeCapSeconds: null,
        description: FRAN,
        isActive: true,
        resultCount: 0,
        exercises: [
          {
            id: c.thruster.id,
            name: 'Thruster',
            description: 'Front squat into a push press.',
            videoUrl: 'https://www.youtube.com/watch?v=L219ltL15zk',
            isActive: true,
          },
          { id: c.pullUp.id, name: 'Pull-up', description: null },
        ],
      });
      expect(await svc(fx).get(created.id)).toEqual(created);
    });

    it('makes a heavy lift LOAD with one exercise and an empty description by default', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);

      const lift = await svc(fx).create({
        kind: BenchmarkKind.LIFT,
        name: 'Deadlift',
        exerciseIds: [c.deadlift.id],
      });

      expect(lift).toMatchObject({
        kind: 'LIFT',
        scoreType: 'LOAD',
        description: '',
        exercises: [{ name: 'Deadlift' }],
      });
    });

    it.each([
      [
        'a lift with two exercises',
        { kind: BenchmarkKind.LIFT, name: 'X', exerciseIds: 'both' },
        'A heavy lift has exactly one exercise',
      ],
      [
        'a lift scored by time',
        {
          kind: BenchmarkKind.LIFT,
          name: 'X',
          scoreType: BenchmarkScoreType.TIME,
          exerciseIds: 'one',
        },
        'A heavy lift is scored by load',
      ],
      [
        'a benchmark scored by load',
        {
          kind: BenchmarkKind.BENCHMARK,
          name: 'X',
          scoreType: BenchmarkScoreType.LOAD,
          description: 'x',
          exerciseIds: 'one',
        },
        'A benchmark is scored by time, rounds and reps, or reps',
      ],
      [
        'a benchmark without a score type',
        {
          kind: BenchmarkKind.BENCHMARK,
          name: 'X',
          description: 'x',
          exerciseIds: 'one',
        },
        'scoreType is required for a benchmark: TIME, ROUNDS_REPS or REPS',
      ],
      [
        'a benchmark without a description',
        {
          kind: BenchmarkKind.BENCHMARK,
          name: 'X',
          scoreType: BenchmarkScoreType.REPS,
          exerciseIds: 'one',
        },
        'description must not be empty',
      ],
      [
        'a time cap on an AMRAP',
        {
          kind: BenchmarkKind.BENCHMARK,
          name: 'X',
          scoreType: BenchmarkScoreType.ROUNDS_REPS,
          timeCapSeconds: 600,
          description: 'x',
          exerciseIds: 'one',
        },
        'Only a benchmark for time has a time cap',
      ],
    ])('refuses %s (400)', async (_label, body, message) => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const { exerciseIds, ...rest } = body;
      const ids =
        exerciseIds === 'both' ? [c.thruster.id, c.pullUp.id] : [c.deadlift.id];

      const error = await rejectionOf(
        svc(fx).create({ ...rest, exerciseIds: ids }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(message);
      expect(await fx.ds.getRepository(BenchmarkEntity).count()).toBe(0);
    });

    it('refuses an unknown exercise (400)', async () => {
      const fx = fixtures();
      const error = await rejectionOf(svc(fx).create(fran([UNKNOWN_ID])));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Unknown exercise');
    });

    it('refuses a name another benchmark or lift has, whatever the case and spaces (409)', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      await svc(fx).create(fran([c.thruster.id]));

      const error = await rejectionOf(
        svc(fx).create({
          kind: BenchmarkKind.LIFT,
          name: '  fran ',
          exerciseIds: [c.deadlift.id],
        }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'A benchmark or lift named "  fran " already exists',
      );
    });

    it('answers 404 for an unknown id', async () => {
      const fx = fixtures();
      expect(await rejectionOf(svc(fx).get(UNKNOWN_ID))).toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('lists benchmarks before lifts, by name in any case; filters by kind and status; trainees get active ones only', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      await svc(fx).create({
        kind: BenchmarkKind.LIFT,
        name: 'Deadlift',
        exerciseIds: [c.deadlift.id],
      });
      await svc(fx).create({ ...fran([c.thruster.id]), name: 'Diane' });
      await svc(fx).create({ ...fran([c.thruster.id]), name: 'DT' });
      await svc(fx).create({
        ...fran([c.thruster.id]),
        name: 'Amanda',
        isActive: false,
      });

      const names = (rows: { name: string }[]) => rows.map((r) => r.name);
      expect(names(await svc(fx).list())).toEqual([
        'Amanda',
        'Diane',
        'DT',
        'Deadlift',
      ]);
      expect(names(await svc(fx).list({ kind: BenchmarkKind.LIFT }))).toEqual([
        'Deadlift',
      ]);
      expect(names(await svc(fx).list({ active: 'false' }))).toEqual([
        'Amanda',
      ]);
      expect(names(await svc(fx).list({ active: 'false' }, true))).toEqual([
        'Diane',
        'DT',
        'Deadlift',
      ]);
    });
  });

  describe('update', () => {
    it('changes the fields sent; exerciseIds replaces the list; renaming to its own name in other case is fine', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(fran([c.thruster.id, c.pullUp.id]));

      const updated = await svc(fx).update(created.id, {
        name: 'FRAN',
        timeCapSeconds: 600,
        exerciseIds: [c.pullUp.id, c.thruster.id],
      });

      expect(updated).toMatchObject({
        name: 'FRAN',
        timeCapSeconds: 600,
        description: FRAN,
        exercises: [{ name: 'Pull-up' }, { name: 'Thruster' }],
      });
      expect(await fx.ds.getRepository(BenchmarkExerciseEntity).count()).toBe(
        2,
      );
    });

    it('drops the time cap when the score type changes away from TIME', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create({
        ...fran([c.thruster.id]),
        timeCapSeconds: 600,
      });

      const updated = await svc(fx).update(created.id, {
        scoreType: BenchmarkScoreType.ROUNDS_REPS,
      });

      expect(updated).toMatchObject({
        scoreType: 'ROUNDS_REPS',
        timeCapSeconds: null,
      });
    });

    it("refuses a change that breaks a lift's rules (400)", async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const lift = await svc(fx).create({
        kind: BenchmarkKind.LIFT,
        name: 'Deadlift',
        exerciseIds: [c.deadlift.id],
      });

      const error = await rejectionOf(
        svc(fx).update(lift.id, { exerciseIds: [c.deadlift.id, c.pullUp.id] }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((await svc(fx).get(lift.id)).exercises).toHaveLength(1);
    });

    it('refuses another score type once it has results (409), and a taken name (409)', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(fran([c.thruster.id]));
      await svc(fx).create({ ...fran([c.thruster.id]), name: 'Grace' });
      await logResult(fx, created.id, { timeSeconds: 266 });

      const typeChange = await rejectionOf(
        svc(fx).update(created.id, { scoreType: BenchmarkScoreType.REPS }),
      );
      const rename = await rejectionOf(
        svc(fx).update(created.id, { name: 'grace' }),
      );

      expect(typeChange).toBeInstanceOf(ConflictException);
      expect(typeChange.message).toBe(
        '"Fran" has results, so its score type can\'t change. Add a new one instead.',
      );
      expect(rename).toBeInstanceOf(ConflictException);
      expect(await svc(fx).get(created.id)).toMatchObject({
        name: 'Fran',
        scoreType: 'TIME',
        resultCount: 1,
      });
    });
  });

  describe('delete', () => {
    it('deletes one without results, with its exercise links', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(fran([c.thruster.id]));

      expect(await svc(fx).delete(created.id)).toEqual({ deleted: true });
      expect(await fx.ds.getRepository(BenchmarkEntity).count()).toBe(0);
      expect(await fx.ds.getRepository(BenchmarkExerciseEntity).count()).toBe(
        0,
      );
    });

    it('refuses one with results (409): it can only be made inactive', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      const created = await svc(fx).create(fran([c.thruster.id]));
      await logResult(fx, created.id, { timeSeconds: 266 });

      const error = await rejectionOf(svc(fx).delete(created.id));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        '"Fran" has results and can\'t be deleted. Make it inactive instead.',
      );
      expect(await fx.ds.getRepository(BenchmarkEntity).count()).toBe(1);
    });

    it('keeps exercises a benchmark uses from being deleted (409)', async () => {
      const fx = fixtures();
      const c = await catalogue(fx);
      await svc(fx).create(fran([c.thruster.id]));

      const error = await rejectionOf(
        fx.moduleRef.get(ExercisesService).delete(c.thruster.id),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        '"Thruster" is used in benchmarks or heavy lifts and can\'t be deleted. Make it inactive instead.',
      );
      await fx.moduleRef.get(ExercisesService).delete(c.pullUp.id);
    });
  });

  describe('seedLibrary', () => {
    it('adds the whole starter library to the starter exercises, once', async () => {
      const fx = fixtures();
      await fx.moduleRef.get(ExercisesService).seedLibrary();

      expect(await svc(fx).seedLibrary()).toBe(BENCHMARK_LIBRARY.length);
      expect(await svc(fx).seedLibrary()).toBe(0);

      const all = await svc(fx).list();
      expect(all).toHaveLength(BENCHMARK_LIBRARY.length);
      const fran = all.find((b) => b.name === 'Fran')!;
      expect(fran).toMatchObject({
        kind: 'BENCHMARK',
        scoreType: 'TIME',
        description: FRAN,
        exercises: [{ name: 'Thruster' }, { name: 'Kipping Pull-up' }],
      });
      expect(all.find((b) => b.name === 'Cindy')).toMatchObject({
        scoreType: 'ROUNDS_REPS',
      });
      expect(all.find((b) => b.name === 'Back Squat')).toMatchObject({
        kind: 'LIFT',
        scoreType: 'LOAD',
        exercises: [{ name: 'Back Squat' }],
      });
    });

    it('leaves out the entries whose movements are missing', async () => {
      const fx = fixtures();
      await catalogue(fx); // Thruster, Pull-up and Deadlift only

      const added = await svc(fx).seedLibrary();

      const names = (await svc(fx).list()).map((b) => b.name);
      expect(names).toEqual(['Fran', 'Deadlift']);
      expect(added).toBe(2);
    });
  });
});
