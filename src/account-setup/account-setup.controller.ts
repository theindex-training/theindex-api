import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowDuringSetup } from '../auth/allow-during-setup.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountSetupService } from './account-setup.service';
import { CompleteAccountSetupDto } from './dto/complete-account-setup.dto';

type AuthenticatedRequest = { user: { sub: string } };

/**
 * The first-login setup; always the caller's own account (the id from the token). Reachable
 * before the setup is done, unlike every other guarded route.
 */
@ApiTags('account-setup')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.TRAINEE, AccountRole.TRAINER)
@AllowDuringSetup()
@Controller('account-setup')
export class AccountSetupController {
  constructor(private readonly service: AccountSetupService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.service.get(req.user.sub);
  }

  /** `{ accessToken, account }`, like a login: the new token no longer requires the setup. */
  @Post()
  @HttpCode(200)
  complete(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CompleteAccountSetupDto,
  ) {
    return this.service.complete(req.user.sub, dto);
  }
}
