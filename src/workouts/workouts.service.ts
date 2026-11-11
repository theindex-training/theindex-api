import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ExerciseEntity } from '../exercises/exercise.entity';
import {
  CreateWorkoutDto,
  ListWorkoutsQueryDto,
  UpdateWorkoutDto,
} from './dto/workout.dto';
import { WorkoutEntity, WorkoutExerciseEntity } from './workout.entity';

/** Without a date range the list is the latest workouts, newest first. */
export const WORKOUTS_DEFAULT_LIMIT = 60;

/** Workouts of the day (ADMIN and TRAINER; trainees don't see them yet). */
@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(WorkoutEntity)
    private readonly repo: Repository<WorkoutEntity>,
  ) {}

  /** The workouts of a date range, by day and then as created; without one, the latest. */
  async list(query: ListWorkoutsQueryDto = {}) {
    const ranged = !!(query.from || query.to);
    const qb = this.repo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.exercises', 'we')
      .leftJoinAndSelect('we.exercise', 'e')
      .orderBy('w.date', ranged ? 'ASC' : 'DESC')
      .addOrderBy('w.createdAt', 'ASC')
      .addOrderBy('we.position', 'ASC');
    if (query.from) qb.andWhere('w.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('w.date <= :to', { to: query.to });
    const workouts = await qb.getMany();
    return (ranged ? workouts : workouts.slice(0, WORKOUTS_DEFAULT_LIMIT)).map(
      present,
    );
  }

  async get(id: string) {
    const workout = await this.repo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.exercises', 'we')
      .leftJoinAndSelect('we.exercise', 'e')
      .where('w.id = :id', { id })
      .orderBy('we.position', 'ASC')
      .getOne();
    if (!workout) throw new NotFoundException('Workout not found');
    return present(workout);
  }

  async create(dto: CreateWorkoutDto, accountId: string | null) {
    const exerciseIds = dto.exerciseIds ?? [];
    await this.checkExercises(exerciseIds);
    const id = await this.repo.manager.transaction(async (m) => {
      const workout = await m.save(
        m.create(WorkoutEntity, {
          date: dto.date,
          title: dto.title || null,
          summary: dto.summary,
          createdByAccountId: accountId,
        }),
      );
      await writeExercises(m, workout.id, exerciseIds);
      return workout.id;
    });
    return this.get(id);
  }

  /** Updates the fields sent; `exerciseIds`, when sent, replaces the list. */
  async update(id: string, dto: UpdateWorkoutDto) {
    if (!(await this.repo.exists({ where: { id } }))) {
      throw new NotFoundException('Workout not found');
    }
    if (dto.exerciseIds) await this.checkExercises(dto.exerciseIds);
    await this.repo.manager.transaction(async (m) => {
      const changes: Partial<WorkoutEntity> = {};
      if (dto.date !== undefined) changes.date = dto.date;
      if (dto.title !== undefined) changes.title = dto.title || null;
      if (dto.summary !== undefined) changes.summary = dto.summary;
      // Always touch the row, so updatedAt also moves when only the exercises change.
      await m.update(
        WorkoutEntity,
        { id },
        { ...changes, updatedAt: new Date() },
      );
      if (dto.exerciseIds) await writeExercises(m, id, dto.exerciseIds);
    });
    return this.get(id);
  }

  async delete(id: string) {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException('Workout not found');
    return { deleted: true };
  }

  private async checkExercises(ids: string[]) {
    if (!ids.length) return;
    const found = await this.repo.manager.count(ExerciseEntity, {
      where: { id: In(ids) },
    });
    if (found !== ids.length) throw new BadRequestException('Unknown exercise');
  }
}

async function writeExercises(
  m: EntityManager,
  workoutId: string,
  ids: string[],
) {
  await m.delete(WorkoutExerciseEntity, { workoutId });
  if (ids.length) {
    await m.insert(
      WorkoutExerciseEntity,
      ids.map((exerciseId, position) => ({ workoutId, exerciseId, position })),
    );
  }
}

/** The workout as the API returns it: its exercises in order, with their names and videos. */
function present(workout: WorkoutEntity) {
  return {
    id: workout.id,
    date: workout.date,
    title: workout.title,
    summary: workout.summary,
    exercises: [...workout.exercises]
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        id: link.exercise!.id,
        name: link.exercise!.name,
        videoUrl: link.exercise!.videoUrl,
        isActive: link.exercise!.isActive,
      })),
    createdAt: workout.createdAt,
    updatedAt: workout.updatedAt,
  };
}

export type WorkoutResponse = ReturnType<typeof present>;
