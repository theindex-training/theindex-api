import {
  bestPerPerson,
  compareScores,
  leaderboard,
  RankedResult,
} from './benchmark-ranking';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

let seq = 0;
function result(
  owner: string,
  score: Partial<RankedResult>,
  performedOn = '2026-06-20',
  createdAt = '2026-06-20T10:00:00Z',
): RankedResult {
  seq += 1;
  return {
    id: `r${String(seq).padStart(3, '0')}`,
    ownerKey: owner,
    performedOn,
    createdAt: new Date(createdAt),
    timeSeconds: null,
    capped: false,
    rounds: null,
    reps: null,
    loadKg: null,
    ...score,
  };
}

const { TIME, ROUNDS_REPS, REPS, LOAD } = BenchmarkScoreType;
const names = (rows: { ownerKey: string }[]) => rows.map((r) => r.ownerKey);

describe('compareScores', () => {
  it('TIME: a lower time wins; any finished result beats a capped one; capped by more reps', () => {
    const fast = result('a', { timeSeconds: 200 });
    const slow = result('b', { timeSeconds: 900 });
    const cappedMore = result('c', { capped: true, reps: 80 });
    const cappedLess = result('d', { capped: true, reps: 60 });
    expect(compareScores(TIME, fast, slow)).toBeLessThan(0);
    expect(compareScores(TIME, slow, cappedMore)).toBeLessThan(0);
    expect(compareScores(TIME, cappedMore, cappedLess)).toBeLessThan(0);
    expect(compareScores(TIME, cappedLess, slow)).toBeGreaterThan(0);
  });

  it('ROUNDS_REPS: more rounds, then more reps', () => {
    expect(
      compareScores(
        ROUNDS_REPS,
        result('a', { rounds: 13, reps: 0 }),
        result('b', { rounds: 12, reps: 29 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareScores(
        ROUNDS_REPS,
        result('a', { rounds: 12, reps: 5 }),
        result('b', { rounds: 12, reps: 9 }),
      ),
    ).toBeGreaterThan(0);
  });

  it('REPS and LOAD: more is better; equal scores compare as 0', () => {
    expect(
      compareScores(REPS, result('a', { reps: 50 }), result('b', { reps: 40 })),
    ).toBeLessThan(0);
    expect(
      compareScores(
        LOAD,
        result('a', { loadKg: 102.5 }),
        result('b', { loadKg: 105 }),
      ),
    ).toBeGreaterThan(0);
    expect(
      compareScores(
        LOAD,
        result('a', { loadKg: 100 }),
        result('b', { loadKg: 100 }),
      ),
    ).toBe(0);
  });
});

describe('bestPerPerson', () => {
  it('keeps each person once, with their best result; on equal scores the earlier one', () => {
    const early = result('ann', { loadKg: 100 }, '2026-05-01');
    const best = bestPerPerson(LOAD, [
      result('ann', { loadKg: 90 }),
      result('ann', { loadKg: 100 }, '2026-06-01'),
      early,
      result('bob', { loadKg: 80 }),
    ]);
    expect(best).toHaveLength(2);
    expect(best.find((r) => r.ownerKey === 'ann')).toBe(early);
  });
});

describe('leaderboard', () => {
  it('ranks Fran times best first, each person once', () => {
    const board = leaderboard(TIME, [
      result('john', { timeSeconds: 300 }),
      result('john', { timeSeconds: 266 }),
      result('mia', { timeSeconds: 240 }),
      result('leo', { capped: true, reps: 80 }),
      result('eva', { timeSeconds: 420 }),
    ]);
    expect(
      board.map((e) => [e.ownerKey, e.rank, e.timeSeconds ?? e.reps]),
    ).toEqual([
      ['mia', 1, 240],
      ['john', 2, 266],
      ['eva', 3, 420],
      ['leo', 4, 80],
    ]);
  });

  it('gives equal scores the same rank, listing who did it first first, and skips the next ranks', () => {
    const board = leaderboard(LOAD, [
      result('late', { loadKg: 100 }, '2026-06-10'),
      result('first', { loadKg: 100 }, '2026-06-01'),
      result('top', { loadKg: 120 }),
      result('next', { loadKg: 90 }),
    ]);
    expect(names(board)).toEqual(['top', 'first', 'late', 'next']);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 2, 4]);
  });

  it('breaks a same-day tie by who logged it first', () => {
    const board = leaderboard(REPS, [
      result('b', { reps: 30 }, '2026-06-01', '2026-06-01T12:00:00Z'),
      result('a', { reps: 30 }, '2026-06-01', '2026-06-01T09:00:00Z'),
    ]);
    expect(names(board)).toEqual(['a', 'b']);
    expect(board.map((e) => e.rank)).toEqual([1, 1]);
  });

  it('is empty without results', () => {
    expect(leaderboard(TIME, [])).toEqual([]);
  });
});
