import { clock, scoreFor, ScoreRules } from './benchmark-score';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

const rules = (
  scoreType: BenchmarkScoreType,
  timeCapSeconds: number | null = null,
): ScoreRules => ({ scoreType, timeCapSeconds });

const EMPTY = {
  timeSeconds: null,
  capped: false,
  rounds: null,
  reps: null,
  loadKg: null,
};

describe('scoreFor', () => {
  describe('TIME', () => {
    it('takes a time, keeping only it', () => {
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME), { timeSeconds: 266 }),
      ).toEqual({ score: { ...EMPTY, timeSeconds: 266 } });
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME), {
          timeSeconds: 266,
          capped: false,
          rounds: null,
        }),
      ).toEqual({ score: { ...EMPTY, timeSeconds: 266 } });
    });

    it('needs a time unless capped', () => {
      expect(scoreFor(rules(BenchmarkScoreType.TIME), {})).toEqual({
        error: 'A result for time needs timeSeconds',
      });
    });

    it('refuses a time over the time cap, and accepts one equal to it', () => {
      const capped = rules(BenchmarkScoreType.TIME, 600);
      expect(scoreFor(capped, { timeSeconds: 601 })).toEqual({
        error:
          "The time can't be over the time cap (10:00): log the reps done instead",
      });
      expect(scoreFor(capped, { timeSeconds: 600 })).toEqual({
        score: { ...EMPTY, timeSeconds: 600 },
      });
    });

    it('takes the reps done when capped, only with a time cap', () => {
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME, 600), {
          capped: true,
          reps: 70,
        }),
      ).toEqual({ score: { ...EMPTY, capped: true, reps: 70 } });
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME), { capped: true, reps: 70 }),
      ).toEqual({ error: 'This benchmark has no time cap' });
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME, 600), { capped: true }),
      ).toEqual({ error: 'A capped result needs the reps done' });
    });

    it('refuses a time with a capped result, and reps without capped', () => {
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME, 600), {
          capped: true,
          reps: 70,
          timeSeconds: 500,
        }),
      ).toEqual({
        error: "timeSeconds doesn't apply to a result scored by time (capped)",
      });
      expect(
        scoreFor(rules(BenchmarkScoreType.TIME), { timeSeconds: 266, reps: 3 }),
      ).toEqual({ error: "reps doesn't apply to a result scored by time" });
    });
  });

  describe('ROUNDS_REPS', () => {
    it('takes rounds and reps; reps default to 0', () => {
      const amrap = rules(BenchmarkScoreType.ROUNDS_REPS);
      expect(scoreFor(amrap, { rounds: 12, reps: 7 })).toEqual({
        score: { ...EMPTY, rounds: 12, reps: 7 },
      });
      expect(scoreFor(amrap, { rounds: 12 })).toEqual({
        score: { ...EMPTY, rounds: 12, reps: 0 },
      });
      expect(scoreFor(amrap, { reps: 7 })).toEqual({
        error: 'A result for rounds and reps needs rounds',
      });
      expect(scoreFor(amrap, { rounds: 1, capped: true })).toEqual({
        error:
          "capped doesn't apply to a result scored by rounds and reps (capped)",
      });
    });
  });

  describe('REPS and LOAD', () => {
    it('takes reps for REPS', () => {
      expect(scoreFor(rules(BenchmarkScoreType.REPS), { reps: 0 })).toEqual({
        score: { ...EMPTY, reps: 0 },
      });
      expect(scoreFor(rules(BenchmarkScoreType.REPS), {})).toEqual({
        error: 'A result for reps needs reps',
      });
    });

    it('takes kg for LOAD and nothing else', () => {
      expect(
        scoreFor(rules(BenchmarkScoreType.LOAD), { loadKg: 102.5 }),
      ).toEqual({ score: { ...EMPTY, loadKg: 102.5 } });
      expect(
        scoreFor(rules(BenchmarkScoreType.LOAD), { loadKg: 100, reps: 1 }),
      ).toEqual({ error: "reps doesn't apply to a result scored by load" });
      expect(scoreFor(rules(BenchmarkScoreType.LOAD), {})).toEqual({
        error: 'A result for load needs loadKg',
      });
    });
  });
});

describe('clock', () => {
  it('reads seconds as m:ss, or h:mm:ss from an hour', () => {
    expect(clock(266)).toBe('4:26');
    expect(clock(600)).toBe('10:00');
    expect(clock(5)).toBe('0:05');
    expect(clock(3725)).toBe('1:02:05');
  });
});
