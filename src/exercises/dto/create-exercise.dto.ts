import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ExerciseMeasure, ExerciseModality } from '../exercise.enums';
import {
  EXERCISE_ALIASES_MAX,
  EXERCISE_DESCRIPTION_MAX_LENGTH,
  EXERCISE_NAME_MAX_LENGTH,
  EXERCISE_VIDEO_URL_MAX_LENGTH,
  ExerciseAliases,
  ExerciseDescription,
  ExerciseName,
  ExerciseVideoUrl,
} from './exercise-fields';

export class CreateExerciseDto {
  @ApiProperty({
    example: 'Kettlebell swing',
    maxLength: EXERCISE_NAME_MAX_LENGTH,
  })
  @ExerciseName()
  name!: string;

  @ApiPropertyOptional({
    example: ['KB swing'],
    maxItems: EXERCISE_ALIASES_MAX,
    description: 'Other spellings, recognised by the PDF import',
  })
  @IsOptional()
  @ExerciseAliases()
  aliases?: string[];

  @ApiPropertyOptional({
    nullable: true,
    maxLength: EXERCISE_DESCRIPTION_MAX_LENGTH,
    description: 'How the movement is done; empty or null removes it',
  })
  @IsOptional()
  @ExerciseDescription()
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: EXERCISE_VIDEO_URL_MAX_LENGTH,
    example: 'https://youtu.be/rMvwVtlqjTE',
    description:
      'A YouTube video link in any common form; stored as https://www.youtube.com/watch?v=<id>. Empty or null removes it.',
  })
  @IsOptional()
  @ExerciseVideoUrl()
  videoUrl?: string | null;

  @ApiProperty({ enum: ExerciseModality })
  @IsEnum(ExerciseModality)
  modality!: ExerciseModality;

  @ApiPropertyOptional({ enum: ExerciseMeasure, default: ExerciseMeasure.REPS })
  @IsOptional()
  @IsEnum(ExerciseMeasure)
  defaultMeasure?: ExerciseMeasure;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
