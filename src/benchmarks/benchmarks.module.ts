import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExercisesModule } from '../exercises/exercises.module';
import { ProfilePhotosModule } from '../profile-photos/profile-photos.module';
import { BenchmarkResultsController } from './benchmark-results.controller';
import { BenchmarkResultsService } from './benchmark-results.service';
import {
  BenchmarkEntity,
  BenchmarkExerciseEntity,
  BenchmarkResultEntity,
} from './benchmark.entity';
import {
  BenchmarksController,
  LeaderboardsController,
} from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BenchmarkEntity,
      BenchmarkExerciseEntity,
      BenchmarkResultEntity,
    ]),
    ExercisesModule,
    ProfilePhotosModule,
  ],
  controllers: [
    BenchmarksController,
    LeaderboardsController,
    BenchmarkResultsController,
  ],
  providers: [BenchmarksService, BenchmarkResultsService],
})
export class BenchmarksModule {}
