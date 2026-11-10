import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { ExerciseEntity } from '../exercises/exercise.entity';
import { WorkoutTypeEntity } from '../workout-types/workout-type.entity';
import {
  CreateWorkoutDto,
  ListWorkoutsQueryDto,
  UpdateWorkoutDto,
  WorkoutPartDto,
} from './dto/workout.dto';
import { workoutProblems } from './workout-rules';
import {
  InvalidSummaryError,
  normalizeSummary,
  summaryToPlainText,
  WorkoutSummary,
} from './workout-summary';
import {
  WorkoutEntity,
  WorkoutItemEntity,
  WorkoutPartEntity,
  WorkoutVariantEntity,
} from './workout.entity';
import { WORKOUT_LEVEL_ORDER } from './workout.enums';

/** Without a date range the list is the latest workouts, newest first. */
export const WORKOUTS_DEFAULT_LIMIT = 60;

const TREE = {
  parts: { workoutType: true, variants: { items: { exercise: true } } },
} as const;

/**
 * Workouts of the day (ADMIN and TRAINER; trainees don't see them yet). A workout is saved and
 * returned whole, as a tree of parts, levels and items (see workout.entity.ts).
 */
@Injectable()
export class WorkoutsService {
  constructor(
    @InjectRepository(WorkoutEntity)
    private readonly repo: Repository<WorkoutEntity>,
  ) {}

