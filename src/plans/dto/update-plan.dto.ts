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
  @IsOptional()
  @IsEnum(PlanType)
  type?: PlanType; // (usually not changed, but allowed)

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  credits?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationDays?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
