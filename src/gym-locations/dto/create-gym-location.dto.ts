import { IsOptional, IsString, Length } from 'class-validator';

export class CreateGymLocationDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 250)
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
