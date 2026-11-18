import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BenchmarkKind } from '../enums/benchmark-kind.enum';
import { BenchmarkScoreType } from '../enums/benchmark-score-type.enum';

export const BENCHMARK_NAME_MAX_LENGTH = 80;
export const BENCHMARK_DESCRIPTION_MAX_LENGTH = 3000;
export const BENCHMARK_EXERCISES_MAX = 20;
/** 24 hours. */
export const BENCHMARK_TIME_CAP_MAX_SECONDS = 86_400;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** As a workout's summary: "\n" line breaks, no trailing spaces, at most one empty line in a row. */
const multilineText = Transform(({ value }: { value: unknown }) =>
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

export class CreateBenchmarkDto {
  @ApiProperty({ enum: BenchmarkKind })
  @IsEnum(BenchmarkKind)
  kind!: BenchmarkKind;

  @ApiProperty({ maxLength: BENCHMARK_NAME_MAX_LENGTH, example: 'Fran' })
  @trim
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(BENCHMARK_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({
    enum: BenchmarkScoreType,
    description:
      'TIME, ROUNDS_REPS or REPS for a benchmark (required); a heavy lift is always LOAD.',
  })
  @IsOptional()
  @IsEnum(BenchmarkScoreType)
  scoreType?: BenchmarkScoreType;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: BENCHMARK_TIME_CAP_MAX_SECONDS,
    description: 'TIME only. null removes it.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BENCHMARK_TIME_CAP_MAX_SECONDS)
  timeCapSeconds?: number | null;

  @ApiPropertyOptional({
    maxLength: BENCHMARK_DESCRIPTION_MAX_LENGTH,
    example: 'For time:\n21-15-9 reps of:\nThrusters (43/29 kg)\nPull-ups',
    description:
      'The workout as people read it: plain text, line breaks kept. Required for a benchmark.',
  })
  @IsOptional()
  @multilineText
  @IsString()
  @MaxLength(BENCHMARK_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: BENCHMARK_EXERCISES_MAX,
    description:
      'The exercises it uses, in order, each once: exactly one for a heavy lift.',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'list at least one exercise' })
  @ArrayMaxSize(BENCHMARK_EXERCISES_MAX)
  @ArrayUnique({ message: 'an exercise can be listed only once' })
  @IsUUID('all', { each: true })
  exerciseIds!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Every field but the kind, which never changes; `exerciseIds`, when sent, replaces the list. */
export class UpdateBenchmarkDto extends PartialType(
  OmitType(CreateBenchmarkDto, ['kind'] as const),
) {}

export class ListBenchmarksQueryDto {
  @ApiPropertyOptional({ enum: BenchmarkKind })
  @IsOptional()
  @IsEnum(BenchmarkKind)
  kind?: BenchmarkKind;

  @ApiPropertyOptional({
    description:
      'Only active (true) or inactive (false). Trainees always get the active ones.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class LeaderboardsQueryDto {
  @ApiProperty({ enum: BenchmarkKind })
  @IsEnum(BenchmarkKind)
  kind!: BenchmarkKind;
}
