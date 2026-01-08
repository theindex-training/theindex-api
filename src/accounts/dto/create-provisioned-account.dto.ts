import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { AccountRole } from '../../common/enums/account-role.enum';
import { AccountStatus } from '../../common/enums/account-status.enum';

export class CreateProvisionedAccountDto {
  @ApiProperty({ example: 'trainee1@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: AccountRole, example: AccountRole.TRAINEE })
  @IsEnum(AccountRole)
  role!: AccountRole;

  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
    description: 'New status for the account',
  })
  @IsEnum(AccountStatus)
  status!: AccountStatus;

  @ApiProperty({
    example: 'admin123',
    description: 'Password for the account (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'admin123',
    description: 'Password for the account (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  confirmPassword!: string;
}
