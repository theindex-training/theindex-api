import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateAttendanceDto {
  @IsUUID()
  traineeId!: string;

  @IsUUID()
  trainerId!: string;

  @IsOptional()
  @IsDateString()
  trainedAt?: string; // default now

  /**
   * Date-only entry
   * Example: 2025-12-28
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trainedDate?: string;

  /**
   * Optional time when trainedDate is provided
   * Example: 18:30
   */
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  trainedTime?: string;
}
