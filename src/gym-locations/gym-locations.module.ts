import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GymLocationEntity } from './gym-location.entity';
import { GymLocationsController } from './gym-locations.controller';
import { GymLocationsService } from './gym-locations.service';

@Module({
  imports: [TypeOrmModule.forFeature([GymLocationEntity])],
  providers: [GymLocationsService],
  controllers: [GymLocationsController],
  exports: [GymLocationsService],
})
export class GymLocationsModule {}
