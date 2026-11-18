import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { BENCHMARK_TIME_CAP_MAX_SECONDS } from './benchmark.dto';

export const RESULT_NOTE_MAX_LENGTH = 500;
export const RESULT_MAX_REPS = 100_000;
export const RESULT_MAX_ROUNDS = 10_000;
export const RESULT_MAX_LOAD_KG = 1000;

@ValidatorConstraint({ name: 'halfKilo' })
class HalfKilo implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      value === null ||
      value === undefined ||
      (typeof value === 'number' && Number.isInteger(value * 2))
    );
  }
  defaultMessage() {
    return 'loadKg must be in steps of 0.5 kg';
  }
}

/** Trimmed; an empty note is no note. */
const noteText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text || null;
});

export class CreateBenchmarkResultDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  benchmarkId!: string;

  @ApiProperty({
    example: '2026-06-20',
    description:
      'The gym-local day it was done, YYYY-MM-DD; not in the future.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'performedOn must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'performedOn must be a real date' })
  performedOn!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'A scaled version (benchmarks only). The note can say how.',
  })
  @IsOptional()
  @IsBoolean()
  scaled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 266,
    description: 'TIME: the time, in seconds',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BENCHMARK_TIME_CAP_MAX_SECONDS)
  timeSeconds?: number | null;

  @ApiPropertyOptional({
    description:
      'TIME with a time cap: not finished in time; send the reps done in `reps`',
  })
  @IsOptional()
  @IsBoolean()
  capped?: boolean | null;

  @ApiPropertyOptional({ nullable: true, description: 'ROUNDS_REPS: rounds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RESULT_MAX_ROUNDS)
  rounds?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'REPS: the reps; ROUNDS_REPS: the reps of the unfinished round; TIME (capped): the reps done',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RESULT_MAX_REPS)
  reps?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 102.5,
    description: 'LOAD: kg, in steps of 0.5',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.5)
  @Max(RESULT_MAX_LOAD_KG)
  @Validate(HalfKilo)
  loadKg?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: RESULT_NOTE_MAX_LENGTH,
    description: 'Optional, e.g. how it was scaled. Empty or null: no note.',
  })
  @IsOptional()
  @noteText
  @IsString()
  @MaxLength(RESULT_NOTE_MAX_LENGTH)
  note?: string | null;
}

/**
 * Every field but the benchmark. The score fields, when any is sent, replace the whole score
 * (send all of them that apply).
 */
export class UpdateBenchmarkResultDto extends PartialType(
  OmitType(CreateBenchmarkResultDto, ['benchmarkId'] as const),
) {}

export class MyResultsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  benchmarkId?: string;
}
