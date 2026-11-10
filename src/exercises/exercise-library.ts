import { ExerciseMeasure, ExerciseModality } from './exercise.enums';

export type LibraryEntry = {
  name: string;
  aliases?: string[];
  measure?: ExerciseMeasure;
  /** The YouTube video on the movement's crossfit.com page. */
  videoId?: string;
};

type Options = { aliases?: string[]; measure?: ExerciseMeasure };

const { DISTANCE, TIME, CALORIES } = ExerciseMeasure;

/** A movement from crossfit.com's list, with the video of its page. */
const cf = (name: string, videoId: string, options: Options = {}) => ({
  name,
  videoId,
  ...options,
});

/** A movement the gym programmes that crossfit.com doesn't list: no video. */
const own = (name: string, options: Options = {}) => ({ name, ...options });

/**
 * The movements a new installation starts with, so the first workout doesn't begin with typing
 * in "Pull-up". Added once, when there are no exercises at all (ExercisesService.seedLibrary);
 * trainers edit, rename and remove them like their own. Descriptions are left to the trainers.
 *
 * - `cf(...)`: every movement on https://www.crossfit.com/crossfit-movements (the A-Z list, read
 *   on 2026-11-10), named as there without the leading "The", with the YouTube video embedded
 *   on its page. Two links on that list lead to "not found"; their working pages are
 *   /essentials/the-burpee and /essentials/hip-back-and-hip-back-extensions.
 * - `own(...)`: the gym's other movements (runs, holds, scaled versions...), which the lesson
 *   plans use.
 *
 * Aliases are the other spellings the PDF import should recognise. A plain "Pull-up",
 * "Toes-to-bar", "Muscle-up" or "Handstand push-up" in a workout is the kipping version, as in
 * CrossFit's own programming. Measures not given are reps.
 */
