import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExercisesModule } from '../exercises/exercises.module';
import { WorkoutTypesModule } from '../workout-types/workout-types.module';
import { WorkoutImportService } from './import/workout-import.service';
import {
  WorkoutEntity,
  WorkoutItemEntity,
  WorkoutPartEntity,
  WorkoutVariantEntity,
} from './workout.entity';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkoutEntity,
      WorkoutPartEntity,
      WorkoutVariantEntity,
      WorkoutItemEntity,
    ]),
    ExercisesModule,
    WorkoutTypesModule,
  ],
  controllers: [WorkoutsController],
  providers: [WorkoutsService, WorkoutImportService],
})
export class WorkoutsModule {}
