import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TraineeProfileEntity } from './trainee-profile.entity';
import { TraineeProfilesController } from './trainee-profiles.controller';
import { TraineeProfilesService } from './trainee-profiles.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TraineeProfileEntity,
      SubscriptionEntity,
      AttendanceEntity,
    ]),
  ],
  controllers: [TraineeProfilesController],
  providers: [TraineeProfilesService],
  exports: [TraineeProfilesService],
})
export class TraineeProfilesModule {}
