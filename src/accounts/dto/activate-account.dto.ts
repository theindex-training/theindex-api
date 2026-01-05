import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ActivateAccountDto {
  @ApiProperty({
    example: 'admin',
    description: 'Email used to activate the invited account',
  })
  @IsString()
  email!: string;

  @ApiProperty({
    example: 'admin123',
    description: 'Password for the account (min 6 characters)',
    minLength: 6,
  })
  @IsString()
  @MinLength(6)
  password!: string;
}
