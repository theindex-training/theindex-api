import { ExerciseMeasure, ExerciseModality } from './exercise.enums';

type LibraryEntry = {
  name: string;
  aliases?: string[];
  measure?: ExerciseMeasure;
};

const { REPS, DISTANCE, TIME, CALORIES } = ExerciseMeasure;

const lift = (name: string, ...aliases: string[]): LibraryEntry => ({
  name,
  aliases,
});
const timed = (name: string, ...aliases: string[]): LibraryEntry => ({
  name,
  aliases,
  measure: TIME,
});
const far = (name: string, ...aliases: string[]): LibraryEntry => ({
  name,
  aliases,
  measure: DISTANCE,
});

/**
 * The movements a new installation starts with, so the first workout doesn't begin with typing
 * in "Pull-up". Added once, when there are no exercises at all (ExercisesService.seedLibrary);
 * trainers edit, rename and remove them like their own.
 */
export const EXERCISE_LIBRARY: Record<ExerciseModality, LibraryEntry[]> = {
  [ExerciseModality.WEIGHTLIFTING]: [
    lift('Snatch', 'Squat snatch'),
    lift('Power snatch'),
    lift('Hang snatch', 'Hang squat snatch'),
    lift('Hang power snatch'),
    lift('Muscle snatch'),
    lift('Clean', 'Squat clean'),
    lift('Power clean'),
    lift('Hang clean', 'Hang squat clean'),
    lift('Hang power clean'),
    lift('Clean and jerk'),
    lift('Jerk', 'Split jerk'),
    lift('Push jerk'),
    lift('Push press'),
    lift('Shoulder press', 'Strict press', 'Press'),
    lift('Bench press'),
    lift('Thruster'),
    lift('Cluster'),
    lift('Back squat'),
    lift('Front squat'),
    lift('Overhead squat'),
    lift('Deadlift'),
    lift('Sumo deadlift'),
    lift('Sumo deadlift high pull', 'SDHP'),
    lift('Romanian deadlift', 'RDL'),
    lift('Good morning'),
    lift('Overhead lunge'),
    lift('Front-rack lunge'),
    lift('Kettlebell swing', 'American kettlebell swing'),
    lift('Russian kettlebell swing'),
    lift('Kettlebell snatch'),
    lift('Goblet squat'),
    lift('Turkish get-up'),
    lift('Dumbbell snatch'),
    lift('Dumbbell clean and jerk'),
    lift('Dumbbell thruster'),
    lift('Dumbbell hang clean'),
    lift('Dumbbell box step-up'),
    lift('Devil press'),
    lift('Wall ball', 'Wall-ball shot'),
    lift('Medicine-ball clean', 'Med-ball clean'),
    lift('Ball slam', 'Slam ball'),
    far('Farmers carry'),
    far('Sled push'),
    far('Sandbag carry'),
  ],
  [ExerciseModality.GYMNASTICS]: [
    lift('Air squat', 'Squat'),
    lift('Lunge', 'Walking lunge'),
    lift('Pistol', 'Single-leg squat', 'Pistol squat'),
    lift('Box jump'),
    lift('Box jump-over'),
    lift('Box step-up'),
    lift('Burpee'),
    lift('Bar-facing burpee'),
    lift('Burpee box jump-over'),
    lift('Burpee pull-up'),
    lift('Push-up'),
    lift('Knee push-up', 'Push-up from the knees'),
    lift('Hand-release push-up'),
    lift('Handstand push-up'),
    lift('Strict handstand push-up'),
    far('Handstand walk'),
    lift('Handstand shoulder tap'),
    lift('Wall walk'),
    lift('Pull-up', 'Kipping pull-up'),
    lift('Strict pull-up'),
    lift('Jumping pull-up'),
    lift('Chest-to-bar pull-up', 'Chest-to-bar'),
    lift('Bar muscle-up'),
    lift('Ring muscle-up', 'Muscle-up'),
    lift('Jumping ring muscle-up'),
    lift('Low-ring transition', 'Low-ring muscle-up transition'),
    lift('Ring row'),
    lift('Ring dip'),
    lift('Dip', 'Bar dip'),
    lift('Skin-the-cat'),
    lift('Toes-to-bar'),
    lift('Knees-to-elbows'),
    lift('Hanging knee raise'),
    lift('Sit-up', 'AbMat sit-up'),
    lift('GHD sit-up'),
    lift('V-up'),
    lift('Back extension', 'Hip extension'),
    lift('Rope climb'),
    lift('Legless rope climb'),
    lift('Double-under'),
    lift('Single-under'),
    lift('Mountain climber'),
    lift('Jumping jack'),
    far('Bear crawl'),
    far('Broad jump'),
    timed('Plank', 'Plank hold'),
    timed('Side plank'),
    timed('Hollow hold'),
    timed('L-sit'),
    timed('Handstand hold'),
    timed('Pull-up bar hang', 'Bar hang', 'Dead hang'),
    timed('Ring support', 'Ring support hold'),
    timed('Wall sit'),
  ],
  [ExerciseModality.MONOSTRUCTURAL]: [
    far('Run'),
    far('Shuttle run'),
    far('Row', 'Rowing'),
    far('Ski', 'SkiErg'),
    { name: 'Bike', aliases: ['Air bike', 'Assault bike'], measure: CALORIES },
    far('C2 bike', 'BikeErg'),
    far('Swim'),
    far('Walk'),
  ],
  [ExerciseModality.OTHER]: [
    timed('Rest'),
    { name: 'Stretching', measure: TIME },
    { name: 'Foam roll', measure: TIME },
  ],
};

export const DEFAULT_LIBRARY_MEASURE = REPS;
