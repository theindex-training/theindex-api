import { BadRequestException, Injectable } from '@nestjs/common';
import { exerciseKey } from '../../exercises/exercise-key';
import { ExercisesService } from '../../exercises/exercises.service';
import { WorkoutTypesService } from '../../workout-types/workout-types.service';
import { firstPageText } from './pdf-text';
import { sheetFromItems } from './sheet-layout';
import { parseSheet } from './sheet-parser';

/** Lesson plans are a few hundred kB; anything much larger is not one. */
export const WORKOUT_PDF_MAX_BYTES = 10 * 1024 * 1024;

export type UploadedPdf = { buffer: Buffer; mimetype: string; size: number };

/**
 * Reads a workout from a lesson-plan PDF into a draft for the workout form. Nothing is saved:
 * the trainer reviews the draft and submits it like a workout typed by hand.
 */
@Injectable()
export class WorkoutImportService {
  constructor(
    private readonly exercises: ExercisesService,
    private readonly types: WorkoutTypesService,
  ) {}

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

    const draft = parseSheet(sheet);
    const names = draft.parts.flatMap((part) =>
      part.variants.flatMap((v) => v.items.map((i) => i.exerciseName)),
    );
    const known = await this.exercises.findByKeys(names.map(exerciseKey));
    const types = await this.types.byCode();

    const unknown = new Set<string>();
    const parts = draft.parts.map((part) => ({
      title: part.title,
      typeCode: part.typeCode,
      workoutTypeId: types.get(part.typeCode)?.id ?? null,
      scoreType: part.scoreType,
      variants: part.variants.map((variant) => ({
        ...variant,
        items: variant.items.map((item) => {
          const exercise = known.get(exerciseKey(item.exerciseName));
          if (!exercise) unknown.add(item.exerciseName);
          return {
            ...item,
            exerciseId: exercise?.id ?? null,
            exerciseName: exercise?.name ?? item.exerciseName,
          };
        }),
      })),
    }));

    return {
      sourceCode: draft.sourceCode,
      date: draft.date,
      title: draft.title,
      summary: draft.summary,
      parts,
      /** Movements in the PDF that are not in the catalogue yet, to create before saving. */
      unknownExercises: [...unknown],
      warnings: draft.warnings,
    };
  }
}

export type WorkoutImportDraft = Awaited<
  ReturnType<WorkoutImportService['fromPdf']>
>;
