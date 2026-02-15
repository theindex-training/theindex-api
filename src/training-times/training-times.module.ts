import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrainingTimeEntity } from './training-time.entity';
import { TrainingTimesController } from './training-times.controller';
import { TrainingTimesService } from './training-times.service';

@Module({
  imports: [TypeOrmModule.forFeature([TrainingTimeEntity])],
  controllers: [TrainingTimesController],
  providers: [TrainingTimesService],
  exports: [TrainingTimesService],
})
export class TrainingTimesModule {}
