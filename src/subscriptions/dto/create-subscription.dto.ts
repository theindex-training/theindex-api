import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Plan ID to purchase',
  })
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    example: '2025-12-10',
    description:
      'Subscription start date (ISO date string). Defaults to today if omitted.',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    example: 12000,
    minimum: 0,
    description:
      'Amount paid in cents (optional override; defaults to plan price)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  paidCents?: number;
}
