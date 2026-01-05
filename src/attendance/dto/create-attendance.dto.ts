import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateAttendanceDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Trainee profile ID',
  })
  @IsUUID()
  traineeId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Trainee profile ID',
  })
  @IsUUID()
  trainerId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Gym location ID where the training took place',
  })
  @IsUUID()
  locationId!: string;

  @ApiPropertyOptional({
    example: '2025-12-28T18:30:00Z',
    description:
      'Exact datetime when the training occurred. If omitted, trainedDate/trainedTime or current time will be used.',
  })
  @IsOptional()
  @IsDateString()
  trainedAt?: string; // default now

  /**
   * Date-only entry
   * Example: 2025-12-28
   */
  @ApiPropertyOptional({
    example: '2025-12-28',
    description:
      'Date of training (YYYY-MM-DD). Used when trainedAt is not provided.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trainedDate?: string;

  /**
   * Optional time when trainedDate is provided
   * Example: 18:30
   */
  @ApiPropertyOptional({
    example: '18:30',
    description:
      'Optional time of training (HH:mm). Used together with trainedDate.',
  })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  trainedTime?: string;
}
