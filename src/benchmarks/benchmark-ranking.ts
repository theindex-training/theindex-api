import { Score } from './benchmark-score';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

/** A logged result as the ranking needs it. */
export type RankedResult = Score & {
  id: string;
  /** Whose result it is: one key per person (`trainee:<id>` / `trainer:<id>`). */
  ownerKey: string;
  /** The gym-local day it was done, 'YYYY-MM-DD'. */
  performedOn: string;
  /** When it was logged. */
  createdAt: Date;
};

const desc = (a: number | null, b: number | null) => (b ?? 0) - (a ?? 0);

/**
 * Negative when score `a` is better than `b`, 0 when they are equal.
 * - TIME: a finished result beats a capped one; a lower time wins; among capped ones, more reps.
 * - ROUNDS_REPS: more rounds, then more reps. REPS: more reps. LOAD: more kg.
 */
export function compareScores(
  scoreType: BenchmarkScoreType,
  a: Score,
  b: Score,
): number {
  switch (scoreType) {
    case BenchmarkScoreType.TIME:
      if (a.capped !== b.capped) return a.capped ? 1 : -1;
      return a.capped
        ? desc(a.reps, b.reps)
        : (a.timeSeconds ?? 0) - (b.timeSeconds ?? 0);
    case BenchmarkScoreType.ROUNDS_REPS:
      return desc(a.rounds, b.rounds) || desc(a.reps, b.reps);
    case BenchmarkScoreType.REPS:
      return desc(a.reps, b.reps);
    case BenchmarkScoreType.LOAD:
      return desc(a.loadKg, b.loadKg);
  }
}

/** Better score first; on a tie, whoever did it first (then logged it first). */
export function compareResults(
  scoreType: BenchmarkScoreType,
  a: RankedResult,
  b: RankedResult,
): number {
  return (
    compareScores(scoreType, a, b) ||
    a.performedOn.localeCompare(b.performedOn) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}

/** Each person's best result, from the results given (any order). */
export function bestPerPerson<T extends RankedResult>(
  scoreType: BenchmarkScoreType,
  results: T[],
): T[] {
  const best = new Map<string, T>();
  for (const result of results) {
    const current = best.get(result.ownerKey);
    if (!current || compareResults(scoreType, result, current) < 0) {
      best.set(result.ownerKey, result);
    }
  }
  return [...best.values()];
}

/**
 * A leaderboard: each person once, with their best result, best first. Equal scores share a rank
 * (1, 2, 2, 4), listed by who did it first.
 */
export function leaderboard<T extends RankedResult>(
  scoreType: BenchmarkScoreType,
  results: T[],
): (T & { rank: number })[] {
  const sorted = bestPerPerson(scoreType, results).sort((a, b) =>
    compareResults(scoreType, a, b),
  );
  let rank = 0;
  return sorted.map((result, index) => {
    if (
      index === 0 ||
      compareScores(scoreType, sorted[index - 1], result) !== 0
    ) {
      rank = index + 1;
    }
    return { ...result, rank };
  });
}
