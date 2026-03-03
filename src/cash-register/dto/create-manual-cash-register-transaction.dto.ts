import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateManualCashRegisterTransactionDto {
  @ApiProperty({
    example: 'IN',
    enum: ['IN', 'OUT'],
    description: 'Direction of the manual cash movement',
  })
  @IsIn(['IN', 'OUT'])
  direction!: 'IN' | 'OUT';

  @ApiProperty({
    example: 150000,
    minimum: 1,
    description: 'Transaction amount in cents',
  })
  @IsInt()
  @Min(1)
  amountCents!: number;

  @ApiPropertyOptional({
    example: 'Initial cash register balance',
    description: 'Optional note for auditing purposes',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;
}
