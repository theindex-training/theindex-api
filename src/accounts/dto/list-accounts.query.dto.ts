import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ACCOUNT_LINK_FILTERS, type AccountLinkFilter } from '../account-view';

export class ListAccountsQueryDto {
  @ApiPropertyOptional({
    enum: ACCOUNT_LINK_FILTERS,
    default: 'unlinked',
    description:
      'unlinked: not connected to a profile yet (admin accounts excluded); linked: connected; all: every account',
  })
  @IsOptional()
  @IsIn(ACCOUNT_LINK_FILTERS)
  link?: AccountLinkFilter;

  @ApiPropertyOptional({
    description:
      'Matches the email, the registered name and phone, and the profile name',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
