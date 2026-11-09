import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ExerciseMeasure, ExerciseModality } from '../exercise.enums';
import {
  EXERCISE_ALIASES_MAX,
  EXERCISE_NAME_MAX_LENGTH,
  ExerciseAliases,
  ExerciseName,
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
