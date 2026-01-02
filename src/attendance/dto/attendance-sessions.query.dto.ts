import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class AttendanceSessionsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsUUID()
  trainerId?: string;

  /**
   * Minutes per bucket. Default 60.
   * Keep it bounded to avoid silly values.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(180)
  bucketMinutes?: number;
}
