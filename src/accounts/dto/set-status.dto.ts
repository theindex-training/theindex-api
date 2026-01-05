import { IsEnum } from 'class-validator';
import { AccountStatus } from '../../common/enums/account-status.enum';

export class SetAccountStatusDto {
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}
