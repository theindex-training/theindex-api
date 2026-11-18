import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { exerciseKey } from '../exercises/exercise-key';
import { ExerciseEntity } from '../exercises/exercise.entity';
import { ExercisesService } from '../exercises/exercises.service';
import { BENCHMARK_LIBRARY } from './benchmark-library';
import { benchmarkNameKey, byName } from './benchmark-name';
import {
  BENCHMARK_NAME_INDEX,
  BenchmarkEntity,
  BenchmarkExerciseEntity,
  BenchmarkResultEntity,
} from './benchmark.entity';
import { lockBenchmark } from './benchmark-lock';
import {
  CreateBenchmarkDto,
  ListBenchmarksQueryDto,
  UpdateBenchmarkDto,
} from './dto/benchmark.dto';
import { BenchmarkKind } from './enums/benchmark-kind.enum';
import { BenchmarkScoreType } from './enums/benchmark-score-type.enum';

type Shape = {
  kind: BenchmarkKind;
  scoreType: BenchmarkScoreType;
  timeCapSeconds: number | null;
  description: string;
  exerciseCount: number;
};

/**
 * The catalogue of benchmarks and heavy lifts (ADMIN and TRAINER change it; everyone reads it).
 * Results and leaderboards are in BenchmarkResultsService.
 */
@Injectable()
export class BenchmarksService implements OnModuleInit {
  private readonly log = new Logger(BenchmarksService.name);

  constructor(
    @InjectRepository(BenchmarkEntity)
    private readonly repo: Repository<BenchmarkEntity>,
    private readonly exercises: ExercisesService,
  ) {}

  /** Runs after ExercisesService's (this module imports it), so the starter exercises exist. */
  async onModuleInit() {
    const added = await this.seedLibrary();
    if (added) this.log.log(`Added ${added} starter benchmarks and lifts`);
  }

