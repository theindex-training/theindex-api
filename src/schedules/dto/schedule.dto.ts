import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A training time given by its hours: an existing one is reused, otherwise it is created. */
export class ScheduleTrainingTimeDto {
  @ApiProperty({ example: '07:10', description: 'Start, 24h HH:mm' })
  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '08:10', description: 'End, 24h HH:mm' })
  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime!: string;
}

/** A slot's training time and trainer: send `trainingTimeId` or `trainingTime`, not both. */
class SlotFieldsDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'An existing training time. Or send `trainingTime`.',
  })
  @IsOptional()
  @IsUUID()
  trainingTimeId?: string;

  @ApiPropertyOptional({
    type: ScheduleTrainingTimeDto,
    description:
      'A training time by its hours, created when no training time has them. Or send `trainingTimeId`.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleTrainingTimeDto)
  trainingTime?: ScheduleTrainingTimeDto;

  @ApiProperty({ format: 'uuid', description: 'The trainer leading it' })
  @IsUUID()
  trainerId!: string;
}

export class CreateTemplateSlotDto extends SlotFieldsDto {
  @ApiProperty({
    minimum: 1,
    maximum: 7,
    description: '1 = Monday ... 7 = Sunday',
  })
  @IsInt()
  @Min(1)
  @Max(7)
  weekday!: number;
}

export class UpdateTemplateSlotDto extends PartialType(CreateTemplateSlotDto) {}

export class CreateScheduleSlotDto extends SlotFieldsDto {
  @ApiProperty({
    example: '2026-11-13',
    description: 'A day of the week, YYYY-MM-DD',
  })
  @Matches(DAY, { message: 'date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'date must be a real date' })
  date!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'A workout of the same day that this training follows',
  })
  @IsOptional()
  @IsUUID()
  workoutId?: string | null;
}

/** The day stays; to move a training to another day, remove it and add it there. */
export class UpdateScheduleSlotDto extends PartialType(SlotFieldsDto) {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'A workout of the same day; null removes it',
  })
  @IsOptional()
  @IsUUID()
  workoutId?: string | null;
}

export class ScheduleWeekQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gymId!: string;

  @ApiPropertyOptional({
    example: '2026-11-12',
    description: 'Any day of the week (YYYY-MM-DD); this week by default',
  })
  @IsOptional()
  @Matches(DAY, { message: 'week must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'week must be a real date' })
  week?: string;
}

export class CreateScheduleWeekDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  gymId!: string;

  @ApiProperty({
    example: '2026-11-16',
    description: 'Any day of the week to create (YYYY-MM-DD)',
  })
  @Matches(DAY, { message: 'week must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'week must be a real date' })
  week!: string;
}
