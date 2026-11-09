/** CrossFit's three modalities, plus everything else (mobility, rest, carries...). */
export enum ExerciseModality {
  WEIGHTLIFTING = 'WEIGHTLIFTING',
  GYMNASTICS = 'GYMNASTICS',
  MONOSTRUCTURAL = 'MONOSTRUCTURAL',
  OTHER = 'OTHER',
}

/** What an amount of a movement is counted in: 21 reps, 400 m, 30 seconds, 15 calories. */
export enum ExerciseMeasure {
  REPS = 'REPS',
  DISTANCE = 'DISTANCE',
  TIME = 'TIME',
  CALORIES = 'CALORIES',
}
