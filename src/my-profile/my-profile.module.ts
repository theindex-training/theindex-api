import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { MyProfileController } from './my-profile.controller';
import { MyProfileService } from './my-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      TraineeProfileEntity,
      TrainerProfileEntity,
    ]),
  ],
  controllers: [MyProfileController],
  providers: [MyProfileService],
})
export class MyProfileModule {}
