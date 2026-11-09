/**
 * How a result is recorded and ranked. This is what lets results be compared later (personal
 * bests, leaderboards), whatever the type is called.
 */
export enum ScoreType {
  /** Time to finish; lower is better. */
  TIME = 'TIME',
  /** Completed rounds plus extra reps (AMRAP); higher is better. */
  ROUNDS_REPS = 'ROUNDS_REPS',
  /** Total reps; higher is better. */
  REPS = 'REPS',
  /** Heaviest load, in kg; higher is better. */
  LOAD = 'LOAD',
  /** Total calories; higher is better. */
  CALORIES = 'CALORIES',
  /** Total distance, in metres; higher is better. */
  DISTANCE = 'DISTANCE',
  /** Not scored: skill work, warm-ups, practice. */
  NONE = 'NONE',
}

/**
 * The built-in types. They always exist (seeded by code), so the PDF import and the workout form
 * can rely on them; trainers may rename and describe them, and add their own types beside them.
 */
export enum WorkoutTypeCode {
  FOR_TIME = 'FOR_TIME',
  AMRAP = 'AMRAP',
  EMOM = 'EMOM',
  TABATA = 'TABATA',
  FOR_LOAD = 'FOR_LOAD',
  QUALITY = 'QUALITY',
}

export const SYSTEM_WORKOUT_TYPES: {
  code: WorkoutTypeCode;
  name: string;
  description: string;
  scoreType: ScoreType;
}[] = [
  {
    code: WorkoutTypeCode.FOR_TIME,
    name: 'For time',
    description:
      'Finish the prescribed work as fast as possible. The score is the time.',
    scoreType: ScoreType.TIME,
  },
  {
    code: WorkoutTypeCode.AMRAP,
    name: 'AMRAP',
    description:
      'As many rounds and reps as possible in a fixed time. The score is rounds plus reps.',
    scoreType: ScoreType.ROUNDS_REPS,
  },
  {
    code: WorkoutTypeCode.EMOM,
    name: 'EMOM',
    description:
      'Every minute on the minute (or every 2:00, 3:00...): start the work at the top of each interval and rest for what is left of it.',
    scoreType: ScoreType.NONE,
  },
  {
    code: WorkoutTypeCode.TABATA,
    name: 'Tabata',
    description:
      '8 rounds of 20 seconds of work and 10 seconds of rest. The score is the reps.',
    scoreType: ScoreType.REPS,
  },
  {
    code: WorkoutTypeCode.FOR_LOAD,
    name: 'For load',
    description:
      'Build to a heavy set (5-3-1, 5x5, a 1-rep max...). The score is the heaviest load.',
    scoreType: ScoreType.LOAD,
  },
  {
    code: WorkoutTypeCode.QUALITY,
    name: 'For quality',
    description: 'Skill work and practice. Not scored.',
    scoreType: ScoreType.NONE,
  },
];
