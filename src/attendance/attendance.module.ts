import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceEntity } from './attendance.entity';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceEntity,
      TraineeProfileEntity,
      TrainerProfileEntity,
      SubscriptionEntity,
      GymLocationEntity,
      GymSubscriptionEntity,
    ]),
    SubscriptionsModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
