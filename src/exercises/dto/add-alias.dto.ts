import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EXERCISE_NAME_MAX_LENGTH } from './exercise-fields';

export class AddAliasDto {
  @ApiProperty({
    example: 'Russian KB swings',
    maxLength: EXERCISE_NAME_MAX_LENGTH,
    description:
      'Another spelling of the exercise, e.g. as a lesson plan wrote it',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'alias must not be empty' })
  @MaxLength(EXERCISE_NAME_MAX_LENGTH)
  alias!: string;
}
