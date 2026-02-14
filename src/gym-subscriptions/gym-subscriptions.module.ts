import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GymSubscriptionEntity } from './gym-subscription.entity';
import { GymSubscriptionsController } from './gym-subscriptions.controller';
import { GymSubscriptionsService } from './gym-subscriptions.service';

@Module({
  imports: [TypeOrmModule.forFeature([GymSubscriptionEntity])],
  controllers: [GymSubscriptionsController],
  providers: [GymSubscriptionsService],
  exports: [GymSubscriptionsService],
})
export class GymSubscriptionsModule {}
