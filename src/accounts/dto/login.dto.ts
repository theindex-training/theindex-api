import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  email!: string;

  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(3)
  password!: string;
}
