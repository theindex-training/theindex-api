import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { violatedUniqueIndex } from '../common/utils/db-errors';
import { containsPattern } from '../common/utils/like.util';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { ListExercisesQueryDto } from './dto/list-exercises.query.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { exerciseKey } from './exercise-key';
import { EXERCISE_LIBRARY } from './exercise-library';
import { ExerciseEntity, EXERCISE_NAME_INDEX } from './exercise.entity';
import { youtubeVideoId, youtubeWatchUrl } from './youtube-url';

/**
 * The movement catalogue (ADMIN and TRAINER). A movement is found by any of its spellings: names
 * and aliases share one namespace of keys (`exerciseKey`), so no two movements can answer to the
 * same text in a workout PDF.
 */
@Injectable()
export class ExercisesService implements OnModuleInit {
  private readonly log = new Logger(ExercisesService.name);

  constructor(
    @InjectRepository(ExerciseEntity)
    private readonly repo: Repository<ExerciseEntity>,
  ) {}

  async onModuleInit() {
    const added = await this.seedLibrary();
    if (added) this.log.log(`Added ${added} starter exercises`);
  }

  /** Adds the starter library when there are no exercises at all. Returns how many were added. */
  async seedLibrary(): Promise<number> {
    if ((await this.repo.count()) > 0) return 0;
    const rows = EXERCISE_LIBRARY.map((entry) => {
      const aliases = entry.aliases ?? [];
      return this.repo.create({
        name: entry.name,
        nameKey: exerciseKey(entry.name),
        aliases,
        aliasKeys: aliases.map(exerciseKey),
        isActive: true,
        description: null,
        videoUrl: entry.videoId ? youtubeWatchUrl(entry.videoId) : null,
      });
    });
    await this.repo.save(rows);
    return rows.length;
  }