  /** The workouts of a date range, oldest first; without one, the latest, newest first. */
  async list(query: ListWorkoutsQueryDto = {}) {
    const qb = this.repo.createQueryBuilder('w').select('w.id');
    if (query.from) qb.andWhere('w.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('w.date <= :to', { to: query.to });
    const ranged = !!(query.from || query.to);
    qb.orderBy('w.date', ranged ? 'ASC' : 'DESC').addOrderBy('w.createdAt');
    if (!ranged) qb.take(WORKOUTS_DEFAULT_LIMIT);
    const ids = (await qb.getMany()).map((w) => w.id);
    if (!ids.length) return [];

    const workouts = await this.repo.find({
      where: { id: In(ids) },
      relations: TREE,
    });
    const byId = new Map(workouts.map((w) => [w.id, w]));
    return ids.map((id) => present(byId.get(id)!));
  }

  async get(id: string) {
    const workout = await this.repo.findOne({ where: { id }, relations: TREE });
    if (!workout) throw new NotFoundException('Workout not found');
    return present(workout);
  }

  async create(dto: CreateWorkoutDto, accountId: string | null) {
    // An id names an existing part to keep, which only an update can do: taking it here would
    // move another workout's part into this one and wipe its content.
    if (dto.parts.some((part) => part.id)) {
      throw new BadRequestException("A new workout's parts can't have an id");
    }
    const summary = checkSummary(dto.summary);
    const types = await this.checkParts(dto.parts);
    const id = await this.repo.manager.transaction(async (m) => {
      const workout = await m.save(
        m.create(WorkoutEntity, {
          date: dto.date,
          title: dto.title || null,
          notes: dto.notes || null,
          summary,
          summaryText: summaryToPlainText(summary),
          createdByAccountId: accountId,
        }),
      );
      await this.writeParts(m, workout.id, dto.parts, types, []);
      return workout.id;
    });
    return this.get(id);
  }

  /**
   * Updates the fields sent. `parts`, when sent, is the whole new content: a part sent with the
   * id of an existing one keeps that id (results will hang on it); the others are replaced.
   */
  async update(id: string, dto: UpdateWorkoutDto) {
    const existing = await this.repo.findOne({
      where: { id },
      relations: { parts: true },
    });
    if (!existing) throw new NotFoundException('Workout not found');

    const summary =
      dto.summary !== undefined ? checkSummary(dto.summary) : undefined;
    const types = dto.parts ? await this.checkParts(dto.parts) : null;
    if (dto.parts) {
      const known = new Set(existing.parts.map((p) => p.id));
      const sent = dto.parts.flatMap((p) => (p.id ? [p.id] : []));
      if (sent.some((partId) => !known.has(partId))) {
        throw new BadRequestException('A part id is not of this workout');
      }
      if (new Set(sent).size !== sent.length) {
        throw new BadRequestException('A part id appears twice');
      }
    }

    await this.repo.manager.transaction(async (m) => {
      const changes: Partial<WorkoutEntity> = {};
      if (dto.date !== undefined) changes.date = dto.date;
      if (dto.title !== undefined) changes.title = dto.title || null;
      if (dto.notes !== undefined) changes.notes = dto.notes || null;
      if (summary) {
        changes.summary = summary;
        changes.summaryText = summaryToPlainText(summary);
      }
      // Always touch the row, so updatedAt also moves when only the parts change.
      await m.update(
        WorkoutEntity,
        { id },
        { ...changes, updatedAt: new Date() },
      );
      if (dto.parts) {
        await this.writeParts(m, id, dto.parts, types!, existing.parts);
      }
    });
    return this.get(id);
  }

  async delete(id: string) {
    const result = await this.repo.delete({ id });
    if (!result.affected) throw new NotFoundException('Workout not found');
    return { deleted: true };
  }

  /**
   * The rules beyond the DTO: the workout rules, and that every type and exercise exists.
   * Returns the types by id (a part without a score type takes its type's).
   */
  private async checkParts(parts: WorkoutPartDto[]) {
    const problems = workoutProblems(parts);
    if (problems.length) throw new BadRequestException(problems);

    const m = this.repo.manager;
    const typeIds = [...new Set(parts.map((p) => p.workoutTypeId))];
    const types = await m.find(WorkoutTypeEntity, {
      where: { id: In(typeIds) },
    });
    if (types.length !== typeIds.length) {
      throw new BadRequestException('Unknown workout type');
    }
    const exerciseIds = [
      ...new Set(
        parts.flatMap((p) =>
          p.variants.flatMap((v) => v.items.map((i) => i.exerciseId)),
        ),
      ),
    ];
    const found = await m.count(ExerciseEntity, {
      where: { id: In(exerciseIds) },
    });
    if (found !== exerciseIds.length) {
      throw new BadRequestException('Unknown exercise');
    }
    return new Map(types.map((t) => [t.id, t]));
  }

  private async writeParts(
    m: EntityManager,
    workoutId: string,
    parts: WorkoutPartDto[],
    types: Map<string, WorkoutTypeEntity>,
    existing: WorkoutPartEntity[],
  ) {
    const kept = new Set(parts.flatMap((p) => (p.id ? [p.id] : [])));
    const dropped = existing.filter((p) => !kept.has(p.id)).map((p) => p.id);
    if (dropped.length) await m.delete(WorkoutPartEntity, { id: In(dropped) });
    if (kept.size) {
      await m.delete(WorkoutVariantEntity, { partId: In([...kept]) });
    }

    for (const [position, part] of parts.entries()) {
      const fields = {
        workoutId,
        position,
        title: part.title || null,
        workoutTypeId: part.workoutTypeId,
        scoreType: part.scoreType ?? types.get(part.workoutTypeId)!.scoreType,
      };
      let partId = part.id;
      if (partId) {
        await m.update(WorkoutPartEntity, { id: partId }, fields);
      } else {
        partId = (await m.save(m.create(WorkoutPartEntity, fields))).id;
      }

      for (const variant of part.variants) {
        const saved = await m.save(
          m.create(WorkoutVariantEntity, {
            partId,
            level: variant.level,
            rounds: variant.rounds ?? null,
            repScheme: variant.repScheme?.length ? variant.repScheme : null,
            durationSeconds: variant.durationSeconds ?? null,
            timeCapSeconds: variant.timeCapSeconds ?? null,
            intervalSeconds: variant.intervalSeconds ?? null,
            workSeconds: variant.workSeconds ?? null,
            restSeconds: variant.restSeconds ?? null,
            notes: variant.notes || null,
          }),
        );
        await m.insert(
          WorkoutItemEntity,
          variant.items.map((item, itemPosition) => ({
            variantId: saved.id,
            position: itemPosition,
            exerciseId: item.exerciseId,
            measure: item.measure,
            quantity: item.quantity ?? null,
            quantityMax: item.quantityMax ?? null,
            quantityFemale: item.quantityFemale ?? null,
            maxEffort: item.maxEffort ?? false,
            loadKg: item.loadKg ?? null,
            loadFemaleKg: item.loadFemaleKg ?? null,
            loadPercent: item.loadPercent ?? null,
            slot: item.slot ?? null,
            notes: item.notes || null,
          })),
        );
      }
    }
  }
}

/** The summary as stored, or a 400 saying what is wrong with it. */
function checkSummary(input: unknown): WorkoutSummary {
  try {
    return normalizeSummary(input);
  } catch (error) {
    if (error instanceof InvalidSummaryError) {
      throw new BadRequestException([error.message]);
    }
    throw error;
  }
}

/** The workout as the API returns it: the tree in order, with names for types and exercises. */
function present(workout: WorkoutEntity) {
  return {
    id: workout.id,
    date: workout.date,
    title: workout.title,
    notes: workout.notes,
    summary: workout.summary,
    summaryText: workout.summaryText,
    createdAt: workout.createdAt,
    updatedAt: workout.updatedAt,
    parts: [...workout.parts]
      .sort((a, b) => a.position - b.position)
      .map((part) => ({
        id: part.id,
        title: part.title,
        workoutTypeId: part.workoutTypeId,
        workoutType: {
          id: part.workoutType!.id,
          name: part.workoutType!.name,
          code: part.workoutType!.code,
        },
        scoreType: part.scoreType,
        variants: [...part.variants]
          .sort(
            (a, b) =>
              WORKOUT_LEVEL_ORDER.indexOf(a.level) -
              WORKOUT_LEVEL_ORDER.indexOf(b.level),
          )
          .map((variant) => ({
            level: variant.level,
            rounds: variant.rounds,
            repScheme: variant.repScheme,
            durationSeconds: variant.durationSeconds,
            timeCapSeconds: variant.timeCapSeconds,
            intervalSeconds: variant.intervalSeconds,
            workSeconds: variant.workSeconds,
            restSeconds: variant.restSeconds,
            notes: variant.notes,
            items: [...variant.items]
              .sort((a, b) => a.position - b.position)
              .map((item) => ({
                exerciseId: item.exerciseId,
                exercise: { id: item.exercise!.id, name: item.exercise!.name },
                measure: item.measure,
                quantity: item.quantity,
                quantityMax: item.quantityMax,
                quantityFemale: item.quantityFemale,
                maxEffort: item.maxEffort,
                loadKg: item.loadKg,
                loadFemaleKg: item.loadFemaleKg,
                loadPercent: item.loadPercent,
                slot: item.slot,
                notes: item.notes,
              })),
          })),
      })),
  };
}

export type WorkoutResponse = ReturnType<typeof present>;
