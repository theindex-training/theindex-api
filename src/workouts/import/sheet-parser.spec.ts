import { ExerciseMeasure } from '../../exercises/exercise.enums';
import {
  ScoreType,
  WorkoutTypeCode,
} from '../../workout-types/workout-type.enums';
import { WorkoutLevel } from '../workout.enums';
import { SheetText } from './sheet-layout';
import {
  DraftItem,
  parseColumn,
  parseHeading,
  parseItems,
  parseSheet,
} from './sheet-parser';

const { REPS, DISTANCE, TIME, CALORIES } = ExerciseMeasure;
const { RX, INTERMEDIATE, BEGINNER } = WorkoutLevel;

/** Only the fields that say something, so expectations stay readable. */
function told(item: DraftItem) {
  return Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== null && v !== false),
  );
}
const items = (text: string, bare = true) => parseItems(text, bare).map(told);
const column = (lines: string[]) => {
  const parsed = parseColumn(lines, RX)!;
  const { items: list, level, ...structure } = parsed.variant;
  return {
    typeCode: parsed.typeCode,
    scoreType: parsed.scoreType,
    level,
    structure: Object.fromEntries(
      Object.entries(structure).filter(([, v]) => v !== null),
    ),
    items: list.map(told),
  };
};

const sheet = (over: Partial<SheetText>): SheetText => ({
  heading: '261109 | TASK PRIORITY',
  rx: [],
  intermediate: ['Same as Rx’d'],
  beginner: ['Same as Rx’d'],
  skill: ['Rest, stretch, recover.'],
  ...over,
});

describe('parseHeading', () => {
  it('reads the number as a day and the name when there is one', () => {
    expect(parseHeading('261109 // HELEN | TASK PRIORITY')).toEqual({
      sourceCode: '261109',
      date: '2026-11-09',
      title: 'Helen',
    });
    expect(parseHeading('261113 | HEAVY DAY')).toEqual({
      sourceCode: '261113',
      date: '2026-11-13',
      title: null,
    });
    expect(parseHeading('270102 // FIGHT GONE BAD').title).toBe(
      'Fight Gone Bad',
    );
  });

  it('gives no date for a number that is not a day, and nothing for other text', () => {
    expect(parseHeading('261341 | TASK PRIORITY')).toEqual({
      sourceCode: '261341',
      date: null,
      title: null,
    });
    expect(parseHeading('WORKOUT')).toEqual({
      sourceCode: null,
      date: null,
      title: null,
    });
  });
});

