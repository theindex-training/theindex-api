import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExercisesModule } from '../exercises/exercises.module';
import { WorkoutImportService } from './import/workout-import.service';
import { WorkoutEntity, WorkoutExerciseEntity } from './workout.entity';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkoutEntity, WorkoutExerciseEntity]),
    ExercisesModule,
  ],
  controllers: [WorkoutsController],
  providers: [WorkoutsService, WorkoutImportService],
})
export class WorkoutsModule {}
