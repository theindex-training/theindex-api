import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListExercisesQueryDto {
  @ApiPropertyOptional({
    description: 'Only active (true) or inactive (false)',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';

  @ApiPropertyOptional({ description: 'Part of the name or of an alias' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
