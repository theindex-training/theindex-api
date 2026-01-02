import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paidCents?: number;
}