describe('parseItems', () => {
  it('reads reps, with a load written women’s/men’s in pounds as whole kilograms', () => {
    expect(items('12 pull-ups')).toEqual([
      { exerciseName: 'Pull-up', measure: REPS, quantity: 12 },
    ]);
    expect(items('21 KB swings (35/53 lb)')).toEqual([
      {
        exerciseName: 'KB swing',
        measure: REPS,
        quantity: 21,
        loadKg: 24,
        loadFemaleKg: 16,
      },
    ]);
    expect(items('10 thrusters (43 kg)')).toEqual([
      { exerciseName: 'Thruster', measure: REPS, quantity: 10, loadKg: 43 },
    ]);
    expect(items('30 wall balls (20/14 lb)')[0]).toMatchObject({
      loadKg: 9,
      loadFemaleKg: 6,
    });
    expect(items('15 KB swings (1.5 pood)')[0]).toMatchObject({ loadKg: 25 });
  });

  it('reads distances in metres, converting feet, miles and kilometres', () => {
    expect(items('400-m run')).toEqual([
      { exerciseName: 'Run', measure: DISTANCE, quantity: 400 },
    ]);
    expect(items('30-ft handstand walk')[0]).toMatchObject({ quantity: 9 });
    expect(items('1-mile run')[0]).toMatchObject({ quantity: 1609 });
    expect(items('2 km row')[0]).toMatchObject({
      exerciseName: 'Row',
      quantity: 2000,
    });
    expect(items('800/1,000-m C2 bike')[0]).toMatchObject({
      exerciseName: 'C2 bike',
      quantity: 1000,
      quantityFemale: 800,
    });
    // "5 m..." is not five metres of "uscle-ups".
    expect(items('5 muscle-ups')[0]).toMatchObject({
      exerciseName: 'Muscle-up',
      measure: REPS,
      quantity: 5,
    });
  });

  it('reads calories, with the women’s amount first', () => {
    expect(items('15/20-cal bike')).toEqual([
      {
        exerciseName: 'Bike',
        measure: CALORIES,
        quantity: 20,
        quantityFemale: 15,
      },
    ]);
    expect(items('30 calorie row')[0]).toMatchObject({
      exerciseName: 'Row',
      measure: CALORIES,
      quantity: 30,
    });
  });

  it('reads times in seconds', () => {
    expect(items(':30 side plank')).toEqual([
      { exerciseName: 'Side plank', measure: TIME, quantity: 30 },
    ]);
    expect(items('1:30 hollow hold')[0]).toMatchObject({ quantity: 90 });
    expect(items('30 seconds of side plank')[0]).toMatchObject({
      exerciseName: 'Side plank',
      measure: TIME,
      quantity: 30,
    });
    expect(items('2-min plank')[0]).toMatchObject({ quantity: 120 });
  });

  it('reads a range, a max effort and "for calories"', () => {
    expect(items('10-15 skin-the-cats')).toEqual([
      {
        exerciseName: 'Skin-the-cat',
        measure: REPS,
        quantity: 10,
        quantityMax: 15,
      },
    ]);
    expect(items('Max-effort pull-up bar hang')).toEqual([
      { exerciseName: 'Pull-up bar hang', measure: TIME, maxEffort: true },
    ]);
    expect(items('Max reps of push-ups')).toEqual([
      { exerciseName: 'Push-up', measure: REPS, maxEffort: true },
    ]);
    expect(items(':40 row for calories')).toEqual([
      { exerciseName: 'Row', measure: TIME, quantity: 40, maxEffort: true },
    ]);
  });

  it('reads the EMOM minute as the slot', () => {
    expect(items('Min. 3 | :40 ring rows')).toEqual([
      { exerciseName: 'Ring row', measure: TIME, quantity: 40, slot: 3 },
    ]);
  });

  it('splits a complex joined with "+" into its movements', () => {
    expect(items('4 power snatches + 4 squat snatches')).toEqual([
      { exerciseName: 'Power snatch', measure: REPS, quantity: 4 },
      { exerciseName: 'Squat snatch', measure: REPS, quantity: 4 },
    ]);
  });

  it('keeps side marks, bracketed remarks and percentages', () => {
    expect(items(':30 calf foam roll/leg')[0]).toMatchObject({
      exerciseName: 'Calf foam roll',
      notes: 'Per leg',
    });
    expect(items('Handstand walk (15 ft)')[0]).toMatchObject({
      exerciseName: 'Handstand walk',
      notes: '15 ft',
    });
    expect(items('5 back squats @ 80%')[0]).toMatchObject({
      exerciseName: 'Back squat',
      quantity: 5,
      loadPercent: 80,
    });
  });

  it('takes a bare name only where one is allowed, and never a sentence', () => {
    expect(items('Snatch (125/185 lb)')).toEqual([
      { exerciseName: 'Snatch', measure: REPS, loadKg: 84, loadFemaleKg: 57 },
    ]);
    expect(items('Snatch (125/185 lb)', false)).toEqual([]);
    expect(items('Rest, stretch, recover.')).toEqual([]);
    expect(items('Use workout variations. Go heavy.')).toEqual([]);
  });
});

