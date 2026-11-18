import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { toGymLocalDate } from '../attendance/attendance-timezone.util';
import { AccountRole } from '../common/enums/account-role.enum';
import {
  PhotoThumbnails,
  ProfilePhotosService,
} from '../profile-photos/profile-photos.service';
import { lockBenchmark } from './benchmark-lock';
import { byName } from './benchmark-name';
import { ownerKey, Requester, ResultOwner } from './benchmark-owner';
import { bestPerPerson, leaderboard, RankedResult } from './benchmark-ranking';
import { Score, SCORE_FIELDS, scoreFor } from './benchmark-score';
import { BenchmarkEntity, BenchmarkResultEntity } from './benchmark.entity';
import {
  CreateBenchmarkResultDto,
  MyResultsQueryDto,
  UpdateBenchmarkResultDto,
} from './dto/benchmark-result.dto';
import { BenchmarkKind } from './enums/benchmark-kind.enum';

/** How many people each list of the records page shows; a benchmark's page shows all. */
export const LEADERBOARD_PREVIEW_SIZE = 5;

export const NO_PROFILE_MESSAGE =
  'Results are logged by trainees and trainers: this account has no trainee or trainer profile';
export const NOT_YOURS_MESSAGE = 'You can only change your own results';

type Ranked = RankedResult & { result: BenchmarkResultEntity };

/**
 * Logged results and the leaderboards built from them. People log only their own (the profile
 * from their token); nobody validates them. The owner changes or deletes a result; an admin can
 * delete any. Leaderboards list each person once with their best result (`benchmark-ranking.ts`),
 * Rx and scaled apart, inactive people included.
 */
@Injectable()
export class BenchmarkResultsService {
  constructor(
    @InjectRepository(BenchmarkResultEntity)
    private readonly repo: Repository<BenchmarkResultEntity>,
    @InjectRepository(BenchmarkEntity)
    private readonly benchmarks: Repository<BenchmarkEntity>,
    private readonly photos: ProfilePhotosService,
  ) {}

  async create(requester: Requester, dto: CreateBenchmarkResultDto) {
    const owner = ownerOf(requester);
    // Under a shared lock on the benchmark, so its score type can't change meanwhile.
    const id = await this.repo.manager.transaction(async (m) => {
      const benchmark = await lockBenchmark(m, dto.benchmarkId, 'share');
      if (!benchmark) throw new BadRequestException('Unknown benchmark');
      if (!benchmark.isActive) {
        throw new BadRequestException(
          `"${benchmark.name}" is inactive and takes no new results`,
        );
      }
      const values = resultValues(benchmark, {
        performedOn: dto.performedOn,
        scaled: dto.scaled ?? false,
        score: dto,
      });
      const saved = await m.save(
        m.create(BenchmarkResultEntity, {
          benchmarkId: benchmark.id,
          ...owner,
          ...values,
          note: noteOf(dto.note),
        }),
      );
      return saved.id;
    });
    return this.get(requester, id);
  }

  /** One of the requester's own results. */
  async get(requester: Requester, id: string) {
    const result = await this.own(requester, id);
    const all = await this.ownResults(result.benchmarkId, ownerOf(requester));
    return presentOwn(result, personalBests(all));
  }

  /**
   * Changes the fields sent. The score fields, when any is sent, replace the whole score and must
   * fit the benchmark as it is now. Otherwise the stored score is kept as logged, even if staff
   * changed the time cap since (a note- or date-only edit never fails on it).
   */
  async update(
    requester: Requester,
    id: string,
    dto: UpdateBenchmarkResultDto,
  ) {
    const result = await this.own(requester, id);
    const scoreSent = SCORE_FIELDS.some((field) => dto[field] !== undefined);
    await this.repo.manager.transaction(async (m) => {
      const benchmark = await lockBenchmark(m, result.benchmarkId, 'share');
      const values = resultValues(benchmark!, {
        performedOn: dto.performedOn ?? result.performedOn,
        scaled: dto.scaled ?? result.scaled,
        score: scoreSent ? dto : null,
      });
      await m.update(
        BenchmarkResultEntity,
        { id },
        {
          ...values,
          ...(dto.note !== undefined ? { note: noteOf(dto.note) } : {}),
          updatedAt: new Date(),
        },
      );
    });
    return this.get(requester, id);
  }

  /** The owner deletes their own result; an admin deletes anyone's. */
  async delete(requester: Requester, id: string) {
    const result = await this.repo.findOne({ where: { id } });
    if (!result) throw new NotFoundException('Result not found');
    if (requester.role !== AccountRole.ADMIN) {
      const owner = ownerOf(requester);
      if (ownerKey(owner) !== ownerKey(result)) {
        throw new ForbiddenException(NOT_YOURS_MESSAGE);
      }
    }
    await this.repo.delete({ id });
    return { deleted: true };
  }

