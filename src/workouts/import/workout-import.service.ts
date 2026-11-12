import { BadRequestException, Injectable } from '@nestjs/common';
import { exerciseKey } from '../../exercises/exercise-key';
import { ExercisesService } from '../../exercises/exercises.service';
import { readLessonPlan } from './lesson-plan';
import { firstPageText } from './pdf-text';
import { sheetFromItems } from './sheet-layout';

/** Lesson plans are a few hundred kB; anything much larger is not one. */
export const WORKOUT_PDF_MAX_BYTES = 10 * 1024 * 1024;

export type UploadedPdf = { buffer: Buffer; mimetype: string; size: number };

/**
 * Reads a lesson-plan PDF into a draft for the workout form: its day and name, the RX column's
 * text as the summary, and the exercises that column names. Nothing is saved: the trainer
 * reviews the draft and submits it like a workout typed by hand.
 */
@Injectable()
export class WorkoutImportService {
  constructor(private readonly exercises: ExercisesService) {}

  async fromPdf(file: UploadedPdf | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A PDF file is required (field "file")');
    }
    if (!file.buffer.subarray(0, 1024).includes('%PDF-')) {
      throw new BadRequestException('The file is not a PDF');
    }

    let text: Awaited<ReturnType<typeof firstPageText>>;
    try {
      text = await firstPageText(file.buffer);
    } catch {
      throw new BadRequestException('The PDF could not be read');
    }
    const sheet = sheetFromItems(text);
    if (!sheet) {
      throw new BadRequestException(
        'No workout was found in the PDF: the RX, INTERMEDIATE, BEGINNER and SKILL columns are missing',
      );
    }

    const plan = readLessonPlan(sheet);
    const known = await this.exercises.findByKeys(
      plan.movements.map(exerciseKey),
    );
    const warnings: string[] = [];
    if (!plan.date)
      warnings.push('The date could not be read from the heading');
    if (!plan.summary) warnings.push('The RX workout could not be read');

    // Two spellings of one movement in the PDF give it once.
    const listed = new Set<string>();
    const exercises = plan.movements.flatMap((name) => {
      const exercise = known.get(exerciseKey(name));
      if (exercise && listed.has(exercise.id)) return [];
      if (exercise) listed.add(exercise.id);
      return [
        {
          /** As the PDF wrote it (singular): the name of a new exercise, or another name. */
          name,
          exerciseId: exercise?.id ?? null,
          exerciseName: exercise?.name ?? null,
        },
      ];
    });

    return {
      sourceCode: plan.sourceCode,
      date: plan.date,
      title: plan.title,
      summary: plan.summary,
      /** In the RX column's order; `exerciseId` is null for a movement the catalogue lacks. */
      exercises,
      warnings,
    };
  }
}

export type WorkoutImportDraft = Awaited<
  ReturnType<WorkoutImportService['fromPdf']>
>;
