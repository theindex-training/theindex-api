import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'oldPassword123',
    required: false,
    description:
      'Current password. Required when the authenticated user changes their own password.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  currentPassword?: string;

  @ApiProperty({
    example: 'newPassword123',
    description: 'New password (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  newPassword!: string;

  @ApiProperty({
    example: 'newPassword123',
    description: 'New password confirmation',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  confirmPassword!: string;
}
