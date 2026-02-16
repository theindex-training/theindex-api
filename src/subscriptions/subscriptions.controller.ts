import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('jwt')
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
@Controller()
export class SubscriptionsController {
  constructor(private readonly subsService: SubscriptionsService) {}

  @Post('trainees/:traineeId/subscriptions')
  create(
    @Param('traineeId') traineeId: string,
    @Body() dto: CreateSubscriptionDto,
  ) {
    return this.subsService.createForTrainee(traineeId, dto);
  }

  @Get('trainees/:traineeId/subscriptions')
  list(@Param('traineeId') traineeId: string) {
    return this.subsService.listForTrainee(traineeId);
  }

  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subsService.remove(id);
  }
}
