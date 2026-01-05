import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateAttendanceBatchDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Trainer profile ID who led the training session',
  })
  @IsUUID()
  trainerId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: 200,
    description:
      'List of trainee profile IDs that attended the training session',
    example: [
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  traineeIds!: string[];

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
  @IsString()
  trainedAt?: string; // ISO date-time (backward compatible)

  @ApiPropertyOptional({
    example: '2025-12-28',
    description:
      'Date of training (YYYY-MM-DD). Used when trainedAt is not provided.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trainedDate?: string;

  @ApiPropertyOptional({
    example: '18:30',
    description:
      'Optional time of training (HH:mm). Used together with trainedDate.',
  })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  trainedTime?: string;
}
