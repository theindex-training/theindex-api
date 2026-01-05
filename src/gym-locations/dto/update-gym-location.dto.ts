import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateGymLocationDto {
  @ApiProperty({
    example: 'West Gym',
    minLength: 2,
    maxLength: 120,
    description: 'Gym or training location name',
  })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({
    example: 'Plovdiv, Bulgaria',
    minLength: 2,
    maxLength: 250,
    description: 'Optional address or area description',
  })
  @IsOptional()
  @IsString()
  @Length(2, 250)
  address?: string;

  @ApiPropertyOptional({
    example: 'Main CrossFit hall',
    description: 'Optional free-text notes about the location',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
