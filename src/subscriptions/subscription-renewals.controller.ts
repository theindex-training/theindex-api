import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { SubscriptionRenewalsService } from './subscription-renewals.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller('subscription-renewals')
export class SubscriptionRenewalsController {
  constructor(private readonly renewals: SubscriptionRenewalsService) {}

  @ApiOperation({
    summary:
      'Active trainees by subscription state: PUNCH and TIME, each split into exhausted (most overdue first) and active (fewest trainings or days left first).',
  })
  @Get()
  overview() {
    return this.renewals.overview();
  }
}
