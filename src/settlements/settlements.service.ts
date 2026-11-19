import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { AllocationReason } from './enums/allocation-reason.enum';
import { SettlementStatus } from './enums/settlement-status.enum';
import { SettlementAllocationEntity } from './settlement-allocation.entity';
import {
  calculateSettlement,
  CandidateAttendance,
  PaidItemSummary,
  PayingSubscription,
  SettlementItem,
  trainerTotals,
  TrainerTotals,
  WaitingItem,
  WaitingReason,
} from './settlement-calculation';
import { lockSettlements } from './settlement-lock';
import {
  periodAfter,
  periodBounds,
  periodEndsAt,
  periodsDue,
  reportCreatedAt,
  SETTLEMENT_CREATION_HOUR,
  SettlementPeriod,
} from './settlement-periods';
import { toGymLocalDate } from '../attendance/attendance-timezone.util';
import { SettlementLineEntity } from './settlement-line.entity';
import { SettlementEntity } from './settlement.entity';

/** A training a report pays, as `GET /settlements/:id/allocations` lists it. */
export interface AllocationView {
  /** The stored allocation's id; a draft's rows use the training's id. */
  id: string;
  settlementId: string;
  attendanceId: string;
  trainerId: string;
  subscriptionId: string | null;
  subscriptionType: PlanType | null;
  valueCents: number;
  reason: AllocationReason;
  fromEarlierPeriod: boolean;
  attendance: AttendanceView;
}

export interface AttendanceView {
  id: string;
  trainedAt: Date;
  traineeId: string;
  trainerId: string;
  locationId: string | null;
  paymentStatus: AttendancePaymentStatus;
  subscriptionId: string | null;
}

/** A training of the period that a later report will pay. */
export interface WaitingView {
  attendanceId: string;
  trainerId: string;
  traineeId: string;
  locationId: string | null;
  trainedAt: Date;
  reason: WaitingReason;
  subscriptionType: PlanType | null;
  availableFrom: Date | null;
}

