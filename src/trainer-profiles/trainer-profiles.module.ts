import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrainerProfileEntity } from './trainer-profile.entity';
import { TrainerProfilesController } from './trainer-profiles.controller';
import { TrainerProfilesService } from './trainer-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([TrainerProfileEntity])],
  controllers: [TrainerProfilesController],
  providers: [TrainerProfilesService],
  exports: [TrainerProfilesService],
})
export class TrainerProfilesModule {}