  /**
   * Adds the starter library when there are no benchmarks or lifts at all. An entry whose
   * movements aren't all in the exercise catalogue (renamed or deleted there) is left out.
   * Returns how many were added.
   */
  async seedLibrary(): Promise<number> {
    if ((await this.repo.count()) > 0) return 0;
    const found = await this.exercises.findByKeys(
      BENCHMARK_LIBRARY.flatMap((entry) => entry.movements.map(exerciseKey)),
    );
    let added = 0;
    await this.repo.manager.transaction(async (m) => {
      for (const entry of BENCHMARK_LIBRARY) {
        const ids = entry.movements.map(
          (movement) => found.get(exerciseKey(movement))?.id,
        );
        if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
          this.log.warn(
            `Starter "${entry.name}" left out: its movements aren't all in the exercises`,
          );
          continue;
        }
        const saved = await m.save(
          m.create(BenchmarkEntity, {
            kind: entry.kind,
            name: entry.name,
            nameKey: benchmarkNameKey(entry.name),
            scoreType: entry.scoreType,
            timeCapSeconds: null,
            description: entry.description,
            isActive: true,
          }),
        );
        await writeExercises(m, saved.id, ids as string[]);
        added++;
      }
    });
    return added;
  }

  /** By kind (benchmarks first), then name. `onlyActive` for trainees. */
  async list(query: ListBenchmarksQueryDto = {}, onlyActive = false) {
    const qb = this.query()
      .orderBy('b.kind', 'ASC')
      .addOrderBy('b.name', 'ASC')
      .addOrderBy('be.position', 'ASC');
    if (query.kind) qb.andWhere('b.kind = :kind', { kind: query.kind });
    if (onlyActive) {
      qb.andWhere('b.isActive = true');
    } else if (query.active !== undefined) {
      qb.andWhere('b.isActive = :active', { active: query.active === 'true' });
    }
    const kinds = [BenchmarkKind.BENCHMARK, BenchmarkKind.LIFT];
    return (await qb.getMany())
      .sort(
        (a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || byName(a, b),
      )
      .map(presentBenchmark);
  }

  async get(id: string) {
    const benchmark = await this.query()
      .where('b.id = :id', { id })
      .orderBy('be.position', 'ASC')
      .getOne();
    if (!benchmark) throw new NotFoundException('Benchmark not found');
    return presentBenchmark(benchmark);
  }

  async create(dto: CreateBenchmarkDto) {
    const scoreType =
      dto.kind === BenchmarkKind.LIFT
        ? (dto.scoreType ?? BenchmarkScoreType.LOAD)
        : dto.scoreType;
    if (!scoreType) {
      throw new BadRequestException(
        'scoreType is required for a benchmark: TIME, ROUNDS_REPS or REPS',
      );
    }
    const shape: Shape = {
      kind: dto.kind,
      scoreType,
      timeCapSeconds: dto.timeCapSeconds ?? null,
      description: dto.description ?? '',
      exerciseCount: dto.exerciseIds.length,
    };
    checkShape(shape);
    await this.checkExercises(dto.exerciseIds);
    const id = await this.saveOrConflict(dto.name, null, (m) =>
      m
        .save(
          m.create(BenchmarkEntity, {
            kind: shape.kind,
            name: dto.name,
            nameKey: benchmarkNameKey(dto.name),
            scoreType: shape.scoreType,
            timeCapSeconds: shape.timeCapSeconds,
            description: shape.description,
            isActive: dto.isActive ?? true,
          }),
        )
        .then(async (saved) => {
          await writeExercises(m, saved.id, dto.exerciseIds);
          return saved.id;
        }),
    );
    return this.get(id);
  }

  /** Updates the fields sent; the result must still be a valid benchmark or lift. */
  async update(id: string, dto: UpdateBenchmarkDto) {
    const current = await this.get(id);
    const shape: Shape = {
      kind: current.kind,
      scoreType: dto.scoreType ?? current.scoreType,
      // A time cap only goes with TIME: changing the score type drops it unless one is sent.
      timeCapSeconds:
        dto.timeCapSeconds !== undefined
          ? dto.timeCapSeconds
          : dto.scoreType && dto.scoreType !== BenchmarkScoreType.TIME
            ? null
            : current.timeCapSeconds,
      description: dto.description ?? current.description,
      exerciseCount: dto.exerciseIds?.length ?? current.exercises.length,
    };
    checkShape(shape);
    if (dto.exerciseIds) await this.checkExercises(dto.exerciseIds);
    const name = dto.name ?? current.name;
    await this.saveOrConflict(name, id, async (m) => {
      // Checked under the row lock, so a first result logged meanwhile can't slip in under the
      // old score type (benchmark-lock.ts).
      const locked = await lockBenchmark(m, id, 'update');
      if (!locked) throw new NotFoundException('Benchmark not found');
      if (
        shape.scoreType !== locked.scoreType &&
        (await m.count(BenchmarkResultEntity, { where: { benchmarkId: id } }))
      ) {
        throw new ConflictException(
          `"${locked.name}" has results, so its score type can't change. Add a new one instead.`,
        );
      }
      await m.update(
        BenchmarkEntity,
        { id },
        {
          name,
          nameKey: benchmarkNameKey(name),
          scoreType: shape.scoreType,
          timeCapSeconds: shape.timeCapSeconds,
          description: shape.description,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          // Touch the row, so updatedAt also moves when only the exercises change.
          updatedAt: new Date(),
        },
      );
      if (dto.exerciseIds) await writeExercises(m, id, dto.exerciseIds);
      return id;
    });
    return this.get(id);
  }

  /** Deletes one nobody has logged a result on; one with results can only be made inactive. */
  async delete(id: string) {
    await this.repo.manager.transaction(async (m) => {
      const benchmark = await lockBenchmark(m, id, 'update');
      if (!benchmark) throw new NotFoundException('Benchmark not found');
      if (
        await m.count(BenchmarkResultEntity, { where: { benchmarkId: id } })
      ) {
        throw new ConflictException(
          `"${benchmark.name}" has results and can't be deleted. Make it inactive instead.`,
        );
      }
      await m.delete(BenchmarkEntity, { id });
    });
    return { deleted: true };
  }

  private query() {
    return this.repo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.exercises', 'be')
      .leftJoinAndSelect('be.exercise', 'e')
      .loadRelationCountAndMap('b.resultCount', 'b.results');
  }

  private async checkExercises(ids: string[]) {
    const found = await this.repo.manager.count(ExerciseEntity, {
      where: { id: In(ids) },
    });
    if (found !== ids.length) throw new BadRequestException('Unknown exercise');
  }

  /**
   * Runs the write in a transaction, answering 409 when another benchmark or lift has the name
   * (checked first, and by the unique index for concurrent writes).
   */
  private async saveOrConflict(
    name: string,
    selfId: string | null,
    write: (m: EntityManager) => Promise<string>,
  ): Promise<string> {
    const conflict = () =>
      new ConflictException(
        `A benchmark or lift named "${name}" already exists`,
      );
    const taken = await this.repo
      .createQueryBuilder('b')
      .where('b.nameKey = :key', { key: benchmarkNameKey(name) })
      .getOne();
    if (taken && taken.id !== selfId) throw conflict();
    try {
      return await this.repo.manager.transaction(write);
    } catch (error) {
      if (violatedUniqueIndex(error) === BENCHMARK_NAME_INDEX) throw conflict();
      throw error;
    }
  }
}