  list(query: ListExercisesQueryDto = {}) {
    const qb = this.repo.createQueryBuilder('e').orderBy('e.name', 'ASC');
    if (query.active !== undefined) {
      qb.andWhere('e.isActive = :active', { active: query.active === 'true' });
    }
    const term = query.q?.trim();
    if (term) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where(`e.name ILIKE :term ESCAPE '\\'`)
            .orWhere(`e.aliases::text ILIKE :term ESCAPE '\\'`),
        ),
        { term: containsPattern(term) },
      );
    }
    return qb.getMany();
  }

  async get(id: string) {
    const exercise = await this.repo.findOne({ where: { id } });
    if (!exercise) throw new NotFoundException('Exercise not found');
    return exercise;
  }

  async create(dto: CreateExerciseDto) {
    const exercise = this.repo.create({
      isActive: dto.isActive ?? true,
      description: dto.description || null,
      videoUrl: videoUrlOf(dto.videoUrl),
    });
    await this.applyNames(exercise, dto.name, dto.aliases ?? []);
    const saved = await this.saveOrConflict(exercise);
    return this.get(saved.id);
  }

  async update(id: string, dto: UpdateExerciseDto) {
    const exercise = await this.get(id);
    if (dto.isActive !== undefined) exercise.isActive = dto.isActive;
    if (dto.description !== undefined) {
      exercise.description = dto.description || null;
    }
    if (dto.videoUrl !== undefined)
      exercise.videoUrl = videoUrlOf(dto.videoUrl);
    if (dto.name !== undefined || dto.aliases !== undefined) {
      await this.applyNames(
        exercise,
        dto.name ?? exercise.name,
        dto.aliases ?? exercise.aliases,
      );
    }
    await this.saveOrConflict(exercise);
    return this.get(id);
  }

  /** Deletes a movement no workout uses; a used one can only be made inactive. */
  async delete(id: string) {
    const exercise = await this.get(id);
    const [{ used }] = await this.repo.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "workout_exercises" WHERE "exerciseId" = $1) AS used`,
      [exercise.id],
    );
    if (used) {
      throw new ConflictException(
        `"${exercise.name}" is used in workouts and can't be deleted. Make it inactive instead.`,
      );
    }
    await this.repo.delete({ id: exercise.id });
    return { deleted: true };
  }

  /**
   * Adds another spelling to an exercise, e.g. the one a lesson plan used ("Russian KB swings"),
   * so the next import finds it. A spelling it already answers to changes nothing; one that
   * another exercise answers to is refused (409).
   */
  async addAlias(id: string, alias: string) {
    const exercise = await this.repo.findOne({
      where: { id },
      select: {
        id: true,
        name: true,
        aliases: true,
        nameKey: true,
        aliasKeys: true,
      },
    });
    if (!exercise) throw new NotFoundException('Exercise not found');
    const key = exerciseKey(alias);
    if (key === exercise.nameKey || exercise.aliasKeys.includes(key)) {
      return this.get(id);
    }
    return this.update(id, { aliases: [...exercise.aliases, alias] });
  }

  /** The exercises that answer to each of the keys (by name or alias): key -> exercise. */
  async findByKeys(keys: string[]): Promise<Map<string, ExerciseEntity>> {
    const found = new Map<string, ExerciseEntity>();
    const wanted = [...new Set(keys.filter(Boolean))];
    if (!wanted.length) return found;
    const rows = await this.repo
      .createQueryBuilder('e')
      .addSelect(['e.nameKey', 'e.aliasKeys'])
      .where('e.nameKey IN (:...wanted)', { wanted })
      .orWhere('e.aliasKeys ?| :wantedArray', { wantedArray: wanted })
      .getMany();
    for (const key of wanted) {
      // A name beats an alias; an active movement beats an inactive one.
      const match =
        rows.find((r) => r.nameKey === key) ??
        rows.find((r) => r.isActive && r.aliasKeys.includes(key)) ??
        rows.find((r) => r.aliasKeys.includes(key));
      if (match) found.set(key, match);
    }
    return found;
  }

  /** Sets the name and aliases with their keys, refusing spellings another movement has. */
  private async applyNames(
    exercise: ExerciseEntity,
    name: string,
    aliases: string[],
  ) {
    const nameKey = exerciseKey(name);
    if (!nameKey) {
      throw new BadRequestException('name must contain letters or digits');
    }
    const kept: string[] = [];
    const keptKeys: string[] = [];
    for (const alias of aliases) {
      const key = exerciseKey(alias);
      if (!key) {
        throw new BadRequestException(
          `The alias "${alias}" must contain letters or digits`,
        );
      }
      // The name itself, or the same alias twice, adds nothing.
      if (key === nameKey || keptKeys.includes(key)) continue;
      kept.push(alias);
      keptKeys.push(key);
    }

    const keys = [nameKey, ...keptKeys];
    const qb = this.repo
      .createQueryBuilder('e')
      .addSelect(['e.nameKey', 'e.aliasKeys'])
      .where(
        new Brackets((w) =>
          w
            .where('e.nameKey IN (:...keys)', { keys })
            .orWhere('e.aliasKeys ?| :keysArray', { keysArray: keys }),
        ),
      );
    if (exercise.id) qb.andWhere('e.id <> :id', { id: exercise.id });
    const other = await qb.getOne();
    if (other) {
      const taken =
        [name, ...kept].find((_, i) => keys[i] === other.nameKey) ??
        [name, ...kept].find((_, i) => other.aliasKeys.includes(keys[i]));
      throw new ConflictException(
        `"${taken}" is already the exercise "${other.name}"`,
      );
    }

    exercise.name = name;
    exercise.nameKey = nameKey;
    exercise.aliases = kept;
    exercise.aliasKeys = keptKeys;
  }

  /** Saves, answering 409 when the unique name index refuses the row (a concurrent create). */
  private async saveOrConflict(exercise: ExerciseEntity) {
    try {
      return await this.repo.save(exercise);
    } catch (error) {
      if (violatedUniqueIndex(error) === EXERCISE_NAME_INDEX) {
        throw new ConflictException(
          `An exercise named "${exercise.name}" already exists`,
        );
      }
      throw error;
    }
  }
}

/** A sent video link as stored: the watch link of its YouTube video, or null when empty. */
function videoUrlOf(link: string | null | undefined): string | null {
  if (!link) return null;
  const id = youtubeVideoId(link);
  if (!id) {
    throw new BadRequestException(
      'videoUrl must be a link to a YouTube video, e.g. https://www.youtube.com/watch?v=rMvwVtlqjTE',
    );
  }
  return youtubeWatchUrl(id);
}
