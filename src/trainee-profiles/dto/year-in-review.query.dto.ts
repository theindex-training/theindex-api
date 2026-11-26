import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class YearInReviewQueryDto {
  @ApiProperty({
    description: 'The calendar year (gym-local), e.g. 2026',
    example: 2026,
    minimum: 2000,
    maximum: 2100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}
