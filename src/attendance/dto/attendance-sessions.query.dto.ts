import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class AttendanceSessionsQueryDto {
  @ApiProperty({
    description: 'Start date (local) in YYYY-MM-DD format',
    example: '2026-02-10',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @ApiProperty({
    description: 'End date (local) in YYYY-MM-DD format',
    example: '2026-02-15',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @ApiPropertyOptional({
    description: 'Optional local start time in HH:mm format',
    example: '08:00',
  })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  startTime?: string;

  @ApiPropertyOptional({
    description: 'Optional local end time in HH:mm format',
    example: '22:00',
  })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  endTime?: string;

  @ApiPropertyOptional({
    description: 'Optional trainer ID filter',
    format: 'uuid',
    example: '0c46c842-1ee2-44f5-a930-44a13f0c6b89',
  })
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  /**
   * Minutes per bucket. Default 60.
   * Keep it bounded to avoid silly values.
   */
  @ApiPropertyOptional({
    description: 'Minutes per session bucket. Default: 60',
    minimum: 15,
    maximum: 180,
    example: 60,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(180)
  bucketMinutes?: number;
}
