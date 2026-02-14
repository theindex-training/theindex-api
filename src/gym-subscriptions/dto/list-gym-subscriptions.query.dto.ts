import { IsBooleanString, IsOptional } from 'class-validator';

export class ListGymSubscriptionsQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}
