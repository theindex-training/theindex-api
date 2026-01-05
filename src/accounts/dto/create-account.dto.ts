import { IsEmail, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AccountRole } from '../../common/enums/account-role.enum';

export class CreateAccountDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(AccountRole)
  role!: AccountRole;

  @IsOptional()
  @IsUUID()
  trainerProfileId?: string;

  @IsOptional()
  @IsUUID()
  traineeProfileId?: string;
}