interface Report {
  allocations: AllocationView[];
  lines: TrainerTotals[];
  waiting: WaitingView[];
}

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettlementEntity)
    private readonly settlementRepo: Repository<SettlementEntity>,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  /**
   * Creates the reports whose period is over (see `periodsDue`): one DRAFT per period, oldest
   * first. Safe to run any number of times. Answers the reports it created.
   */
  async createDueReports(): Promise<SettlementEntity[]> {
    const now = new Date();
    const created = await this.dataSource.transaction(async (manager) => {
      await lockSettlements(manager);
      const repo = manager.getRepository(SettlementEntity);
      const latest = await repo
        .createQueryBuilder('s')
        .select(`to_char(MAX(s.periodEnd), 'YYYY-MM-DD')`, 'end')
        .getRawOne<{ end: string | null }>();

      const saved: SettlementEntity[] = [];
      for (const period of periodsDue(latest?.end ?? null, now)) {
        saved.push(
          await repo.save(
            repo.create({
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              generatedAt: now,
              status: SettlementStatus.DRAFT,
              finalizedAt: null,
              notes: null,
            }),
          ),
        );
      }
      return saved;
    });

    for (const s of created) {
      this.logger.log(
        `Created the settlement report for ${s.periodStart} to ${s.periodEnd}.`,
      );
    }
    return created;
  }

  /**
   * The job's work on demand (`POST /api/settlements/create-due`, ADMIN): creates every report that
   * is due now, oldest first, exactly as the 04:00 run would, and answers them. 409 when none is
   * due, saying which report is the latest and when the next one comes.
   */
  async createDueReportsNow(): Promise<{ created: SettlementEntity[] }> {
    const created = await this.createDueReports();
    if (created.length) return { created };

    const latest = await this.settlementRepo
      .createQueryBuilder('s')
      .orderBy('s.periodEnd', 'DESC')
      .addOrderBy('s.periodStart', 'DESC')
      .getOne();
    if (!latest) {
      // With no report at all one is always due, so this only happens in a race.
      throw new ConflictException('No settlement report is due yet');
    }
    const next = periodAfter(latest.periodEnd);
    throw new ConflictException(
      `The report for ${latest.periodStart} to ${latest.periodEnd} already exists; the next one (${next.periodStart} to ${next.periodEnd}) is created on ${toGymLocalDate(reportCreatedAt(next))} at ${String(SETTLEMENT_CREATION_HOUR).padStart(2, '0')}:00 Europe/Sofia time`,
    );
  }

  /** Every report, the latest period first. */
  async list() {
    return this.settlementRepo.find({
      order: { periodStart: 'DESC', periodEnd: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * A report with one line per trainer and its period's trainings that wait for a later report,
   * limited to one trainer's when `trainerId` is given. A draft is worked out now; a finalized
   * report shows what it paid (its waiting trainings are still worked out now).
   */
  async getById(id: string, trainerId?: string) {
    const settlement = await this.findOrThrow(id);
    const report = await this.report(this.dataSource.manager, settlement);
    const mine = <T extends { trainerId: string }>(rows: T[]) =>
      trainerId ? rows.filter((r) => r.trainerId === trainerId) : rows;

    return {
      settlement,
      lines: mine(report.lines),
      waiting: mine(report.waiting),
    };
  }

  /** The trainings a report pays, by training time, paged. */
  async allocations(
    settlementId: string,
    query: { trainerId?: string; offset?: number; limit?: number },
  ) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const settlement = await this.findOrThrow(settlementId);
    const { allocations } = await this.report(
      this.dataSource.manager,
      settlement,
    );
    const rows = query.trainerId
      ? allocations.filter((a) => a.trainerId === query.trainerId)
      : allocations;

    return {
      total: rows.length,
      limit,
      offset,
      rows: rows.slice(offset, offset + limit),
    };
  }

  /**
   * Pays a draft out: works it out once more, stores what it pays, takes the total out of the
   * cash register and makes it FINAL. Only once its period is over and every older report is
   * finalized. Finalizing a FINAL report changes nothing.
   */
  async finalize(id: string) {
    return this.dataSource.transaction(async (manager) => {
      await lockSettlements(manager);
      const repo = manager.getRepository(SettlementEntity);
      const settlement = await repo
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id })
        .getOne();

      if (!settlement) throw new NotFoundException('Settlement not found');
      if (settlement.status === SettlementStatus.FINAL) return settlement;

      const now = new Date();
      if (now.getTime() < periodEndsAt(settlement).getTime()) {
        throw new ConflictException(
          `The period ends on ${settlement.periodEnd}; the report can be finalized after that`,
        );
      }

      const older = await repo
        .createQueryBuilder('s')
        .where('s.status = :draft', { draft: SettlementStatus.DRAFT })
        .andWhere('s.id <> :id', { id: settlement.id })
        .andWhere(
          new Brackets((qb) =>
            qb
              .where('s.periodStart < :start', {
                start: settlement.periodStart,
              })
              .orWhere('(s.periodStart = :start AND s.periodEnd < :end)', {
                start: settlement.periodStart,
                end: settlement.periodEnd,
              }),
          ),
        )
        .orderBy('s.periodStart', 'ASC')
        .getOne();
      if (older) {
        throw new ConflictException(
          `Finalize the report for ${older.periodStart} to ${older.periodEnd} first`,
        );
      }

      const { items, waiting } = await this.calculate(
        manager,
        settlement,
        true,
      );

      // A draft created before reports were worked out live may have stored rows: replace them.
      await manager
        .getRepository(SettlementAllocationEntity)
        .delete({ settlementId: settlement.id });
      await manager
        .getRepository(SettlementLineEntity)
        .delete({ settlementId: settlement.id });

      if (items.length) {
        await manager.getRepository(SettlementAllocationEntity).save(
          items.map((item) => ({
            settlementId: settlement.id,
            attendanceId: item.attendance.id,
            trainerId: item.attendance.trainerId,
            subscriptionId: item.subscriptionId,
            subscriptionType: item.subscriptionType,
            valueCents: item.valueCents,
            reason: item.reason,
            fromEarlierPeriod: item.fromEarlierPeriod,
          })),
        );
      }

      const totals = trainerTotals(
        items.map(paidSummaryOfItem),
        waiting.map((w) => ({ trainerId: w.attendance.trainerId })),
      );
      if (totals.length) {
        await manager.getRepository(SettlementLineEntity).save(
          totals.map((t) => ({
            settlementId: settlement.id,
            trainerId: t.trainerId,
            amountCents: t.amountCents,
            attendanceCount: t.attendanceCount,
            unpaidAttendanceCount: t.waitingCount,
            details: {
              punchCents: t.punchCents,
              timeCents: t.timeCents,
              earlierPeriodsCents: t.earlierPeriodsCents,
              earlierPeriodsCount: t.earlierPeriodsCount,
            },
          })),
        );
      }

      await this.cashRegisterService.registerSettlementFinalization(
        manager,
        settlement.id,
        totals.reduce((sum, t) => sum + t.amountCents, 0),
      );

      settlement.status = SettlementStatus.FINAL;
      settlement.finalizedAt = now;
      return repo.save(settlement);
    });
  }

  private async findOrThrow(id: string): Promise<SettlementEntity> {
    const settlement = await this.settlementRepo.findOne({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    return settlement;
  }

  /** What a report pays and what of its period waits, as the read routes show it. */
  private async report(
    manager: EntityManager,
    settlement: SettlementEntity,
  ): Promise<Report> {
    if (settlement.status === SettlementStatus.DRAFT) {
      const { items, waiting } = await this.calculate(
        manager,
        settlement,
        true,
      );
      return {
        allocations: items.map((item) => draftAllocation(settlement, item)),
        lines: trainerTotals(
          items.map(paidSummaryOfItem),
          waiting.map((w) => ({ trainerId: w.attendance.trainerId })),
        ),
        waiting: waiting.map(waitingView),
      };
    }

    const [stored, storedLines, { waiting }] = await Promise.all([
      manager
        .getRepository(SettlementAllocationEntity)
        .createQueryBuilder('sa')
        .leftJoinAndSelect('sa.attendance', 'a')
        .where('sa.settlementId = :id', { id: settlement.id })
        .orderBy('a.trainedAt', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .getMany(),
      manager
        .getRepository(SettlementLineEntity)
        .find({ where: { settlementId: settlement.id } }),
      this.calculate(manager, settlement, false),
    ]);

    // The stored lines are what was paid; trainings deleted since don't change them.
    const waitingByTrainer = new Map<string, number>();
    for (const w of waiting) {
      const id = w.attendance.trainerId;
      waitingByTrainer.set(id, (waitingByTrainer.get(id) ?? 0) + 1);
    }
    const lines: TrainerTotals[] = storedLines
      .filter((l) => l.attendanceCount > 0 || l.amountCents !== 0)
      .map((l) => ({
        trainerId: l.trainerId,
        amountCents: l.amountCents,
        attendanceCount: l.attendanceCount,
        punchCents: l.details?.punchCents ?? 0,
        timeCents: l.details?.timeCents ?? 0,
        earlierPeriodsCents: l.details?.earlierPeriodsCents ?? 0,
        earlierPeriodsCount: l.details?.earlierPeriodsCount ?? 0,
        waitingCount: waitingByTrainer.get(l.trainerId) ?? 0,
      }));
    for (const [trainerId, count] of waitingByTrainer) {
      if (!lines.some((l) => l.trainerId === trainerId)) {
        lines.push({
          trainerId,
          amountCents: 0,
          attendanceCount: 0,
          punchCents: 0,
          timeCents: 0,
          earlierPeriodsCents: 0,
          earlierPeriodsCount: 0,
          waitingCount: count,
        });
      }
    }
    lines.sort(
      (a, b) =>
        b.amountCents - a.amountCents ||
        (a.trainerId < b.trainerId ? -1 : a.trainerId > b.trainerId ? 1 : 0),
    );

    return {
      allocations: stored
        .filter((row) => row.reason !== AllocationReason.UNPAID)
        .map((row) => ({
          id: row.id,
          settlementId: row.settlementId,
          attendanceId: row.attendanceId,
          trainerId: row.trainerId,
          subscriptionId: row.subscriptionId,
          subscriptionType: row.subscriptionType,
          valueCents: row.valueCents,
          reason: row.reason,
          fromEarlierPeriod: row.fromEarlierPeriod,
          attendance: attendanceView(row.attendance),
        })),
      lines,
      waiting: waiting.map(waitingView),
    };
  }

  /**
   * Loads the trainings not paid by a finalized report (only the period's when `includePayable`
   * is false) and works the report out (`calculateSettlement`).
   */
  private async calculate(
    manager: EntityManager,
    period: SettlementPeriod,
    includePayable: boolean,
  ) {
    const bounds = periodBounds(period);
    const earlierDraft = includePayable
      ? await manager
          .getRepository(SettlementEntity)
          .createQueryBuilder('s')
          .where('s.status = :draft', { draft: SettlementStatus.DRAFT })
          .andWhere('s.periodEnd < :start', { start: period.periodStart })
          .orderBy('s.periodEnd', 'DESC')
          .getOne()
      : null;

    const qb = manager
      .getRepository(AttendanceEntity)
      .createQueryBuilder('a')
      .select([
        'a.id',
        'a.trainerId',
        'a.traineeId',
        'a.locationId',
        'a.trainedAt',
        'a.paymentStatus',
        'a.subscriptionId',
      ])
      .where('a.trainedAt < :to', { to: bounds.to })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "settlement_allocations" sa
          JOIN "settlements" s ON s."id" = sa."settlementId"
          WHERE sa."attendanceId" = a."id"
            AND s."status" = :final
            AND sa."reason" <> :unpaid
        )`,
        {
          final: SettlementStatus.FINAL,
          unpaid: AllocationReason.UNPAID,
        },
      );
    if (!includePayable) {
      qb.andWhere('a.trainedAt >= :from', { from: bounds.from });
    }
    const attendances: CandidateAttendance[] = (await qb.getMany()).map(
      (a) => ({
        id: a.id,
        trainerId: a.trainerId,
        traineeId: a.traineeId,
        locationId: a.locationId,
        trainedAt: a.trainedAt,
        paymentStatus: a.paymentStatus,
        subscriptionId: a.subscriptionId,
      }),
    );

    const subscriptionIds = [
      ...new Set(
        attendances
          .map((a) => a.subscriptionId)
          .filter((id): id is string => !!id),
      ),
    ];
    const subscriptions = new Map<string, PayingSubscription>();
    const paidOrder = new Map<string, string[]>();
    if (subscriptionIds.length) {
      const subs = await manager
        .getRepository(SubscriptionEntity)
        .findBy({ id: In(subscriptionIds) });
      for (const s of subs) {
        subscriptions.set(s.id, {
          id: s.id,
          type: s.type,
          paidCents: s.paidCents,
          initialCredits: s.initialCredits,
          endsAt: s.endsAt,
          createdAt: s.createdAt,
        });
      }

      const paid = await manager
        .getRepository(AttendanceEntity)
        .createQueryBuilder('a')
        .select(['a.id', 'a.subscriptionId'])
        .where('a.subscriptionId IN (:...ids)', { ids: subscriptionIds })
        .andWhere('a.paymentStatus = :paid', {
          paid: AttendancePaymentStatus.PAID,
        })
        .orderBy('a.trainedAt', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .getMany();
      for (const row of paid) {
        const list = paidOrder.get(row.subscriptionId!) ?? [];
        list.push(row.id);
        paidOrder.set(row.subscriptionId!, list);
      }
    }

    return calculateSettlement({
      bounds,
      attendances,
      subscriptions,
      paidOrder,
      includePayable,
      earlierDraftTo: earlierDraft ? periodBounds(earlierDraft).to : null,
    });
  }
}

function paidSummaryOfItem(item: SettlementItem): PaidItemSummary {
  return {
    trainerId: item.attendance.trainerId,
    valueCents: item.valueCents,
    subscriptionType: item.subscriptionType,
    fromEarlierPeriod: item.fromEarlierPeriod,
  };
}

function attendanceView(a: CandidateAttendance | AttendanceEntity) {
  return {
    id: a.id,
    trainedAt: a.trainedAt,
    traineeId: a.traineeId,
    trainerId: a.trainerId,
    locationId: a.locationId,
    paymentStatus: a.paymentStatus,
    subscriptionId: a.subscriptionId,
  };
}

function draftAllocation(
  settlement: SettlementEntity,
  item: SettlementItem,
): AllocationView {
  return {
    id: item.attendance.id,
    settlementId: settlement.id,
    attendanceId: item.attendance.id,
    trainerId: item.attendance.trainerId,
    subscriptionId: item.subscriptionId,
    subscriptionType: item.subscriptionType,
    valueCents: item.valueCents,
    reason: item.reason,
    fromEarlierPeriod: item.fromEarlierPeriod,
    attendance: attendanceView(item.attendance),
  };
}

function waitingView(w: WaitingItem): WaitingView {
  return {
    attendanceId: w.attendance.id,
    trainerId: w.attendance.trainerId,
    traineeId: w.attendance.traineeId,
    locationId: w.attendance.locationId,
    trainedAt: w.attendance.trainedAt,
    reason: w.reason,
    subscriptionType: w.subscriptionType,
    availableFrom: w.availableFrom,
  };
}