describe('parseColumn', () => {
  it('rounds for time (Helen)', () => {
    expect(
      column([
        '3 rounds for time:',
        '400-m run',
        '21 KB swings (35/53 lb)',
        '12 pull-ups',
      ]),
    ).toEqual({
      typeCode: WorkoutTypeCode.FOR_TIME,
      scoreType: ScoreType.TIME,
      level: RX,
      structure: { rounds: 3 },
      items: [
        { exerciseName: 'Run', measure: DISTANCE, quantity: 400 },
        {
          exerciseName: 'KB swing',
          measure: REPS,
          quantity: 21,
          loadKg: 24,
          loadFemaleKg: 16,
        },
        { exerciseName: 'Pull-up', measure: REPS, quantity: 12 },
      ],
    });
  });

  it('a rep scheme for time, with a wrapped "after each round" line', () => {
    expect(
      column([
        '5-4-3-2-1 reps for time of:',
        'Snatch (125/185 lb)',
        '- 30-ft handstand walk after',
        'each round.',
      ]),
    ).toEqual({
      typeCode: WorkoutTypeCode.FOR_TIME,
      scoreType: ScoreType.TIME,
      level: RX,
      structure: { repScheme: [5, 4, 3, 2, 1] },
      items: [
        { exerciseName: 'Snatch', measure: REPS, loadKg: 84, loadFemaleKg: 57 },
        {
          exerciseName: 'Handstand walk',
          measure: DISTANCE,
          quantity: 9,
          notes: 'After each round',
        },
      ],
    });
    expect(
      column(['21-15-9 reps for time of:', 'Thrusters (65/95 lb)', 'Pull-ups']),
    ).toMatchObject({
      structure: { repScheme: [21, 15, 9] },
      items: [{ exerciseName: 'Thruster' }, { exerciseName: 'Pull-up' }],
    });
  });

  it('AMRAP, in minutes or minutes and seconds', () => {
    expect(
      column(['AMRAP 12:', '15/20-cal bike', '5 ring muscle-ups']),
    ).toEqual({
      typeCode: WorkoutTypeCode.AMRAP,
      scoreType: ScoreType.ROUNDS_REPS,
      level: RX,
      structure: { durationSeconds: 720 },
      items: [
        {
          exerciseName: 'Bike',
          measure: CALORIES,
          quantity: 20,
          quantityFemale: 15,
        },
        { exerciseName: 'Ring muscle-up', measure: REPS, quantity: 5 },
      ],
    });
    expect(column(['AMRAP 7:30:', '10 burpees']).structure).toEqual({
      durationSeconds: 450,
    });
    expect(column(['20-minute AMRAP:', '10 burpees']).typeCode).toBe(
      WorkoutTypeCode.AMRAP,
    );
  });

  it('EMOM with stations scored by total reps: each station is a max effort in its time', () => {
    expect(
      column([
        'EMOM 20:',
        'Min. 1 | :40 row for calories',
        'Min. 2 | :40 sit-ups',
        'Min. 4 | :40 push-ups from the',
        'knees',
        '- Score is total reps.',
        '- Rest the remaining :20 in each',
        'interval.',
      ]),
    ).toEqual({
      typeCode: WorkoutTypeCode.EMOM,
      scoreType: ScoreType.REPS,
      level: RX,
      structure: {
        durationSeconds: 1200,
        intervalSeconds: 60,
        notes: 'Rest the remaining :20 in each interval.',
      },
      items: [
        {
          exerciseName: 'Row',
          measure: TIME,
          quantity: 40,
          maxEffort: true,
          slot: 1,
        },
        {
          exerciseName: 'Sit-up',
          measure: TIME,
          quantity: 40,
          maxEffort: true,
          slot: 2,
        },
        {
          exerciseName: 'Push-ups from the knee',
          measure: TIME,
          quantity: 40,
          maxEffort: true,
          slot: 4,
        },
      ],
    });
  });

  it('an unscored EMOM keeps its timed stations as plain holds', () => {
    const parsed = column([
      'EMOM 10:',
      'Min. 1 | :30 plank',
      'Min. 2 | 10 burpees',
    ]);

    expect(parsed.scoreType).toBe(ScoreType.NONE);
    expect(parsed.items[0]).toEqual({
      exerciseName: 'Plank',
      measure: TIME,
      quantity: 30,
      slot: 1,
    });
  });

  it('"Every 2:00 for 4 sets" is an interval workout with rounds', () => {
    expect(column(['Every 2:00 for 4 sets:', '5 deadlifts'])).toMatchObject({
      typeCode: WorkoutTypeCode.EMOM,
      structure: { intervalSeconds: 120, rounds: 4 },
      items: [{ exerciseName: 'Deadlift', quantity: 5 }],
    });
    expect(
      column(['Every 3 minutes for 15 minutes:', '400-m run']).structure,
    ).toEqual({ intervalSeconds: 180, durationSeconds: 900 });
  });

  it('a lift with a rep scheme is a heavy day, on two lines or one', () => {
    const heavy = {
      typeCode: WorkoutTypeCode.FOR_LOAD,
      scoreType: ScoreType.LOAD,
      level: RX,
      structure: { repScheme: [5, 3, 1, 5, 3, 1, 5, 3, 1] },
      items: [{ exerciseName: 'Deadlift', measure: REPS }],
    };
    expect(column(['Deadlift', '5-3-1-5-3-1-5-3-1'])).toEqual(heavy);
    expect(column(['Deadlift 5-3-1-5-3-1-5-3-1'])).toEqual(heavy);
  });

  it('Tabata is 8 rounds of 20 on, 10 off', () => {
    expect(column(['Tabata air squats'])).toEqual({
      typeCode: WorkoutTypeCode.TABATA,
      scoreType: ScoreType.REPS,
      level: RX,
      structure: { rounds: 8, workSeconds: 20, restSeconds: 10 },
      items: [{ exerciseName: 'Air squat', measure: REPS, maxEffort: true }],
    });
  });

  it('reads a time cap wherever it is written', () => {
    expect(
      column(['For time:', '100 burpees', '- Time cap: 12:00']).structure,
    ).toEqual({ timeCapSeconds: 720 });
    expect(
      column(['For time:', '100 burpees', '- 15-minute cap.']).structure,
    ).toEqual({ timeCapSeconds: 900 });
  });

  it('work without a known shape is not scored; what is not a movement becomes a note', () => {
    expect(column(['Accumulate:', '10-15 skin-the-cats'])).toEqual({
      typeCode: WorkoutTypeCode.QUALITY,
      scoreType: ScoreType.NONE,
      level: RX,
      structure: { notes: 'Accumulate:' },
      items: [
        {
          exerciseName: 'Skin-the-cat',
          measure: REPS,
          quantity: 10,
          quantityMax: 15,
        },
      ],
    });
    expect(
      column(['1 attempt:', 'Max-effort pull-up bar hang']).structure,
    ).toEqual({ rounds: 1 });
  });

  it('gives null for an empty column', () => {
    expect(parseColumn([], RX)).toBeNull();
    expect(parseColumn(['  '], RX)).toBeNull();
  });
});

