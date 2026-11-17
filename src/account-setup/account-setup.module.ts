import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { AuthModule } from '../auth/auth.module';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountSetupController } from './account-setup.controller';
import { AccountSetupService } from './account-setup.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      AccountEntity,
      TraineeProfileEntity,
      TrainerProfileEntity,
    ]),
  ],
  controllers: [AccountSetupController],
  providers: [AccountSetupService],
})
export class AccountSetupModule {}
