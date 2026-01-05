import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PlanType } from '../../common/enums/plan-type.enum';

export class UpdatePlanDto {
  @ApiProperty({
    enum: PlanType,
    example: PlanType.PUNCH,
    description: 'Type of the plan (PUNCH or TIME)',
  })
  @IsOptional()
  @IsEnum(PlanType)
  type?: PlanType; // (usually not changed, but allowed)

  @ApiProperty({
    example: '12 trainings',
    description: 'Human-readable plan title',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    example: 12000,
    description: 'Price in cents',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({
    example: 12,
    minimum: 1,
    description: 'Number of trainings (required for PUNCH plans)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  credits?: number | null;

  @ApiPropertyOptional({
    example: 30,
    minimum: 1,
    description: 'Duration in days (required for TIME plans)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the plan is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
