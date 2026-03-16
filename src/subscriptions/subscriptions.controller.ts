import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

type SubscriptionJwtUser = {
  role: AccountRole;
  traineeProfileId?: string | null;
};

type AuthenticatedRequest = Request & {
  user: SubscriptionJwtUser;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller()
export class SubscriptionsController {
  constructor(private readonly subsService: SubscriptionsService) {}

  private validateTraineeScopeOrThrow(
    req: AuthenticatedRequest,
    traineeId: string,
  ) {
    if (req.user.role !== AccountRole.TRAINEE) return;

    if (!req.user.traineeProfileId || req.user.traineeProfileId !== traineeId) {
      throw new ForbiddenException(
        'TRAINEE can only access subscriptions for their own trainee profile',
      );
    }
  }

  @Post('trainees/:traineeId/subscriptions')
  create(
    @Param('traineeId') traineeId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subsService.createForTrainee(traineeId, dto);
  }

  @Roles(AccountRole.ADMIN, AccountRole.TRAINER, AccountRole.TRAINEE)
  @Get('trainees/:traineeId/subscriptions')
  list(
    @Param('traineeId') traineeId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    this.validateTraineeScopeOrThrow(req, traineeId);

    return this.subsService.listForTrainee(traineeId);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subsService.remove(id);
  }
}
