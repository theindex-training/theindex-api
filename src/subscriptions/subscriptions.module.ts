import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { CashRegisterModule } from '../cash-register/cash-register.module';
import { PlanEntity } from '../plans/plan.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { SubscriptionRenewalsController } from './subscription-renewals.controller';
import { SubscriptionRenewalsService } from './subscription-renewals.service';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { SubscriptionEntity } from './subscription.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    CashRegisterModule,
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      PlanEntity,
      TraineeProfileEntity,
      AttendanceEntity,
    ]),
  ],
  controllers: [SubscriptionsController, SubscriptionRenewalsController],
  providers: [
    SubscriptionsService,
    SubscriptionResolverService,
    SubscriptionsCronService,
    SubscriptionRenewalsService,
  ],
  exports: [SubscriptionsService, SubscriptionResolverService],
})
export class SubscriptionsModule {}
