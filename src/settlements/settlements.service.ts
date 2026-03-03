import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { getLocalDateInterval } from '../attendance/attendance-range.util';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { GenerateSettlementDto } from './dto/generate-settlement.dto';
import { AllocationReason } from './enums/allocation-reason.enum';
import { SettlementStatus } from './enums/settlement-status.enum';
import { SettlementAllocationEntity } from './settlement-allocation.entity';
import { splitCents } from './settlement-allocation.util';
import { SettlementLineEntity } from './settlement-line.entity';
import { SettlementEntity } from './settlement.entity';

@Injectable()
export class SettlementsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SettlementEntity)
    private readonly settlementRepo: Repository<SettlementEntity>,
    @InjectRepository(SettlementLineEntity)
    private readonly lineRepo: Repository<SettlementLineEntity>,
    @InjectRepository(SettlementAllocationEntity)
    private readonly allocRepo: Repository<SettlementAllocationEntity>,
    @InjectRepository(AttendanceEntity)
    private readonly attRepo: Repository<AttendanceEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subRepo: Repository<SubscriptionEntity>,
    private readonly cashRegisterService: CashRegisterService,
  ) {}

  async generate(dto: GenerateSettlementDto) {
    const { from, to } = getLocalDateInterval(dto.periodStart, dto.periodEnd);
    const generatedAt = new Date();

    return this.dataSource.transaction(async (manager) => {
      // 1) create settlement header
      const settlement = manager.getRepository(SettlementEntity).create({
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        generatedAt,
        status: SettlementStatus.DRAFT,
        notes: null,
      });
      const savedSettlement = await manager
        .getRepository(SettlementEntity)
        .save(settlement);

      // 2) load attendance rows in period
      // We only need: id, trainerId, traineeId, trainedAt, paymentStatus, subscriptionId
      const attendances = await manager
        .getRepository(AttendanceEntity)
        .createQueryBuilder('a')
        .select([
          'a.id',
          'a.trainerId',
          'a.traineeId',
          'a.trainedAt',
          'a.paymentStatus',
          'a.subscriptionId',
        ])
        .where('a.trainedAt >= :from AND a.trainedAt < :to', { from, to })
        .orderBy('a.trainedAt', 'ASC')
        .addOrderBy('a.id', 'ASC')
        .getMany();

      if (attendances.length === 0) {
        // still return an empty settlement
        return {
          settlement: savedSettlement,
          lines: [],
          info: { message: 'No attendance in period' },
        };
      }

      // 3) gather subscriptionIds we need
      const subscriptionIds = Array.from(
        new Set(
          attendances
            .map((a) => a.subscriptionId)
            .filter((x): x is string => !!x),
        ),
      );

      const subs = subscriptionIds.length
        ? await manager
            .getRepository(SubscriptionEntity)
            .findByIds(subscriptionIds as any)
        : [];

      const subsById = new Map<string, SubscriptionEntity>();
      subs.forEach((s) => subsById.set(s.id, s));

      // 4) build allocations in memory, then bulk insert
      // We need deterministic splitting per subscription:
      // - PUNCH: split paidCents across initialCredits, order by attendance trainedAt asc
      // - TIME : if endsAt <= generatedAt, split paidCents across ALL attendance linked to that subscription (not just in period),
      //          then include only the ones in this settlement period.
      //
      // For PUNCH we only need attendances in this settlement, because value is stable across all credits,
      // but we must allocate based on the order within that subscription globally to match “first remainder gets +1”.
      // So we should consider ALL attendances linked to subscription, not only in this period, to keep deterministic global order.
      // Same for TIME. We'll do "global order per subscription" for correctness.

      // 4.1) collect affected subscriptionIds by type
      const punchSubIds = new Set<string>();
      const timeSubIds = new Set<string>();

      for (const a of attendances) {
        if (a.paymentStatus !== AttendancePaymentStatus.PAID) continue;
        if (!a.subscriptionId) continue;
        const sub = subsById.get(a.subscriptionId);
        if (!sub) continue;
        if (sub.type === PlanType.PUNCH) punchSubIds.add(sub.id);
        if (sub.type === PlanType.TIME) timeSubIds.add(sub.id);
      }

      // 4.2) load “global attendance per subscription” for deterministic ordering
      // PUNCH: all PAID attendance linked to that subscription
      const punchAttendancesBySub = new Map<string, AttendanceEntity[]>();
      if (punchSubIds.size > 0) {
        const rows = await manager
          .getRepository(AttendanceEntity)
          .createQueryBuilder('a')
          .select(['a.id', 'a.subscriptionId', 'a.trainedAt'])
          .where('a.subscriptionId IN (:...ids)', {
            ids: Array.from(punchSubIds),
          })
          .andWhere('a.paymentStatus = :paid', {
            paid: AttendancePaymentStatus.PAID,
          })
          .orderBy('a.trainedAt', 'ASC')
          .addOrderBy('a.id', 'ASC')
          .getMany();

        for (const r of rows) {
          const sid = r.subscriptionId!;
          const arr = punchAttendancesBySub.get(sid) ?? [];
          arr.push(r);
          punchAttendancesBySub.set(sid, arr);
        }
      }

      // TIME: only consider subs that are complete at generatedAt
      const eligibleTimeSubs = Array.from(timeSubIds).filter((id) => {
        const s = subsById.get(id);
        return !!s?.endsAt && s.endsAt.getTime() <= generatedAt.getTime();
      });

      const timeAttendancesBySub = new Map<string, AttendanceEntity[]>();
      if (eligibleTimeSubs.length > 0) {
        const rows = await manager
          .getRepository(AttendanceEntity)
          .createQueryBuilder('a')
          .select(['a.id', 'a.subscriptionId', 'a.trainedAt'])
          .where('a.subscriptionId IN (:...ids)', { ids: eligibleTimeSubs })
          .andWhere('a.paymentStatus = :paid', {
            paid: AttendancePaymentStatus.PAID,
          })
          .orderBy('a.trainedAt', 'ASC')
          .addOrderBy('a.id', 'ASC')
          .getMany();

        for (const r of rows) {
          const sid = r.subscriptionId!;
          const arr = timeAttendancesBySub.get(sid) ?? [];
          arr.push(r);
          timeAttendancesBySub.set(sid, arr);
        }
      }

      // 4.3) build per-subscription value map: attendanceId -> cents
      const valueByAttendanceId = new Map<
        string,
        {
          value: number;
          reason: AllocationReason;
          type: PlanType | null;
          subId: string | null;
        }
      >();

      // PUNCH map
      for (const sid of punchSubIds) {
        const sub = subsById.get(sid);
        if (!sub) continue;
        const all = punchAttendancesBySub.get(sid) ?? [];
        const credits = sub.initialCredits ?? 0;

        if (credits <= 0) continue;

        const split = splitCents(sub.paidCents, credits);

        // We assign split[0..credits-1] to the first "credits" attendances in order.
        // If there are more attendances than credits (shouldn't happen if consumption logic is correct),
        // we cap at credits for safety.
        const limit = Math.min(all.length, split.length);

        for (let i = 0; i < limit; i++) {
          const attId = all[i].id;
          valueByAttendanceId.set(attId, {
            value: split[i],
            reason: AllocationReason.PUNCH_CREDIT,
            type: PlanType.PUNCH,
            subId: sid,
          });
        }
      }

      // TIME map
      for (const sid of eligibleTimeSubs) {
        const sub = subsById.get(sid);
        if (!sub) continue;
        const all = timeAttendancesBySub.get(sid) ?? [];
        const count = all.length;

        if (count <= 0) {
          // simplest/clear: allocate nothing
          continue;
        }

        const split = splitCents(sub.paidCents, count);
        for (let i = 0; i < all.length; i++) {
          const attId = all[i].id;
          valueByAttendanceId.set(attId, {
            value: split[i],
            reason: AllocationReason.TIME_PRORATA,
            type: PlanType.TIME,
            subId: sid,
          });
        }
      }

      const totalAttendance = attendances.length;
      let unpaidAttendance = 0;

      let reportablePunchPaidAttendance = 0;
      let reportableTimePaidAttendance = 0;

      let notReportableTimeAttendance = 0;

      // optional: which time subs are pending and how many rows in this period they have
      const pendingTimeSubs = new Map<
        string,
        { endsAt: Date | null; count: number }
      >();

      // 4.4) create allocations for attendances in the settlement period
      const allocationRows: Partial<SettlementAllocationEntity>[] = [];
      for (const a of attendances) {
        const sub = a.subscriptionId
          ? subsById.get(a.subscriptionId)
          : undefined;

        // UNPAID or missing subscription -> value 0
        if (
          a.paymentStatus === AttendancePaymentStatus.UNPAID ||
          !a.subscriptionId ||
          !sub
        ) {
          unpaidAttendance += 1;

          allocationRows.push({
            settlementId: savedSettlement.id,
            attendanceId: a.id,
            trainerId: a.trainerId,
            subscriptionId: null,
            subscriptionType: null,
            valueCents: 0,
            reason: AllocationReason.UNPAID,
          });
          continue;
        }

        // PAID with subscription
        const mapped = valueByAttendanceId.get(a.id);

        if (!mapped) {
          // Not allocatable yet OR inconsistent
          // Specifically: TIME not ended => "not reportable yet"
          if (sub.type === PlanType.TIME) {
            notReportableTimeAttendance += 1;

            const entry = pendingTimeSubs.get(sub.id) ?? {
              endsAt: sub.endsAt ?? null,
              count: 0,
            };
            entry.count += 1;
            pendingTimeSubs.set(sub.id, entry);
          }

          allocationRows.push({
            settlementId: savedSettlement.id,
            attendanceId: a.id,
            trainerId: a.trainerId,
            subscriptionId: a.subscriptionId,
            subscriptionType: sub.type,
            valueCents: 0,
            // keep reason informative
            reason:
              sub.type === PlanType.TIME
                ? AllocationReason.TIME_PRORATA
                : AllocationReason.PUNCH_CREDIT,
          });
          continue;
        }

        // Reportable allocation
        if (mapped.reason === AllocationReason.PUNCH_CREDIT)
          reportablePunchPaidAttendance += 1;
        if (mapped.reason === AllocationReason.TIME_PRORATA)
          reportableTimePaidAttendance += 1;

        allocationRows.push({
          settlementId: savedSettlement.id,
          attendanceId: a.id,
          trainerId: a.trainerId,
          subscriptionId: mapped.subId,
          subscriptionType: mapped.type,
          valueCents: mapped.value,
          reason: mapped.reason,
        });
      }

      await manager
        .getRepository(SettlementAllocationEntity)
        .save(allocationRows);

      // 5) aggregate lines per trainer
      const totals = new Map<
        string,
        {
          amountCents: number;
          count: number;
          unpaid: number;
          punch: number;
          time: number;
        }
      >();

      for (const r of allocationRows) {
        const trainerId = r.trainerId!;
        const current = totals.get(trainerId) ?? {
          amountCents: 0,
          count: 0,
          unpaid: 0,
          punch: 0,
          time: 0,
        };
        current.count += 1;
        current.amountCents += r.valueCents ?? 0;

        if ((r.valueCents ?? 0) === 0 && r.reason === AllocationReason.UNPAID)
          current.unpaid += 1;
        if (r.reason === AllocationReason.PUNCH_CREDIT)
          current.punch += r.valueCents ?? 0;
        if (r.reason === AllocationReason.TIME_PRORATA)
          current.time += r.valueCents ?? 0;

        totals.set(trainerId, current);
      }

      const lineRows: Partial<SettlementLineEntity>[] = Array.from(
        totals.entries(),
      ).map(([trainerId, t]) => ({
        settlementId: savedSettlement.id,
        trainerId,
        amountCents: t.amountCents,
        attendanceCount: t.count,
        unpaidAttendanceCount: t.unpaid,
        details: {
          punchCents: t.punch,
          timeCents: t.time,
        },
      }));

      await manager.getRepository(SettlementLineEntity).save(lineRows);

      const lines = await manager.getRepository(SettlementLineEntity).find({
        where: { settlementId: savedSettlement.id },
        order: { amountCents: 'DESC' as any },
      });

      return {
        settlement: savedSettlement,
        lines,
        info: {
          totalAttendance,
          unpaidAttendance,
          reportablePunchPaidAttendance,
          reportableTimePaidAttendance,
          notReportableTimeAttendance,
          pendingTimeSubscriptions: Array.from(pendingTimeSubs.entries()).map(
            ([subscriptionId, v]) => ({
              subscriptionId,
              endsAt: v.endsAt ? v.endsAt.toISOString() : null,
              attendanceInPeriodCount: v.count,
            }),
          ),
        },
      };
    });
  }

  async list() {
    return this.settlementRepo.find({ order: { generatedAt: 'DESC' } });
  }

  async getById(id: string, trainerId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    const where = trainerId
      ? { settlementId: id, trainerId }
      : { settlementId: id };

    const lines = await this.lineRepo.find({ where });
    return { settlement, lines };
  }

  async remove(id: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    await this.settlementRepo.remove(settlement);
    return { deleted: true };
  }

  async finalize(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const settlement = await manager
        .getRepository(SettlementEntity)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id })
        .getOne();

      if (!settlement) throw new NotFoundException('Settlement not found');
      if (settlement.status === SettlementStatus.FINAL) return settlement;

      const lines = await manager.getRepository(SettlementLineEntity).find({
        where: { settlementId: settlement.id },
      });

      const totalAmountCents = lines.reduce(
        (acc, line) => acc + line.amountCents,
        0,
      );

      await this.cashRegisterService.registerSettlementFinalization(
        manager,
        settlement.id,
        totalAmountCents,
      );

      settlement.status = SettlementStatus.FINAL;
      return manager.getRepository(SettlementEntity).save(settlement);
    });
  }

  async allocations(
    settlementId: string,
    query: { trainerId?: string; offset?: number; limit?: number },
  ) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const qb = this.allocRepo
      .createQueryBuilder('sa')
      .leftJoinAndSelect('sa.attendance', 'a')
      .where('sa.settlementId = :settlementId', { settlementId });

    if (query.trainerId)
      qb.andWhere('sa.trainerId = :trainerId', { trainerId: query.trainerId });

    qb.orderBy('a.trainedAt', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .offset(offset)
      .limit(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { total, limit, offset, rows };
  }
}
