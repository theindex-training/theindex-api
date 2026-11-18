import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

/** A result's score as stored: only the fields of its benchmark's score type are set. */
export type Score = {
  timeSeconds: number | null;
  /** TIME only: not finished within the time cap; `reps` are the reps done. */
  capped: boolean;
  rounds: number | null;
  reps: number | null;
  loadKg: number | null;
};

/** The score fields as sent; a missing field and null mean the same. */
export type ScoreInput = {
  timeSeconds?: number | null;
  capped?: boolean | null;
  rounds?: number | null;
  reps?: number | null;
  loadKg?: number | null;
};

export type ScoreRules = {
  scoreType: BenchmarkScoreType;
  timeCapSeconds: number | null;
};

export const SCORE_FIELDS = [
  'timeSeconds',
  'capped',
  'rounds',
  'reps',
  'loadKg',
] as const satisfies readonly (keyof ScoreInput)[];

const given = (value: unknown) => value !== undefined && value !== null;

/** `m:ss` (or `h:mm:ss`), as people read a time. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * The score of a result for a benchmark, or why it can't be one. Each score type takes its own
 * fields and no others:
 * - TIME: `timeSeconds` (within the time cap, if there is one), or `capped: true` with the `reps`
 *   done, only when the benchmark has a time cap.
 * - ROUNDS_REPS: `rounds`, and the `reps` of the unfinished round (0 when left out).
 * - REPS: `reps`.
 * - LOAD: `loadKg`.
 */
export function scoreFor(
  rules: ScoreRules,
  input: ScoreInput,
): { score: Score } | { error: string } {
  const capped = input.capped === true;
  const allowed: (keyof ScoreInput)[] = (() => {
    switch (rules.scoreType) {
      case BenchmarkScoreType.TIME:
        return capped ? ['capped', 'reps'] : ['timeSeconds', 'capped'];
      case BenchmarkScoreType.ROUNDS_REPS:
        return ['rounds', 'reps'];
      case BenchmarkScoreType.REPS:
        return ['reps'];
      case BenchmarkScoreType.LOAD:
        return ['loadKg'];
    }
  })();
  // `capped: false` is the same as leaving it out.
  const extra = SCORE_FIELDS.find(
    (field) =>
      !allowed.includes(field) &&
      given(input[field]) &&
      !(field === 'capped' && input.capped === false),
  );
  if (extra) {
    return {
      error: `${extra} doesn't apply to a result scored by ${SCORE_LABELS[rules.scoreType]}${capped ? ' (capped)' : ''}`,
    };
  }

  const empty: Score = {
    timeSeconds: null,
    capped: false,
    rounds: null,
    reps: null,
    loadKg: null,
  };
  switch (rules.scoreType) {
    case BenchmarkScoreType.TIME: {
      if (capped) {
        if (rules.timeCapSeconds === null) {
          return { error: 'This benchmark has no time cap' };
        }
        if (!given(input.reps)) {
          return { error: 'A capped result needs the reps done' };
        }
        return { score: { ...empty, capped: true, reps: input.reps } };
      }
      if (!given(input.timeSeconds)) {
        return { error: 'A result for time needs timeSeconds' };
      }
      if (
        rules.timeCapSeconds !== null &&
        input.timeSeconds > rules.timeCapSeconds
      ) {
        return {
          error: `The time can't be over the time cap (${clock(rules.timeCapSeconds)}): log the reps done instead`,
        };
      }
      return { score: { ...empty, timeSeconds: input.timeSeconds } };
    }
    case BenchmarkScoreType.ROUNDS_REPS:
      if (!given(input.rounds)) {
        return { error: 'A result for rounds and reps needs rounds' };
      }
      return {
        score: { ...empty, rounds: input.rounds, reps: input.reps ?? 0 },
      };
    case BenchmarkScoreType.REPS:
      if (!given(input.reps)) {
        return { error: 'A result for reps needs reps' };
      }
      return { score: { ...empty, reps: input.reps } };
    case BenchmarkScoreType.LOAD:
      if (!given(input.loadKg)) {
        return { error: 'A result for load needs loadKg' };
      }
      return { score: { ...empty, loadKg: input.loadKg } };
  }
}

const SCORE_LABELS: Record<BenchmarkScoreType, string> = {
  [BenchmarkScoreType.TIME]: 'time',
  [BenchmarkScoreType.ROUNDS_REPS]: 'rounds and reps',
  [BenchmarkScoreType.REPS]: 'reps',
  [BenchmarkScoreType.LOAD]: 'load',
};
