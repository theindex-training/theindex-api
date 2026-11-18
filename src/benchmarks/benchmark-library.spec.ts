import { exerciseKey } from '../exercises/exercise-key';
import { EXERCISE_LIBRARY } from '../exercises/exercise-library';
import { benchmarkNameKey } from './benchmark-name';
import { BENCHMARK_LIBRARY } from './benchmark-library';
import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

describe('BENCHMARK_LIBRARY', () => {
  const exerciseKeys = new Map<string, string>();
  for (const exercise of EXERCISE_LIBRARY) {
    for (const spelling of [exercise.name, ...(exercise.aliases ?? [])]) {
      exerciseKeys.set(exerciseKey(spelling), exercise.name);
    }
  }

  it('names only movements of the starter exercises, each once per entry', () => {
    const missing = BENCHMARK_LIBRARY.flatMap((entry) =>
      entry.movements
        .filter((movement) => !exerciseKeys.has(exerciseKey(movement)))
        .map((movement) => `${entry.name}: ${movement}`),
    );
    expect(missing).toEqual([]);
    for (const entry of BENCHMARK_LIBRARY) {
      const exercises = entry.movements.map((m) =>
        exerciseKeys.get(exerciseKey(m)),
      );
      expect(new Set(exercises).size).toBe(exercises.length);
    }
  });

  it('resolves the plain spellings to the movements CrossFit means', () => {
    const fran = BENCHMARK_LIBRARY.find((e) => e.name === 'Fran')!;
    expect(fran.movements.map((m) => exerciseKeys.get(exerciseKey(m)))).toEqual(
      ['Thruster', 'Kipping Pull-up'],
    );
  });

  it('has unique names, lifts scored by load with one movement, benchmarks never by load', () => {
    const keys = BENCHMARK_LIBRARY.map((e) => benchmarkNameKey(e.name));
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of BENCHMARK_LIBRARY) {
      if (entry.kind === BenchmarkKind.LIFT) {
        expect(entry.scoreType).toBe(BenchmarkScoreType.LOAD);
        expect(entry.movements).toHaveLength(1);
      } else {
        expect(entry.scoreType).not.toBe(BenchmarkScoreType.LOAD);
        expect(entry.description).not.toBe('');
      }
    }
  });

  it('starts with the classics of both kinds', () => {
    const names = (kind: BenchmarkKind) =>
      BENCHMARK_LIBRARY.filter((e) => e.kind === kind).map((e) => e.name);
    expect(names(BenchmarkKind.BENCHMARK)).toEqual(
      expect.arrayContaining(['Fran', 'Annie', 'Murph', 'Cindy']),
    );
    expect(names(BenchmarkKind.LIFT)).toEqual(
      expect.arrayContaining(['Back Squat', 'Deadlift', 'Bench Press']),
    );
  });
});
