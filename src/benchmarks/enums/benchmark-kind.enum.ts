/**
 * What a catalogue entry is. Both are tracked the same way (people log results, leaderboards rank
 * them); they are shown apart.
 * - `BENCHMARK`: a benchmark workout (Fran, Murph, Cindy...), one or more movements, Rx or scaled.
 * - `LIFT`: a heavy lift: one movement, one rep, the heaviest load (1RM). Never scaled.
 */
export enum BenchmarkKind {
  BENCHMARK = 'BENCHMARK',
  LIFT = 'LIFT',
}