/** The rules a benchmark or a heavy lift must follow, whatever was sent. */
function checkShape(shape: Shape) {
  if (shape.kind === BenchmarkKind.LIFT) {
    if (shape.scoreType !== BenchmarkScoreType.LOAD) {
      throw new BadRequestException('A heavy lift is scored by load');
    }
    if (shape.exerciseCount !== 1) {
      throw new BadRequestException('A heavy lift has exactly one exercise');
    }
  } else {
    if (shape.scoreType === BenchmarkScoreType.LOAD) {
      throw new BadRequestException(
        'A benchmark is scored by time, rounds and reps, or reps',
      );
    }
    if (!shape.description) {
      throw new BadRequestException('description must not be empty');
    }
  }
  if (
    shape.timeCapSeconds !== null &&
    shape.scoreType !== BenchmarkScoreType.TIME
  ) {
    throw new BadRequestException('Only a benchmark for time has a time cap');
  }
}

async function writeExercises(
  m: EntityManager,
  benchmarkId: string,
  ids: string[],
) {
  await m.delete(BenchmarkExerciseEntity, { benchmarkId });
  await m.insert(
    BenchmarkExerciseEntity,
    ids.map((exerciseId, position) => ({ benchmarkId, exerciseId, position })),
  );
}

/** A benchmark as the API returns it: its exercises in order, with what beginners need. */
export function presentBenchmark(benchmark: BenchmarkEntity) {
  return {
    id: benchmark.id,
    kind: benchmark.kind,
    name: benchmark.name,
    scoreType: benchmark.scoreType,
    timeCapSeconds: benchmark.timeCapSeconds,
    description: benchmark.description,
    exercises: [...(benchmark.exercises ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((link) => ({
        id: link.exercise!.id,
        name: link.exercise!.name,
        description: link.exercise!.description,
        videoUrl: link.exercise!.videoUrl,
        isActive: link.exercise!.isActive,
      })),
    isActive: benchmark.isActive,
    /** How many results were logged on it (any person, Rx or scaled). */
    resultCount:
      (benchmark as BenchmarkEntity & { resultCount?: number }).resultCount ??
      0,
    createdAt: benchmark.createdAt,
    updatedAt: benchmark.updatedAt,
  };
}

export type BenchmarkResponse = ReturnType<typeof presentBenchmark>;