  /**
   * The requester's own results, newest first (by the day done, then as logged), each with its
   * benchmark and whether it is their best of that benchmark (Rx and scaled apart).
   */
  async mine(requester: Requester, query: MyResultsQueryDto = {}) {
    const owner = ownerOf(requester);
    const results = await this.repo.find({
      where: {
        ...ownerWhere(owner),
        ...(query.benchmarkId ? { benchmarkId: query.benchmarkId } : {}),
      },
      relations: { benchmark: true },
      order: { performedOn: 'DESC', createdAt: 'DESC' },
    });
    const bests = personalBests(results);
    return results.map((result) => presentOwn(result, bests));
  }

  /** A benchmark's whole leaderboards: Rx and scaled (always empty for a heavy lift). */
  async leaderboard(requester: Requester, benchmarkId: string) {
    const benchmark = await this.benchmarks.findOne({
      where: { id: benchmarkId },
    });
    if (!benchmark) throw new NotFoundException('Benchmark not found');
    const results = await this.resultsOf([benchmark.id]);
    const boards = boardsOf(
      benchmark,
      results,
      requester,
      await this.photosOf(results),
    );
    return { rx: boards.rx, scaled: boards.scaled };
  }

  /**
   * The records page: the active benchmarks (or heavy lifts) by name, each with the top of its Rx
   * and scaled leaderboards, how many people are on each, and the requester's own place on each.
   */
  async overview(requester: Requester, kind: BenchmarkKind) {
    const benchmarks = await this.benchmarks
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.exercises', 'be')
      .leftJoinAndSelect('be.exercise', 'e')
      .where('b.kind = :kind', { kind })
      .andWhere('b.isActive = true')
      .orderBy('b.name', 'ASC')
      .addOrderBy('be.position', 'ASC')
      .getMany();
    const results = await this.resultsOf(benchmarks.map((b) => b.id));
    const photos = await this.photosOf(results);
    return benchmarks.sort(byName).map((benchmark) => {
      const boards = boardsOf(
        benchmark,
        results.filter((r) => r.benchmarkId === benchmark.id),
        requester,
        photos,
      );
      const mineOn = (board: Entry[]) => board.find((e) => e.isMe) ?? null;
      return {
        id: benchmark.id,
        kind: benchmark.kind,
        name: benchmark.name,
        scoreType: benchmark.scoreType,
        timeCapSeconds: benchmark.timeCapSeconds,
        exercises: [...benchmark.exercises]
          .sort((a, b) => a.position - b.position)
          .map((link) => ({
            id: link.exercise!.id,
            name: link.exercise!.name,
          })),
        rx: boards.rx.slice(0, LEADERBOARD_PREVIEW_SIZE),
        rxCount: boards.rx.length,
        scaled: boards.scaled.slice(0, LEADERBOARD_PREVIEW_SIZE),
        scaledCount: boards.scaled.length,
        myRx: mineOn(boards.rx),
        myScaled: mineOn(boards.scaled),
      };
    });
  }

  /** The results of the benchmarks, with their owners' names. */
  private resultsOf(benchmarkIds: string[]) {
    if (!benchmarkIds.length) return Promise.resolve([]);
    return this.repo
      .createQueryBuilder('r')
      .leftJoin('r.traineeProfile', 'tp')
      .addSelect(['tp.id', 'tp.name'])
      .leftJoin('r.trainerProfile', 'tr')
      .addSelect(['tr.id', 'tr.name'])
      .where('r.benchmarkId IN (:...benchmarkIds)', { benchmarkIds })
      .getMany();
  }

  /** The profile photos (thumbnails) of the people who logged the results. */
  private photosOf(results: BenchmarkResultEntity[]) {
    return this.photos.thumbnails({
      traineeProfileIds: results
        .map((r) => r.traineeProfileId)
        .filter((id): id is string => !!id),
      trainerProfileIds: results
        .map((r) => r.trainerProfileId)
        .filter((id): id is string => !!id),
    });
  }

  private ownResults(benchmarkId: string, owner: ResultOwner) {
    return this.repo.find({
      where: { benchmarkId, ...ownerWhere(owner) },
      relations: { benchmark: true },
    });
  }

  /** A result of the requester's own, with its benchmark: 404 if none, 403 if someone else's. */
  private async own(requester: Requester, id: string) {
    const owner = ownerOf(requester);
    const result = await this.repo.findOne({
      where: { id },
      relations: { benchmark: true },
    });
    if (!result) throw new NotFoundException('Result not found');
    if (ownerKey(result) !== ownerKey(owner)) {
      throw new ForbiddenException(NOT_YOURS_MESSAGE);
    }
    return result;
  }
}

function ownerOf(requester: Requester): ResultOwner {
  if (!requester.owner) throw new ForbiddenException(NO_PROFILE_MESSAGE);
  return requester.owner;
}

