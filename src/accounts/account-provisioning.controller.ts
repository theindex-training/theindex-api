import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountsService } from './accounts.service';
import { CreateProvisionedAccountDto } from './dto/create-provisioned-account.dto';

type ProfileType = 'trainer' | 'trainee';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('accounts/provision')
export class AccountProvisioningController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post(':profileType/:profileId')
  async provisionForProfile(
    @Param('profileType') profileType: ProfileType,
    @Param('profileId') profileId: string,
    @Body() dto: CreateProvisionedAccountDto,
  ) {
    const acc = await this.accountsService.provisionForProfile(
      profileType,
      profileId,
      dto,
    );
    return this.accountsService.sanitize(acc);
  }
}
