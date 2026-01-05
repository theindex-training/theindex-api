import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AccountRole } from '../../common/enums/account-role.enum';

export class CreateAccountDto {
  @ApiPropertyOptional({ example: 'trainer1@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: AccountRole, example: AccountRole.TRAINEE })
  @IsEnum(AccountRole)
  role!: AccountRole;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  trainerProfileId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  traineeProfileId?: string;
}
