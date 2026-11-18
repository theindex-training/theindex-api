import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaModule } from '../media/media.module';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { ProfilePhotoEntity } from './profile-photo.entity';
import { ProfilePhotosService } from './profile-photos.service';

/** Trainees' and trainers' profile photos. Their routes are under `/api/my-profile/photo`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProfilePhotoEntity,
      TraineeProfileEntity,
      TrainerProfileEntity,
    ]),
    MediaModule,
  ],
  providers: [ProfilePhotosService],
  exports: [ProfilePhotosService],
})
export class ProfilePhotosModule {}
