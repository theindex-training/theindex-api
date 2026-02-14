import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateGymSubscriptionDto {
  @ApiPropertyOptional({
    example: 'Club card',
    minLength: 2,
    maxLength: 120,
    description: 'Gym subscription method name',
  })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;
}
