import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { CreateWorkoutTypeDto } from './dto/create-workout-type.dto';
import { UpdateWorkoutTypeDto } from './dto/update-workout-type.dto';
import {
  WORKOUT_TYPE_NAME_INDEX,
  WorkoutTypeEntity,
  workoutTypeNameKey,
} from './workout-type.entity';
import {
  ScoreType,
  SYSTEM_WORKOUT_TYPES,
  WorkoutTypeCode,
} from './workout-type.enums';

/**
 * Workout types (ADMIN and TRAINER): the built-in ones, which always exist, and the trainers'
 * own. A type in use, or a built-in one, can't be deleted.
 */
@Injectable()
export class WorkoutTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(WorkoutTypeEntity)
    private readonly repo: Repository<WorkoutTypeEntity>,
  ) {}

  async onModuleInit() {
    await this.seedSystemTypes();
  }

  /** Adds the built-in types that are missing; existing ones keep their name and description. */
  async seedSystemTypes(): Promise<void> {
    const existing = await this.repo.find({
      where: { code: In(SYSTEM_WORKOUT_TYPES.map((t) => t.code)) },
    });
    const names = new Set(
      (await this.repo.find({ select: { name: true } })).map((t) =>
        workoutTypeNameKey(t.name),
      ),
    );
    for (const type of SYSTEM_WORKOUT_TYPES) {
      if (existing.some((e) => e.code === type.code)) continue;
      // A trainer's own type may already have the name: the built-in one steps aside.
      let name = type.name;
      for (let n = 2; names.has(workoutTypeNameKey(name)); n++) {
        name = `${type.name} (${n})`;
      }
      names.add(workoutTypeNameKey(name));
      await this.repo.save(
        this.repo.create({
          ...type,
          name,
          nameKey: workoutTypeNameKey(name),
        }),
      );
    }
  }

  /** Built-in types first, in their fixed order, then the trainers' own by name. */
  async list() {
    const types = await this.repo.find({ order: { name: 'ASC' } });
    const order = SYSTEM_WORKOUT_TYPES.map((t) => t.code);
    const rank = (t: WorkoutTypeEntity) =>
      t.code ? order.indexOf(t.code) : order.length;
    return types.sort((a, b) => rank(a) - rank(b));
  }

  async get(id: string) {
    const type = await this.repo.findOne({ where: { id } });
    if (!type) throw new NotFoundException('Workout type not found');
    return type;
  }

  /** code -> type, for the built-in types that exist. */
  async byCode(): Promise<Map<WorkoutTypeCode, WorkoutTypeEntity>> {
    const types = await this.repo.find();
    return new Map(
      types.filter((t) => t.code).map((t) => [t.code as WorkoutTypeCode, t]),
    );
  }

  async create(dto: CreateWorkoutTypeDto) {
    const saved = await this.saveOrConflict(
      this.repo.create({
        name: dto.name,
        nameKey: workoutTypeNameKey(dto.name),
        description: dto.description || null,
        scoreType: dto.scoreType ?? ScoreType.NONE,
        code: null,
      }),
    );
    return this.get(saved.id);
  }

  async update(id: string, dto: UpdateWorkoutTypeDto) {
    const type = await this.get(id);
    if (dto.name !== undefined) {
      type.name = dto.name;
      type.nameKey = workoutTypeNameKey(dto.name);
    }
    if (dto.description !== undefined) {
      type.description = dto.description || null;
    }
    if (dto.scoreType !== undefined) type.scoreType = dto.scoreType;
    await this.saveOrConflict(type);
    return this.get(id);
  }

  async delete(id: string) {
    const type = await this.get(id);
    if (type.code) {
      throw new ConflictException(
        `"${type.name}" is a built-in workout type and can't be deleted`,
      );
    }
    const [{ used }] = await this.repo.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "workout_parts" WHERE "workoutTypeId" = $1) AS used`,
      [type.id],
    );
    if (used) {
      throw new ConflictException(
        `"${type.name}" is used in workouts and can't be deleted`,
      );
    }
    await this.repo.delete({ id: type.id });
    return { deleted: true };
  }

  private async saveOrConflict(type: WorkoutTypeEntity) {
    try {
      return await this.repo.save(type);
    } catch (error) {
      if (violatedUniqueIndex(error) === WORKOUT_TYPE_NAME_INDEX) {
        throw new ConflictException(
          `A workout type named "${type.name}" already exists`,
        );
      }
      throw error;
    }
  }
}
