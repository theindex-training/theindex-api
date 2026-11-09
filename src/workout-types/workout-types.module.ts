import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkoutTypeEntity } from './workout-type.entity';
import { WorkoutTypesController } from './workout-types.controller';
import { WorkoutTypesService } from './workout-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkoutTypeEntity])],
  controllers: [WorkoutTypesController],
  providers: [WorkoutTypesService],
  exports: [WorkoutTypesService],
})
export class WorkoutTypesModule {}
