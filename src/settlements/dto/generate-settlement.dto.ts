import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class GenerateSettlementDto {
  @ApiProperty({
    example: '2025-12-01',
    description: 'Settlement period start date (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodStart!: string;

  @ApiProperty({
    example: '2025-12-31',
    description: 'Settlement period end date (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodEnd!: string;
}
