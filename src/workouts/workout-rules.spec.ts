import { ExerciseMeasure } from '../exercises/exercise.enums';
import { RuledItem, RuledPart, workoutProblems } from './workout-rules';
import { WorkoutLevel } from './workout.enums';

const { REPS, DISTANCE, TIME, CALORIES } = ExerciseMeasure;
const { RX, BEGINNER } = WorkoutLevel;

function part(
  items: RuledItem[],
  repScheme: number[] | null = null,
): RuledPart {
  return { variants: [{ level: RX, repScheme, items }] };
}

describe('workoutProblems', () => {
  it('accepts the usual shapes: fixed amounts, a rep scheme, max efforts', () => {
    expect(
      workoutProblems([
        // Helen
        part([
          { measure: DISTANCE, quantity: 400 },
          { measure: REPS, quantity: 21, loadKg: 24, loadFemaleKg: 16 },
          { measure: REPS, quantity: 12 },
        ]),
        // 5-4-3-2-1 snatch, a fixed walk after each round
        part(
          [
            { measure: REPS, loadKg: 84 },
            { measure: DISTANCE, quantity: 9 },
          ],
          [5, 4, 3, 2, 1],
        ),
        // EMOM stations and a max hold
        part([
          { measure: TIME, quantity: 40, maxEffort: true },
          { measure: TIME, maxEffort: true },
          { measure: CALORIES, quantity: 20, quantityFemale: 15 },
          { measure: REPS, quantity: 10, quantityMax: 15 },
        ]),
      ]),
    ).toEqual([]);
  });

  it('requires the RX level, once', () => {
    expect(
      workoutProblems([
        {
          variants: [
            { level: BEGINNER, items: [{ measure: REPS, quantity: 5 }] },
            { level: BEGINNER, items: [{ measure: REPS, quantity: 5 }] },
          ],
        },
      ]),
    ).toEqual([
      'Part 1: the RX level is required',
      'Part 1: each level can appear only once',
    ]);
  });

  it('requires reps unless a rep scheme or max effort gives them', () => {
    expect(workoutProblems([part([{ measure: REPS }])])).toEqual([
      'Part 1, RX, exercise 1: reps are required, unless the level has a rep scheme or the exercise is max effort',
    ]);
    expect(workoutProblems([part([{ measure: REPS }], [])])).toHaveLength(1);
    expect(workoutProblems([part([{ measure: REPS }], [21, 15, 9])])).toEqual(
      [],
    );
    expect(
      workoutProblems([part([{ measure: REPS, maxEffort: true }])]),
    ).toEqual([]);
  });

  it('a rep scheme does not stand in for metres, seconds or calories', () => {
    expect(
      workoutProblems([
        part([{ measure: DISTANCE }, { measure: CALORIES }], [3, 2, 1]),
      ]),
    ).toEqual([
      'Part 1, RX, exercise 1: an amount is required, or mark it max effort',
      'Part 1, RX, exercise 2: an amount is required, or mark it max effort',
    ]);
  });

  it('checks ranges and the women’s values against the general ones', () => {
    expect(
      workoutProblems([
        part([{ measure: REPS, quantity: 10 }]),
        part([
          { measure: REPS, quantity: 15, quantityMax: 15 },
          { measure: REPS, maxEffort: true, quantityMax: 5 },
          { measure: REPS, maxEffort: true, quantityFemale: 5 },
          { measure: REPS, quantity: 5, loadFemaleKg: 20 },
        ]),
      ]),
    ).toEqual([
      'Part 2, RX, exercise 1: the range must end above where it starts',
      'Part 2, RX, exercise 2: a range needs its lower amount',
      "Part 2, RX, exercise 3: a women's amount needs the general amount",
      "Part 2, RX, exercise 4: a women's load needs the general load",
    ]);
  });
});
