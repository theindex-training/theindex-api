import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { MyProfileService } from './my-profile.service';

type AuthenticatedRequest = { user: { sub: string } };

/** A trainee's or trainer's own details; always their own (the account id from the token). */
@ApiTags('my-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.TRAINEE, AccountRole.TRAINER)
@Controller('my-profile')
export class MyProfileController {
  constructor(private readonly service: MyProfileService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.service.get(req.user.sub);
  }

  @Patch()
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdateMyProfileDto) {
    return this.service.update(req.user.sub, dto);
  }
}
