import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class InactiveTraineesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skipDays!: number;
}
