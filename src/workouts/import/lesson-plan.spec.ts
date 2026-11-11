import {
  movementNames,
  movementsInLine,
  parseHeading,
  readLessonPlan,
  rxLines,
} from './lesson-plan';
import { SheetText } from './sheet-layout';

const sheet = (
  rx: string[],
  heading = '261109 | TASK PRIORITY',
): SheetText => ({
  heading,
  rx,
  intermediate: ['3 rounds for time:', '200-m run', '12 ring rows'],
  beginner: ['Same as Rx’d'],
  skill: ['Post-workout skill', 'Accumulate:', '10-15 skin-the-cats'],
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
    expect(parseHeading('261341 | X')).toEqual({
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

describe('rxLines', () => {
  it('joins the lines the PDF wrapped and squeezes spaces', () => {
    expect(
      rxLines([
        '5-4-3-2-1 reps for time of:',
        ' Snatch  (125/185 lb) ',
        '- 30-ft handstand walk after',
        'each round.',
        '',
      ]),
    ).toEqual([
      '5-4-3-2-1 reps for time of:',
      'Snatch (125/185 lb)',
      '- 30-ft handstand walk after each round.',
    ]);
  });
});

describe('movementsInLine', () => {
  it.each([
    ['400-m run', ['Run']],
    ['21 KB swings (35/53 lb)', ['KB swing']],
    ['12 pull-ups', ['Pull-up']],
    ['15/20-cal bike', ['Bike']],
    ['5 ring muscle-ups', ['Ring muscle-up']],
    ['Snatch (125/185 lb)', ['Snatch']],
    ['Deadlift', ['Deadlift']],
    ['Min. 1 | :40 row for calories', ['Row']],
    ['Min. 4 | :40 push-ups from the knees', ['Push-ups from the knee']],
    [':30 side plank/side', ['Side plank']],
    ['1:30 hollow hold', ['Hollow hold']],
    ['10-15 skin-the-cats', ['Skin-the-cat']],
    ['Max-effort pull-up bar hang', ['Pull-up bar hang']],
    ['5 back squats @ 80%', ['Back squat']],
    ['30 seconds of side plank', ['Side plank']],
    ['1,000-m row', ['Row']],
    ['4 power snatches + 4 squat snatches', ['Power snatch', 'Squat snatch']],
    ['- 30-ft handstand walk after each round.', ['Handstand walk']],
    [
      '- 16 handstand shoulder taps after each round.',
      ['Handstand shoulder tap'],
    ],
  ])('%s -> %j', (line, names) => {
    expect(movementsInLine(line)).toEqual(names);
  });

  it.each([
    '3 rounds for time:',
    'AMRAP 12:',
    'EMOM 20:',
    '5-4-3-2-1 reps for time of:',
    '5-3-1-5-3-1-5-3-1',
    '- Score is total reps.',
    '- Rest the remaining :20 in each interval.',
    'Rest, stretch, recover.',
    'Use workout variations. Go heavy.',
  ])('%s names no movement', (line) => {
    expect(movementsInLine(line)).toEqual([]);
  });
});

describe('movementNames', () => {
  it('keeps the order and lists each movement once', () => {
    expect(
      movementNames([
        '10 thrusters',
        '10 pull-ups',
        '10 Thrusters',
        '200-m run',
      ]),
    ).toEqual(['Thruster', 'Pull-up', 'Run']);
  });
});

describe('readLessonPlan', () => {
  it('takes the heading and the RX column only', () => {
    expect(
      readLessonPlan(
        sheet(
          [
            '3 rounds for time:',
            '400-m run',
            '21 KB swings (35/53 lb)',
            '12 pull-ups',
          ],
          '261109 // HELEN | TASK PRIORITY',
        ),
      ),
    ).toEqual({
      sourceCode: '261109',
      date: '2026-11-09',
      title: 'Helen',
      summary:
        '3 rounds for time:\n400-m run\n21 KB swings (35/53 lb)\n12 pull-ups',
      movements: ['Run', 'KB swing', 'Pull-up'],
    });
  });

  it('an empty RX column gives an empty summary and no movements', () => {
    expect(readLessonPlan(sheet([]))).toMatchObject({
      summary: '',
      movements: [],
    });
  });
});