/** A note as stored: trimmed, "\n" line breaks; an empty one is none. */
function noteOf(note: string | null | undefined): string | null {
  return note?.replace(/\r\n?/g, '\n').trim() || null;
}

function ownerWhere(owner: ResultOwner) {
  return owner.traineeProfileId
    ? { traineeProfileId: owner.traineeProfileId }
    : { trainerProfileId: owner.trainerProfileId! };
}

/**
 * The stored fields of a result for a benchmark, or 400: a day that isn't in the future, never
 * scaled for a heavy lift, and a score that fits the benchmark (`benchmark-score.ts`). Without a
 * score (an edit that sends none), the stored one is left as it is.
 */
function resultValues(
  benchmark: BenchmarkEntity,
  input: {
    performedOn: string;
    scaled: boolean;
    score: Parameters<typeof scoreFor>[1] | null;
  },
): Partial<Score> & { performedOn: string; scaled: boolean } {
  if (input.performedOn > toGymLocalDate(new Date())) {
    throw new BadRequestException("performedOn can't be in the future");
  }
  if (input.scaled && benchmark.kind === BenchmarkKind.LIFT) {
    throw new BadRequestException('A heavy lift has no scaled version');
  }
  if (!input.score) {
    return { performedOn: input.performedOn, scaled: input.scaled };
  }
  const scored = scoreFor(benchmark, input.score);
  if ('error' in scored) throw new BadRequestException(scored.error);
  return {
    performedOn: input.performedOn,
    scaled: input.scaled,
    ...scored.score,
  };
}

function ranked(result: BenchmarkResultEntity): Ranked {
  return {
    id: result.id,
    ownerKey: ownerKey(result),
    performedOn: result.performedOn,
    createdAt: result.createdAt,
    timeSeconds: result.timeSeconds,
    capped: result.capped,
    rounds: result.rounds,
    reps: result.reps,
    loadKg: result.loadKg,
    result,
  };
}

/** The ids of the results that are their owner's best of their benchmark, Rx and scaled apart. */
function personalBests(results: BenchmarkResultEntity[]): Set<string> {
  const groups = new Map<string, BenchmarkResultEntity[]>();
  for (const result of results) {
    const key = `${result.benchmarkId}:${result.scaled}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) {
    const benchmark = group[0].benchmark;
    // Without its benchmark loaded, the score type is unknown: no flags (never the case here).
    if (!benchmark) continue;
    for (const best of bestPerPerson(benchmark.scoreType, group.map(ranked))) {
      ids.add(best.id);
    }
  }
  return ids;
}

type Entry = ReturnType<typeof presentEntry>;

function boardsOf(
  benchmark: BenchmarkEntity,
  results: BenchmarkResultEntity[],
  requester: Requester,
  photos: PhotoThumbnails,
) {
  const me = requester.owner ? ownerKey(requester.owner) : null;
  const board = (scaled: boolean) =>
    leaderboard(
      benchmark.scoreType,
      results.filter((r) => r.scaled === scaled).map(ranked),
    ).map((entry) => presentEntry(entry, me, photos));
  return { rx: board(false), scaled: board(true) };
}

/**
 * A leaderboard row: the person's name (never their nickname or ids), their profile photo's
 * thumbnail (null without one), score, day and note.
 */
function presentEntry(
  entry: Ranked & { rank: number },
  me: string | null,
  photos: PhotoThumbnails,
) {
  const r = entry.result;
  return {
    rank: entry.rank,
    resultId: r.id,
    name: r.traineeProfile?.name ?? r.trainerProfile?.name ?? '',
    photoUrl:
      (r.traineeProfileId
        ? photos.trainee.get(r.traineeProfileId)
        : photos.trainer.get(r.trainerProfileId!)) ?? null,
    personType: r.traineeProfileId ? 'TRAINEE' : 'TRAINER',
    isMe: entry.ownerKey === me,
    performedOn: r.performedOn,
    timeSeconds: r.timeSeconds,
    capped: r.capped,
    rounds: r.rounds,
    reps: r.reps,
    loadKg: r.loadKg,
    note: r.note,
  };
}

function presentOwn(result: BenchmarkResultEntity, bests: Set<string>) {
  const benchmark = result.benchmark!;
  return {
    id: result.id,
    benchmark: {
      id: benchmark.id,
      kind: benchmark.kind,
      name: benchmark.name,
      scoreType: benchmark.scoreType,
      timeCapSeconds: benchmark.timeCapSeconds,
      isActive: benchmark.isActive,
    },
    performedOn: result.performedOn,
    scaled: result.scaled,
    timeSeconds: result.timeSeconds,
    capped: result.capped,
    rounds: result.rounds,
    reps: result.reps,
    loadKg: result.loadKg,
    note: result.note,
    /** Their best result of this benchmark (Rx and scaled apart). */
    personalBest: bests.has(result.id),
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}
