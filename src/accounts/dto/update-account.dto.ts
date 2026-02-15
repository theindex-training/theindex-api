import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AccountStatus } from '../../common/enums/account-status.enum';

export class UpdateAccountDto {
  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
    description: 'Updated account status',
  })
  @IsEnum(AccountStatus)
  status!: AccountStatus;
}
