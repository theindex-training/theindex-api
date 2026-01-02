import { Matches } from 'class-validator';

export class GenerateSettlementDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodStart!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodEnd!: string;
}
