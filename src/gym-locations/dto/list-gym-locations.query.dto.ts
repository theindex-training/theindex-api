import { IsBooleanString, IsOptional } from 'class-validator';

export class ListGymLocationsQueryDto {
  @IsOptional()
  @IsBooleanString()
  includeInactive?: string;
}
