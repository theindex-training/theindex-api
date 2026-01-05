import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AccountStatus } from '../../common/enums/account-status.enum';

export class SetAccountStatusDto {
  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
    description: 'New status for the account',
  })
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}
