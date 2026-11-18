import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

export type BenchmarkLibraryEntry = {
  kind: BenchmarkKind;
  name: string;
  scoreType: BenchmarkScoreType;
  description: string;
  /** Exercise names or aliases from the starter exercises (`exercise-library.ts`), in order. */
  movements: string[];
};

const forTime = (
  name: string,
  description: string[],
  movements: string[],
): BenchmarkLibraryEntry => ({
  kind: BenchmarkKind.BENCHMARK,
  name,
  scoreType: BenchmarkScoreType.TIME,
  description: description.join('\n'),
  movements,
});

const amrap = (
  name: string,
  description: string[],
  movements: string[],
): BenchmarkLibraryEntry => ({
  kind: BenchmarkKind.BENCHMARK,
  name,
  scoreType: BenchmarkScoreType.ROUNDS_REPS,
  description: description.join('\n'),
  movements,
});

/** A heavy lift: named after its exercise, scored by load. */
const lift = (exercise: string): BenchmarkLibraryEntry => ({
  kind: BenchmarkKind.LIFT,
  name: exercise,
  scoreType: BenchmarkScoreType.LOAD,
  description: '',
  movements: [exercise],
});

/**
 * The benchmarks and heavy lifts a new installation starts with: CrossFit's best-known benchmark
 * workouts ("the Girls" and a few Hero workouts) as CrossFit prescribes them, with the loads in kg
 * (men/women), and the usual 1RM lifts. Added once, when there are none at all
 * (BenchmarksService.seedLibrary); trainers edit, add and remove them like their own. No time
 * caps: the gym sets its own.
 */
export const BENCHMARK_LIBRARY: BenchmarkLibraryEntry[] = [
  forTime(
    'Fran',
    ['For time:', '21-15-9 reps of:', 'Thrusters (43/29 kg)', 'Pull-ups'],
    ['Thruster', 'Pull-up'],
  ),
  forTime(
    'Annie',
    ['For time:', '50-40-30-20-10 reps of:', 'Double-unders', 'Sit-ups'],
    ['Double-under', 'Sit-up'],
  ),
  forTime(
    'Grace',
    ['For time:', '30 clean and jerks (61/43 kg)'],
    ['Clean and Jerk'],
  ),
  forTime('Isabel', ['For time:', '30 snatches (61/43 kg)'], ['Snatch']),
  forTime(
    'Helen',
    [
      '3 rounds for time of:',
      '400 m run',
      '21 kettlebell swings (24/16 kg)',
      '12 pull-ups',
    ],
    ['Run', 'Kettlebell Swing', 'Pull-up'],
  ),
  forTime(
    'Diane',
    [
      'For time:',
      '21-15-9 reps of:',
      'Deadlifts (102/70 kg)',
      'Handstand push-ups',
    ],
    ['Deadlift', 'Handstand push-up'],
  ),
  forTime(
    'Elizabeth',
    ['For time:', '21-15-9 reps of:', 'Cleans (61/43 kg)', 'Ring dips'],
    ['Clean', 'Ring Dip'],
  ),
  forTime(
    'Karen',
    ['For time:', '150 wall-ball shots (9/6 kg)'],
    ['Wall-ball Shot'],
  ),
  forTime(
    'Jackie',
    ['For time:', '1000 m row', '50 thrusters (20/15 kg)', '30 pull-ups'],
    ['Row', 'Thruster', 'Pull-up'],
  ),
  forTime(
    'Nancy',
    ['5 rounds for time of:', '400 m run', '15 overhead squats (43/29 kg)'],
    ['Run', 'Overhead Squat'],
  ),
  forTime(
    'Amanda',
    ['For time:', '9-7-5 reps of:', 'Muscle-ups', 'Snatches (61/43 kg)'],
    ['Muscle-up', 'Snatch'],
  ),
  forTime(
    'Kelly',
    [
      '5 rounds for time of:',
      '400 m run',
      '30 box jumps (60/50 cm)',
      '30 wall-ball shots (9/6 kg)',
    ],
    ['Run', 'Box Jump', 'Wall-ball Shot'],
  ),
  forTime(
    'Angie',
    [
      'For time:',
      '100 pull-ups',
      '100 push-ups',
      '100 sit-ups',
      '100 air squats',
    ],
    ['Pull-up', 'Push-up', 'Sit-up', 'Air Squat'],
  ),
  amrap(
    'Cindy',
    [
      'As many rounds as possible in 20 minutes of:',
      '5 pull-ups',
      '10 push-ups',
      '15 air squats',
    ],
    ['Pull-up', 'Push-up', 'Air Squat'],
  ),
  amrap(
    'Mary',
    [
      'As many rounds as possible in 20 minutes of:',
      '5 handstand push-ups',
      '10 pistols, alternating legs',
      '15 pull-ups',
    ],
    ['Handstand push-up', 'Pistol', 'Pull-up'],
  ),
  forTime(
    'Murph',
    [
      'For time:',
      '1.6 km run',
      '100 pull-ups',
      '200 push-ups',
      '300 air squats',
      '1.6 km run',
      '',
      'Partition the pull-ups, push-ups and squats as needed. Rx with a 9/6 kg vest.',
    ],
    ['Run', 'Pull-up', 'Push-up', 'Air Squat'],
  ),
  forTime(
    'DT',
    [
      '5 rounds for time of:',
      '12 deadlifts',
      '9 hang power cleans',
      '6 push jerks',
      '',
      'Barbell 70/47 kg',
    ],
    ['Deadlift', 'Hang Power Clean', 'Push Jerk'],
  ),
  forTime(
    'JT',
    [
      'For time:',
      '21-15-9 reps of:',
      'Handstand push-ups',
      'Ring dips',
      'Push-ups',
    ],
    ['Handstand push-up', 'Ring Dip', 'Push-up'],
  ),

  lift('Back Squat'),
  lift('Front Squat'),
  lift('Overhead Squat'),
  lift('Deadlift'),
  lift('Bench Press'),
  lift('Shoulder Press'),
  lift('Push Press'),
  lift('Push Jerk'),
  lift('Split Jerk'),
  lift('Clean'),
  lift('Power Clean'),
  lift('Clean and Jerk'),
  lift('Snatch'),
  lift('Power Snatch'),
];