export const EXERCISE_LIBRARY: Record<ExerciseModality, LibraryEntry[]> = {
  [ExerciseModality.WEIGHTLIFTING]: [
    cf('Back Squat', 'QmZAiBqPvZw'),
    cf('Barbell Front-rack Lunge', 'f3WLs_HutLw', {
      aliases: ['Front-rack lunge'],
    }),
    cf('Bench Press', 'SCVCLChPQFY'),
    cf('Clean', 'Ty14ogq_Vok', { aliases: ['Squat clean'] }),
    cf('Clean and Jerk', 'PjY1rH4_MOA'),
    cf('Clean and Push Jerk', 'GqAEuwXQXRU'),
    cf('Deadlift', '1ZXobu7JvvE'),
    cf('Dumbbell Clean', 'SYxObzJ3gn0'),
    cf('Dumbbell Deadlift', 'JNpUNRPQkAk'),
    cf('Dumbbell Farmers Carry', 'p5MNNosenJc', {
      measure: DISTANCE,
      aliases: ['Farmers carry'],
    }),
    cf('Dumbbell Front Squat', 'B86Zj72LwzA'),
    cf('Dumbbell Front-rack Lunge', '7EmwtpAI8cM'),
    cf('Dumbbell Hang Clean', '8r44xv_Aqbw'),
    cf('Dumbbell Hang Power Clean', 'myc1taX-uBs'),
    cf('Dumbbell Overhead Squat', 'azumEfnk-GI'),
    cf('Dumbbell Overhead Walking Lunge', 'J3DxelcaaMU', { measure: DISTANCE }),
    cf('Dumbbell Power Clean', 'viWI2rEt-HU'),
    cf('Dumbbell Power Snatch', '3mlhF3dptAo'),
    cf('Dumbbell Push Jerk', 'rnN3pYswScE'),
    cf('Dumbbell Push Press', '4tCaD42ghlc'),
    cf('Dumbbell Squat Snatch', 'etK3OPjM3S4', {
      aliases: ['Dumbbell snatch'],
    }),
    cf('Dumbbell Thruster', 'u3wKkZjE8QM'),
    cf('Dumbbell Turkish Get-up', 'saYKvqSscuY', {
      aliases: ['Turkish get-up'],
    }),
    cf('Front Squat', 'uYumuL_G_V0'),
    cf('Good Morning', 'KxYxHr1lkx4'),
    cf('Hang Clean', 'DaKC_BEN5bk', { aliases: ['Hang squat clean'] }),
    cf('Hang Clean and Push Jerk', 'KBpys4KTG5Q'),
    cf('Hang Power Clean', '0aP3tgKZcHQ'),
    cf('Hang Power Snatch', '-mLzQdVAwlw'),
    cf('Hang Snatch', 'IucshEToDyM', { aliases: ['Hang squat snatch'] }),
    cf('Kettlebell Snatch', 'Pm-b2XFeABA'),
    cf('Kettlebell Swing', 'mKDIuUbH94Q', {
      aliases: ['American kettlebell swing'],
    }),
    cf('Medicine-ball Clean', 'KVGhkHSrDJo', { aliases: ['Med-ball clean'] }),
    cf('Muscle Snatch', 'bJYzOo1cNqY'),
    cf('Overhead Squat', 'pn8mqlG0nkE'),
    cf('Power Clean', 'KwYJTpQ_x5A'),
    cf('Power Clean and Split Jerk', 'Sk1vhXhHO_A'),
    cf('Power Snatch', 'TL8SMp7RdXQ'),
    cf('Push Jerk', 'VrHNJXoSyXw'),
    cf('Push Press', 'iaBVSJm78ko'),
    cf('Shoulder Press', '5yWaNOvgFCM', { aliases: ['Strict press', 'Press'] }),
    cf('Slam Ball', 'k9W6g9LvXDI', { aliases: ['Ball slam'] }),
    cf('Snatch', 'GhxhiehJcQY', { aliases: ['Squat snatch'] }),
    cf('Snatch Balance', 'XuFaD1sAVGI'),
    cf('Sots Press', 'eJ9MLnNV6FY'),
    cf('Split Clean', 'a5CR3Bi2Gc8'),
    cf('Split Jerk', 'GUDkOtraHHY', { aliases: ['Jerk'] }),
    cf('Split Snatch', 'VFdCGK8yk-8'),
    cf('Sumo Deadlift', 'ENEg9UF7z7M'),
    cf('Sumo Deadlift High Pull', 'gh55vVlwlQg', { aliases: ['SDHP'] }),
    cf('Thruster', 'L219ltL15zk'),
    cf('Wall-ball Shot', 'EqjGKsiIMCE', { aliases: ['Wall ball'] }),
    cf('Zercher Squat', 'nwx6Ip7hd3I'),
    own('Cluster'),
    own('Romanian deadlift', { aliases: ['RDL'] }),
    own('Overhead lunge'),
    own('Russian kettlebell swing'),
    own('Goblet squat'),
    own('Dumbbell clean and jerk'),
    own('Dumbbell box step-up'),
    own('Devil press'),
    own('Sled push', { measure: DISTANCE }),
    own('Sandbag carry', { measure: DISTANCE }),
  ],
  [ExerciseModality.GYMNASTICS]: [
    cf('AbMat Sit-up', 'VIZX2Ru9qU8', { aliases: ['Sit-up'] }),
    cf('Air Squat', 'rMvwVtlqjTE', { aliases: ['Squat'] }),
    cf('Back Scale', 'Arh2Q_prqvw', { measure: TIME }),
    cf('Box Jump', 'NBY9-kTuHEk'),
    cf('Box Step-up', '5qjqDHOUh-A'),
    cf('Burpee', 'auBLPXO8Fww'),
    cf('Burpee Box Jump-over', 'GLktGkmcvWE'),
    cf('Butterfly Pull-up', 'U_MhBXnlInE'),
    cf('Chest-to-wall Handstand Push-up', 'lkPPVyExFpU'),
    cf('Dip', 'o2qX3Zb5mvg', { aliases: ['Bar dip'] }),
    cf('Double-under', '82jNjDS19lg'),
    cf('Forward Roll From Support', 'xF8ptIfnfBo'),
    cf('Freestanding Handstand Push-up', 'aAErmRDDJKY'),
    cf('Front Scale', 'WgXaf7g0Pyo', { measure: TIME }),
    cf('GHD Back Extension', 'ivDB23Kcv-A', { aliases: ['Back extension'] }),
    cf('GHD Hip and Back Extension', 'QdCzafAXJhY', {
      aliases: ['Hip and back extension'],
    }),
    cf('GHD Hip Extension', 'P0iuN0xygc0', { aliases: ['Hip extension'] }),
    cf('GHD Hip, Back, and Hip-back Extension', 'uha4orxDqSM'),
    cf('GHD Sit-up', 'oFwt7WfnPcc'),
    cf('Glide Kip', '6UYEyhFpN0s'),
    cf('Handstand', '_-9_46by2JI', {
      measure: TIME,
      aliases: ['Handstand hold'],
    }),
    cf('Handstand Pirouette', 'tTnvKzRLCUk'),
    cf('Handstand Push-up Variations', 'qbRbM6d5ddM'),
    cf('Handstand Walk', 'FdgJ9jZIT-Q', { measure: DISTANCE }),
    cf('Hanging L-sit', 'WHi1bvZLwlw', { measure: TIME }),
    cf('Inverted Burpee', 'M6_nkTKhaFY'),
    cf('Kipping Bar Muscle-up', 'OCg3UXgzftc', { aliases: ['Bar muscle-up'] }),
    cf('Kipping Chest-to-bar Pull-up', 'AyPTCEXTjOo', {
      aliases: ['Chest-to-bar pull-up', 'Chest-to-bar'],
    }),
    cf('Kipping Deficit Handstand Push-up', 'DJA1t6Fp5WE', {
      aliases: ['Deficit handstand push-up'],
    }),
    cf('Kipping Handstand Push-up', '9wIkPCS4Mbo', {
      aliases: ['Handstand push-up'],
    }),
    cf('Kipping Muscle-up', 'G8W0BhzrWcs', {
      aliases: ['Muscle-up', 'Ring muscle-up'],
    }),
    cf('Kipping Pull-up', 'lzRo-4pq_AY', { aliases: ['Pull-up'] }),
    cf('Kipping Toes-to-bar', '6dHvTlsMvNY', { aliases: ['Toes-to-bar'] }),
    cf('L Pull-up', 'qeGS55RHBUU'),
    cf('L-sit', '_HbccxgnCg0', { measure: TIME }),
    cf('L-sit on Rings', 'lwcHmXvw-T4', { measure: TIME }),
    cf('L-sit Rope Climb', 'Ewf8rqGRbrE'),
    cf('L-sit to Shoulder Stand', 'OkIPCkXhBmY'),
    cf('Legless Rope Climb', 'rfr-Tw3Pxh8'),
    cf('Modified Rope Climb', 'BsDRv1fiXIY'),
    cf('Pull-over', 'faJDYEZmueM'),
    cf('Push-up', '0pkjOk0EiAk'),
    cf('Ring Dip', 'EznLCDBAPIU'),
    cf('Ring Push-up', 'FRiiZRhapeU'),
    cf('Ring Row', 'sEAOZc77wk8'),
    cf('Rope Climb (Basket)', 'Pa4QUC9AvuA', { aliases: ['Rope climb'] }),
    cf('Rope Climb (Wrapping)', 'zBoTgBpkn7o'),
    cf('Shoot-through', 'sZ9fP4iOmFs'),
    cf('Single-leg Squat (Pistol)', 'keSzg7MaoVQ', {
      aliases: ['Pistol', 'Pistol squat', 'Single-leg squat'],
    }),
    cf('Single-under', 'hCuXYrTOMxI'),
    cf('Skin the Cat', 'ABSpTs17ObA'),
    cf('Straddle Press to Handstand', 'DRYQDMUVgYE'),
    cf('Strict Bar Muscle-up', 'o69WaY_7k2c'),
    cf('Strict Chest-to-bar Pull-up', 'xf69XHAs5w8'),
    cf('Strict Handstand Push-up', '0wDEO6shVjc'),
    cf('Strict Knees-to-elbows', '_DUlB4YpZRw'),
    cf('Strict Muscle-up', 'vJTJFc2wmk4'),
    cf('Strict Pull-up', 'HRV5YKKaeVw'),
    cf('Strict Toes-to-bar', 'xX9Hzi7Onnw'),
    cf('Strict Toes-to-rings', '1zp-B1Vb_Vs'),
    cf('Swing to Backward Roll to Support', 'nwpEUd_Yc_E'),
    cf('Walking Lunge', 'DlhojghkaQ0', {
      measure: DISTANCE,
      aliases: ['Lunge'],
    }),
    cf('Wall Walk', 'NK_OcHEm8yM'),
    cf('Windshield Wiper', 'W2xdEDuR-dE'),
    own('Box jump-over'),
    own('Bar-facing burpee'),
    own('Burpee pull-up'),
    own('Knee push-up', { aliases: ['Push-up from the knees'] }),
    own('Hand-release push-up'),
    own('Jumping pull-up'),
    own('Jumping ring muscle-up'),
    own('Low-ring transition', { aliases: ['Low-ring muscle-up transition'] }),
    own('Knees-to-elbows'),
    own('Hanging knee raise'),
    own('V-up'),
    own('Mountain climber'),
    own('Jumping jack'),
    own('Bear crawl', { measure: DISTANCE }),
    own('Broad jump', { measure: DISTANCE }),
    own('Handstand shoulder tap'),
    own('Plank', { measure: TIME, aliases: ['Plank hold'] }),
    own('Side plank', { measure: TIME }),
    own('Hollow hold', { measure: TIME }),
    own('Pull-up bar hang', {
      measure: TIME,
      aliases: ['Bar hang', 'Dead hang'],
    }),
    own('Ring support', { measure: TIME, aliases: ['Ring support hold'] }),
    own('Wall sit', { measure: TIME }),
  ],
  [ExerciseModality.MONOSTRUCTURAL]: [
    cf('Row', 'fxfhQMbATCw', { measure: DISTANCE, aliases: ['Rowing'] }),
    own('Run', { measure: DISTANCE }),
    own('Shuttle run', { measure: DISTANCE }),
    own('Ski', { measure: DISTANCE, aliases: ['SkiErg'] }),
    own('Bike', { measure: CALORIES, aliases: ['Air bike', 'Assault bike'] }),
    own('C2 bike', { measure: DISTANCE, aliases: ['BikeErg'] }),
    own('Swim', { measure: DISTANCE }),
    own('Walk', { measure: DISTANCE }),
  ],
  [ExerciseModality.OTHER]: [
    own('Rest', { measure: TIME }),
    own('Stretching', { measure: TIME }),
    own('Foam roll', { measure: TIME }),
  ],
};

export const DEFAULT_LIBRARY_MEASURE = ExerciseMeasure.REPS;
