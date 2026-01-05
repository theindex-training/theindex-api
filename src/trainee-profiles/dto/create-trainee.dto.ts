import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateTraineeDto {
  @ApiProperty({
    example: 'Anton',
    minLength: 2,
    maxLength: 100,
    description: 'Trainee name',
  })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({
    example: 'Toni',
    minLength: 1,
    maxLength: 50,
    description: 'Optional nickname used in the gym',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  nickname?: string;

  @ApiPropertyOptional({
    example: '0877777777',
    description: 'Optional phone number',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Optional linked accountId (can be null to unlink)',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the trainee profile is active',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
