import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { ProfilePhotosModule } from '../profile-photos/profile-photos.module';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import {
  MyProfileController,
  MyProfilePhotoController,
} from './my-profile.controller';
import { MyProfileService } from './my-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountEntity,
      TraineeProfileEntity,
      TrainerProfileEntity,
    ]),
    ProfilePhotosModule,
  ],
  controllers: [MyProfilePhotoController, MyProfileController],
  providers: [MyProfileService],
})
export class MyProfileModule {}
