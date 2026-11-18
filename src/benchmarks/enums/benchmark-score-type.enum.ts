/**
 * How a result is scored, a fixed list (not managed types).
 * - `TIME`: for time, lower is better (Fran). With a time cap, whoever doesn't finish logs the
 *   reps done (`capped`), and ranks after everyone who finished.
 * - `ROUNDS_REPS`: as many rounds (+ reps) as possible (Cindy).
 * - `REPS`: as many reps as possible.
 * - `LOAD`: the heaviest load, in kg. Heavy lifts only, and the only type they have.
 */
export enum BenchmarkScoreType {
  TIME = 'TIME',
  ROUNDS_REPS = 'ROUNDS_REPS',
  REPS = 'REPS',
  LOAD = 'LOAD',
}
