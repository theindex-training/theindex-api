import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountProvisioningController } from './account-provisioning.controller';
import { AccountEntity } from './account.entity';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      TrainerProfileEntity,
      TraineeProfileEntity,
    ]),
  ],
  providers: [AccountsService],
  controllers: [AccountsController, AccountProvisioningController],
  exports: [AccountsService],
})
export class AccountsModule {}
