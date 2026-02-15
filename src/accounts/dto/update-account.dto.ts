import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAccountDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'newStrongPassword123',
    minLength: 8,
    description: 'Account password (min 8 characters)',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({
    example: 'newStrongPassword123',
    minLength: 8,
    description:
      'Password confirmation. Must match password when changing password',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  confirmPassword?: string;
}
