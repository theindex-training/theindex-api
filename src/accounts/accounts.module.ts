import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountAdminService } from './account-admin.service';
import { AccountRegistrationService } from './account-registration.service';
import { AccountEntity } from './account.entity';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      TrainerProfileEntity,
      TraineeProfileEntity,
      GymLocationEntity,
      GymSubscriptionEntity,
    ]),
  ],
  providers: [AccountsService, AccountAdminService, AccountRegistrationService],
  controllers: [AccountsController],
  exports: [AccountsService, AccountRegistrationService],
})
export class AccountsModule {}
