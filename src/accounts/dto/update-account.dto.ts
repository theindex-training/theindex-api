import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AccountStatus } from '../../common/enums/account-status.enum';

export class UpdateAccountDto {
  @ApiProperty({
    example: 'trainee1@example.com',
    required: false,
    description: 'Updated account email',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 'newPassword123',
    required: false,
    description: 'Updated account password (min 8 characters)',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({
    example: 'newPassword123',
    required: false,
    description: 'Password confirmation (required when password is updated)',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  confirmPassword?: string;

  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
    description: 'Updated account status',
    required: false,
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}
