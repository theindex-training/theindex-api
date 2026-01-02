import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

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
}
