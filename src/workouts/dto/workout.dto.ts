import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const WORKOUT_TITLE_MAX_LENGTH = 120;
export const WORKOUT_SUMMARY_MAX_LENGTH = 3000;
export const WORKOUT_EXERCISES_MAX = 40;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/**
 * The summary as stored: Windows and old Mac line breaks as "\n", spaces at the end of each line
 * dropped, at most one empty line in a row, and no empty lines around the text.
 */
const summaryText = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : value,
);

export class CreateWorkoutDto {
  @ApiProperty({ example: '2026-11-09', description: 'The day, YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a real date' })
  date!: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: WORKOUT_TITLE_MAX_LENGTH,
    example: 'Helen',
  })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(WORKOUT_TITLE_MAX_LENGTH)
  title?: string | null;

  @ApiProperty({
    maxLength: WORKOUT_SUMMARY_MAX_LENGTH,
    example:
      '3 rounds for time:\n400-m run\n21 KB swings (35/53 lb)\n12 pull-ups',
    description: 'The workout as people read it: plain text, line breaks kept.',
  })
  @summaryText
  @IsString()
  @IsNotEmpty({ message: 'summary must not be empty' })
  @MaxLength(WORKOUT_SUMMARY_MAX_LENGTH)
  summary!: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: WORKOUT_EXERCISES_MAX,
    description: 'The exercises the workout uses, in order, each once',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WORKOUT_EXERCISES_MAX)
  @ArrayUnique({ message: 'an exercise can be listed only once' })
  @IsUUID('all', { each: true })
  exerciseIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description:
      'The lesson-plan PDF the workout comes from: `sourcePdf.id` of POST /workouts/import-pdf. null removes it.',
  })
  @IsOptional()
  @IsUUID()
  sourcePdfId?: string | null;
}

/** Every field is optional; `exerciseIds`, when sent, replaces the list. */
export class UpdateWorkoutDto extends PartialType(CreateWorkoutDto) {}

export class ListWorkoutsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-09', description: 'First day' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-15', description: 'Last day' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