describe('parseSheet', () => {
  it('builds one part with a variant per level that has its own workout', () => {
    const draft = parseSheet(
      sheet({
        heading: '261109 // HELEN | TASK PRIORITY',
        rx: ['3 rounds for time:', '400-m run', '12 pull-ups'],
        intermediate: ['3 rounds for time:', '400-m run', '6 pull-ups'],
        beginner: ['3 rounds for time:', '200-m run', '12 ring rows'],
      }),
    );

    expect(draft).toMatchObject({
      sourceCode: '261109',
      date: '2026-11-09',
      title: 'Helen',
      warnings: [],
    });
    expect(draft.parts).toHaveLength(1);
    expect(draft.parts[0].title).toBeNull();
    expect(draft.parts[0].variants.map((v) => v.level)).toEqual([
      RX,
      INTERMEDIATE,
      BEGINNER,
    ]);
    expect(draft.parts[0].variants[2].items[0].quantity).toBe(200);
  });

  it('"Same as Rx’d" adds no variant', () => {
    const draft = parseSheet(
      sheet({
        rx: ['Deadlift', '5-3-1-5-3-1-5-3-1'],
        beginner: ['EMOM 20:', 'Min. 1 | 10 sit-ups'],
      }),
    );

    expect(draft.parts[0].variants.map((v) => v.level)).toEqual([RX, BEGINNER]);
  });

  it('puts pre-workout skill work before the workout and other skill work after, unscored', () => {
    const before = parseSheet(
      sheet({
        rx: ['For time:', '10 snatches (95/135 lb)'],
        skill: [
          'Pre-workout build-up',
          '4 power snatches + 4 squat',
          'snatches',
          '- Build to a complex load that’s',
          'slightly heavier than workout',
          'weight.',
        ],
      }),
    );
    expect(before.parts.map((p) => p.title)).toEqual([
      'Pre-workout build-up',
      null,
    ]);
    expect(before.parts[0]).toMatchObject({
      typeCode: WorkoutTypeCode.QUALITY,
      scoreType: ScoreType.NONE,
    });
    expect(before.parts[0].variants[0].notes).toBe(
      "Build to a complex load that's slightly heavier than workout weight.",
    );
    expect(
      before.parts[0].variants[0].items.map((i) => i.exerciseName),
    ).toEqual(['Power snatch', 'Squat snatch']);

    const after = parseSheet(
      sheet({
        rx: ['AMRAP 12:', '5 ring muscle-ups'],
        skill: [
          'Post-workout challenge',
          '1 attempt:',
          'Max-effort pull-up bar hang',
        ],
      }),
    );
    expect(after.parts.map((p) => p.title)).toEqual([
      null,
      'Post-workout challenge',
    ]);
    expect(after.parts[1].scoreType).toBe(ScoreType.NONE);
  });

  it('"Rest, stretch, recover." is no skill work', () => {
    const draft = parseSheet(sheet({ rx: ['For time:', '50 burpees'] }));

    expect(draft.parts).toHaveLength(1);
    expect(draft.warnings).toEqual([]);
  });

  it('warns about what it could not read instead of guessing', () => {
    const draft = parseSheet(
      sheet({
        heading: '',
        rx: [],
        beginner: ['Scale as needed. Ask your coach.'],
        skill: ['Mobility', 'Choose what you need today. Move well.'],
      }),
    );

    expect(draft.parts).toEqual([]);
    expect(draft.warnings).toEqual([
      'The date could not be read from the heading',
      'The RX workout could not be read',
      'The skill work "Mobility Choose what you need today. Move well." could not be read',
    ]);

    const partly = parseSheet(
      sheet({
        rx: ['For time:', '50 burpees'],
        beginner: ['Scale as needed. Ask your coach.'],
      }),
    );
    expect(partly.warnings).toEqual(['The Beginner workout could not be read']);
    expect(partly.parts[0].variants).toHaveLength(1);
  });
});
