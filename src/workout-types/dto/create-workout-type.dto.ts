import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ScoreType } from '../workout-type.enums';

export const WORKOUT_TYPE_NAME_MAX_LENGTH = 60;
export const WORKOUT_TYPE_DESCRIPTION_MAX_LENGTH = 500;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

export class CreateWorkoutTypeDto {
  @ApiProperty({ example: 'Chipper', maxLength: WORKOUT_TYPE_NAME_MAX_LENGTH })
  @trim
  @IsString()
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(WORKOUT_TYPE_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: WORKOUT_TYPE_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(WORKOUT_TYPE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    enum: ScoreType,
    default: ScoreType.NONE,
    description: 'The score a workout of this type starts with',
  })
  @IsOptional()
  @IsEnum(ScoreType)
  scoreType?: ScoreType;
}
