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
  @IsUUID()
  trainerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  traineeIds!: string[];

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @IsString()
  trainedAt?: string; // ISO date-time (backward compatible)

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  trainedDate?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  trainedTime?: string;
}
