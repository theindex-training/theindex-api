/** The versions of one workout, as CrossFit programmes them. RX is the workout as prescribed. */
export enum WorkoutLevel {
  RX = 'RX',
  INTERMEDIATE = 'INTERMEDIATE',
  BEGINNER = 'BEGINNER',
}

export const WORKOUT_LEVEL_ORDER = [
  WorkoutLevel.RX,
  WorkoutLevel.INTERMEDIATE,
  WorkoutLevel.BEGINNER,
];
