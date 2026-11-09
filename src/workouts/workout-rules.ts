import { ExerciseMeasure } from '../exercises/exercise.enums';
import { WorkoutLevel } from './workout.enums';

/** The fields of a workout the rules look at (the create DTO and the PDF draft both fit). */
export type RuledItem = {
  measure: ExerciseMeasure;
  quantity?: number | null;
  quantityMax?: number | null;
  quantityFemale?: number | null;
  maxEffort?: boolean;
  loadKg?: number | null;
  loadFemaleKg?: number | null;
};
export type RuledVariant = {
  level: WorkoutLevel;
  repScheme?: number[] | null;
  items: RuledItem[];
};
export type RuledPart = { variants: RuledVariant[] };

/**
 * What must hold for a workout beyond each field's own format, so that every item says how much
 * of the movement is done. Returns one message per problem, naming the part, level and item
 * (all counted from 1); an empty list means the workout is sound.
 */
export function workoutProblems(parts: RuledPart[]): string[] {
  const problems: string[] = [];
  parts.forEach((part, p) => {
    const where = `Part ${p + 1}`;
    const levels = part.variants.map((v) => v.level);
    if (!levels.includes(WorkoutLevel.RX)) {
      problems.push(`${where}: the RX level is required`);
    }
    if (new Set(levels).size !== levels.length) {
      problems.push(`${where}: each level can appear only once`);
    }
    for (const variant of part.variants) {
      const hasScheme = !!variant.repScheme?.length;
      variant.items.forEach((item, i) => {
        const at = `${where}, ${variant.level}, exercise ${i + 1}`;
        const quantity = item.quantity ?? null;
        if (quantity === null && !item.maxEffort) {
          if (item.measure !== ExerciseMeasure.REPS) {
            problems.push(
              `${at}: an amount is required, or mark it max effort`,
            );
          } else if (!hasScheme) {
            problems.push(
              `${at}: reps are required, unless the level has a rep scheme or the exercise is max effort`,
            );
          }
        }
        if (item.quantityMax != null) {
          if (quantity === null) {
            problems.push(`${at}: a range needs its lower amount`);
          } else if (item.quantityMax <= quantity) {
            problems.push(`${at}: the range must end above where it starts`);
          }
        }
        if (item.quantityFemale != null && quantity === null) {
          problems.push(`${at}: a women's amount needs the general amount`);
        }
        if (item.loadFemaleKg != null && item.loadKg == null) {
          problems.push(`${at}: a women's load needs the general load`);
        }
      });
    }
  });
  return problems;
}
