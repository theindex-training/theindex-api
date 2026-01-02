import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { AttendancePaymentStatus } from '../../common/enums/attendance-payment-status.enum';

export class ListAttendanceQueryDto {
  /**
   * Calendar day in local time, example: 2025-12-28
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @IsOptional()
  @IsUUID()
  traineeId?: string;

  @IsOptional()
  @IsEnum(AttendancePaymentStatus)
  paymentStatus?: AttendancePaymentStatus;
}
