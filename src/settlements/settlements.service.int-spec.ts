import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { CashRegisterTransactionType } from '../cash-register/enums/cash-register-transaction-type.enum';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SettlementAllocationEntity } from './settlement-allocation.entity';
import { SettlementLineEntity } from './settlement-line.entity';

const DEC = { periodStart: '2025-12-01', periodEnd: '2025-12-31' };
const NOV = { periodStart: '2025-11-01', periodEnd: '2025-11-30' };
const JAN = { periodStart: '2026-01-01', periodEnd: '2026-01-31' };
const { SETTLEMENT_OUT } = CashRegisterTransactionType;

const sumAmounts = (lines: SettlementLineEntity[]) =>
  lines.reduce((s, l) => s + l.amountCents, 0);

describe('SettlementsService (integration)', () => {
  const fixtures = setupIntegrationSuite();

  async function world(fx: Fixtures) {
    const [trainee, coachA, coachB, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach A'),
      fx.trainer('Coach B'),
      fx.location(),
    ]);
    const attend = async (
      trainedAt: string,
      opts: { traineeId?: string; trainerId?: string } = {},
    ) =>
      (
        await fx.attend(
          opts.traineeId ?? trainee.id,
          opts.trainerId ?? coachA.id,
          loc.id,
          trainedAt,
        )
      ).attendance;
    return { trainee, coachA, coachB, loc, attend };
  }

  const settlementOutTxs = async (fx: Fixtures) =>
    (await fx.cashTxs()).filter((t) => t.type === SETTLEMENT_OUT);

  describe('generate', () => {
    it('SET-01 empty period: persisted DRAFT, empty lines and the "No attendance" info shape', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      await attend('2025-11-15T10:00:00Z'); // outside the period

      const res = await fx.settlements.generate(DEC);

      expect(Object.keys(res).sort()).toEqual(['info', 'lines', 'settlement']);
      expect(res.settlement).toMatchObject({
        periodStart: '2025-12-01',
        periodEnd: '2025-12-31',
        status: 'DRAFT',
      });
      expect(res.lines).toEqual([]);
      expect(res.info).toEqual({ message: 'No attendance in period' });
      const rows = await fx.settlementRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: res.settlement.id,
        status: 'DRAFT',
        periodStart: '2025-12-01',
        periodEnd: '2025-12-31',
      });
      expect(await fx.allocationsOf(res.settlement.id)).toHaveLength(0);
      expect(await fx.linesOf(res.settlement.id)).toHaveLength(0);
    });

    it('SET-02 period is [periodStart 00:00, periodEnd+1 00:00) in server TZ (UTC)', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      const justBefore = await attend('2025-11-30T23:59:59.999Z');
      const first = await attend('2025-12-01T00:00:00.000Z');
      const last = await attend('2025-12-31T23:59:59.999Z');
      const justAfter = await attend('2026-01-01T00:00:00.000Z');

      const { settlement } = await fx.settlements.generate(DEC);

      const ids = (await fx.allocationsOf(settlement.id)).map(
        (a) => a.attendanceId,
      );
      expect(ids.sort()).toEqual([first.id, last.id].sort());
      expect(ids).not.toContain(justBefore.id);
      expect(ids).not.toContain(justAfter.id);
    });

    // CHARACTERIZATION: possibly unintended
    it('SET-02 attendance at 2025-12-01 01:00 Sofia (23:00Z Nov 30) lands in November, not December', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      const sofiaDec1 = await attend('2025-12-01T01:00:00+02:00');
      expect(sofiaDec1.trainedAt.toISOString()).toBe(
        '2025-11-30T23:00:00.000Z',
      );

      const dec = await fx.settlements.generate(DEC);
      const nov = await fx.settlements.generate(NOV);

      expect(dec.info).toEqual({ message: 'No attendance in period' });
      expect(
        (await fx.allocationsOf(nov.settlement.id)).map((a) => a.attendanceId),
      ).toEqual([sofiaDec1.id]);
    });

    it('SET-04 UNPAID (and PAID-without-subscription) attendance allocates 0 with reason UNPAID', async () => {
      const fx = fixtures();
      const { trainee, coachA, loc, attend } = await world(fx);
      const unpaid = await attend('2025-12-05T10:00:00Z');
      const orphan = await fx.insertAttendance({
        traineeId: trainee.id,
        trainerId: coachA.id,
        locationId: loc.id,
        trainedAt: new Date('2025-12-06T10:00:00Z'),
        paymentStatus: AttendancePaymentStatus.PAID,
        subscriptionId: null,
      });

      const res = await fx.settlements.generate(DEC);

      const allocs = await fx.allocationsOf(res.settlement.id);
      expect(allocs).toHaveLength(2);
      for (const id of [unpaid.id, orphan.id]) {
        expect(allocs.find((a) => a.attendanceId === id)).toMatchObject({
          trainerId: coachA.id,
          valueCents: 0,
          reason: 'UNPAID',
          subscriptionId: null,
          subscriptionType: null,
        });
      }
      expect(res.info).toMatchObject({
        totalAttendance: 2,
        unpaidAttendance: 2,
      });
      expect(res.lines).toHaveLength(1);
      expect(res.lines[0]).toMatchObject({
        trainerId: coachA.id,
        amountCents: 0,
        attendanceCount: 2,
        unpaidAttendanceCount: 2,
      });
    });

    it('SET-05 PUNCH value = splitCents(paidCents, initialCredits); extra cent to the earliest by trainedAt', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(3, 10000)).id);
      // Created out of order: credits are consumed by creation order, but the
      // split follows trainedAt.
      const later = await attend('2025-12-10T10:00:00Z');
      const earlier = await attend('2025-12-05T10:00:00Z');

      const res = await fx.settlements.generate(DEC);

      const allocs = await fx.allocationsOf(res.settlement.id);
      const byAtt = new Map(allocs.map((a) => [a.attendanceId, a]));
      expect(byAtt.get(earlier.id)).toMatchObject({
        valueCents: 3334,
        reason: 'PUNCH_CREDIT',
        subscriptionId: sub.id,
        subscriptionType: 'PUNCH',
      });
      expect(byAtt.get(later.id)!.valueCents).toBe(3333);
      // The unused credit's 3333 is never allocated.
      expect(res.lines[0].amountCents).toBe(6667);
      expect(res.info).toMatchObject({ reportablePunchPaidAttendance: 2 });
    });

    it('SET-06 PUNCH index is global per subscription, across periods', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      await fx.buy(trainee.id, (await fx.punchPlan(3, 10000)).id);
      const nov = await attend('2025-11-10T10:00:00Z');
      const dec = await attend('2025-12-05T10:00:00Z');

      const decRes = await fx.settlements.generate(DEC);
      const novRes = await fx.settlements.generate(NOV);

      expect(
        (await fx.allocationValues(decRes.settlement.id)).get(dec.id),
      ).toBe(3333);
      expect(
        (await fx.allocationValues(novRes.settlement.id)).get(nov.id),
      ).toBe(3334);
    });

    it('SET-07 TIME not yet ended: allocations are 0 / TIME_PRORATA and reported as pending', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-01T00:00:00.000Z',
      }); // ends 2025-12-31T00:00Z
      const a = await attend('2025-12-05T10:00:00Z');
      const b = await attend('2025-12-10T10:00:00Z');
      freezeTime('2025-12-20T00:00:00.000Z');

      const res = await fx.settlements.generate(DEC);

      expect(res.settlement.generatedAt.toISOString()).toBe(
        '2025-12-20T00:00:00.000Z',
      );
      const allocs = await fx.allocationsOf(res.settlement.id);
      expect(allocs.map((x) => x.attendanceId).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      for (const alloc of allocs) {
        expect(alloc).toMatchObject({
          valueCents: 0,
          reason: 'TIME_PRORATA',
          subscriptionId: sub.id,
          subscriptionType: 'TIME',
        });
      }
      expect(res.info).toMatchObject({
        totalAttendance: 2,
        unpaidAttendance: 0,
        reportableTimePaidAttendance: 0,
        notReportableTimeAttendance: 2,
        pendingTimeSubscriptions: [
          {
            subscriptionId: sub.id,
            endsAt: '2025-12-31T00:00:00.000Z',
            attendanceInPeriodCount: 2,
          },
        ],
      });
      expect(res.lines[0]).toMatchObject({
        amountCents: 0,
        attendanceCount: 2,
        unpaidAttendanceCount: 0,
      });
    });

    describe('SET-08 TIME ended (endsAt <= generatedAt)', () => {
      async function timeScenario(fx: Fixtures) {
        const { trainee, attend } = await world(fx);
        const sub = await fx.buy(trainee.id, (await fx.timePlan(10, 9001)).id, {
          startsAt: '2025-11-28T00:00:00.000Z',
        }); // ends 2025-12-08T00:00Z
        const nov29 = await attend('2025-11-29T10:00:00Z');
        const dec = [
          await attend('2025-12-02T10:00:00Z'),
          await attend('2025-12-04T10:00:00Z'),
          await attend('2025-12-06T10:00:00Z'),
        ];
        return { sub, nov29, dec };
      }

      it('splits paidCents over ALL its PAID attendance and allocates only the in-period ones', async () => {
        const fx = fixtures();
        const { sub, nov29, dec } = await timeScenario(fx);
        freezeTime(sub.endsAt!); // equality counts as ended

        const res = await fx.settlements.generate(DEC);

        // splitCents(9001, 4) = [2251, 2250, 2250, 2250]; Nov 29 holds index 0.
        const values = await fx.allocationValues(res.settlement.id);
        expect(dec.map((a) => values.get(a.id))).toEqual([2250, 2250, 2250]);
        expect(values.has(nov29.id)).toBe(false);
        expect(res.lines[0].amountCents).toBe(6750);
        expect(res.lines[0].details).toEqual({
          punchCents: 0,
          timeCents: 6750,
        });
        expect(res.info).toMatchObject({
          reportableTimePaidAttendance: 3,
          notReportableTimeAttendance: 0,
          pendingTimeSubscriptions: [],
        });

        const nov = await fx.settlements.generate(NOV);
        expect(
          (await fx.allocationValues(nov.settlement.id)).get(nov29.id),
        ).toBe(2251);
      });

      it('1 ms before endsAt it is still pending', async () => {
        const fx = fixtures();
        const { sub } = await timeScenario(fx);
        freezeTime(new Date(sub.endsAt!.getTime() - 1));

        const res = await fx.settlements.generate(DEC);

        expect(res.lines[0].amountCents).toBe(0);
        expect(res.info).toMatchObject({ notReportableTimeAttendance: 3 });
      });
    });

    // CHARACTERIZATION: possibly unintended
    it('SET-09 pending TIME value is never paid by a later period; only regenerating the old period pays', async () => {
      const fx = fixtures();
      const { trainee, coachB, attend } = await world(fx);
      const other = await fx.trainee('Other');
      await fx.buy(trainee.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-01T00:00:00.000Z',
      }); // ends 2025-12-31T00:00Z
      const decAtts = [
        await attend('2025-12-05T10:00:00Z'),
        await attend('2025-12-10T10:00:00Z'),
      ];
      await attend('2026-01-10T10:00:00Z', {
        traineeId: other.id,
        trainerId: coachB.id,
      });

      freezeTime('2025-12-20T00:00:00Z');
      const decPending = await fx.settlements.generate(DEC);
      freezeTime('2026-02-01T00:00:00Z');
      const jan = await fx.settlements.generate(JAN);
      const decAgain = await fx.settlements.generate(DEC);

      expect(sumAmounts(decPending.lines)).toBe(0);
      const janIds = (await fx.allocationsOf(jan.settlement.id)).map(
        (a) => a.attendanceId,
      );
      for (const a of decAtts) expect(janIds).not.toContain(a.id);
      expect(sumAmounts(jan.lines)).toBe(0);

      const again = await fx.allocationValues(decAgain.settlement.id);
      expect(decAtts.map((a) => again.get(a.id))).toEqual([3000, 3000]);
    });

    // CHARACTERIZATION: possibly unintended
    it('SET-10 the same period can be generated twice and both can be finalized (money out twice)', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      await fx.cashIn(10000);
      await fx.buy(trainee.id, (await fx.punchPlan(3, 3000)).id);
      const atts = [
        await attend('2025-12-01T10:00:00Z'),
        await attend('2025-12-02T10:00:00Z'),
        await attend('2025-12-03T10:00:00Z'),
      ];

      const s1 = await fx.settlements.generate(DEC);
      const s2 = await fx.settlements.generate(DEC);

      expect(s1.settlement.id).not.toBe(s2.settlement.id);
      for (const s of [s1, s2]) {
        expect(s.settlement.status).toBe('DRAFT');
        const allocs = await fx.allocationsOf(s.settlement.id);
        expect(allocs.map((a) => a.attendanceId).sort()).toEqual(
          atts.map((a) => a.id).sort(),
        );
        expect(allocs.reduce((sum, a) => sum + a.valueCents, 0)).toBe(3000);
      }

      await fx.settlements.finalize(s1.settlement.id);
      await fx.settlements.finalize(s2.settlement.id);

      const outs = await settlementOutTxs(fx);
      expect(outs.map((t) => t.amountCents)).toEqual([-3000, -3000]);
      expect(await fx.balance()).toBe(10000 + 3000 - 6000);
    });

    describe('mixed period', () => {
      /**
       * Dec 2025, generated on 2025-12-31 (frozen):
       * - Ana: PUNCH 10000 / 3 credits -> 3334, 3333, 3333 by trainedAt
       * - Bob: TIME 4000, Dec 1 + 10d (ended) -> 2000 x 2
       * - Cid: no subscription -> UNPAID x 2
       * - Dan: TIME Dec 20 + 30d (pending) -> 0 x 1
       */
      async function mixedDecember(fx: Fixtures) {
        const { trainee: ana, coachA, coachB, attend } = await world(fx);
        const coachC = await fx.trainer('Coach C');
        const [bob, cid, dan] = await Promise.all([
          fx.trainee('Bob'),
          fx.trainee('Cid'),
          fx.trainee('Dan'),
        ]);
        const anaSub = await fx.buy(ana.id, (await fx.punchPlan(3, 10000)).id);
        const bobSub = await fx.buy(bob.id, (await fx.timePlan(10, 4000)).id, {
          startsAt: '2025-12-01T00:00:00Z',
        });
        const danSub = await fx.buy(dan.id, (await fx.timePlan(30, 9000)).id, {
          startsAt: '2025-12-20T00:00:00Z',
        });
        const at = (iso: string, traineeId: string, trainerId: string) =>
          attend(iso, { traineeId, trainerId });
        const atts = {
          anaA1: await at('2025-12-01T10:00:00Z', ana.id, coachA.id), // 3334
          anaA2: await at('2025-12-02T10:00:00Z', ana.id, coachA.id), // 3333
          bobA: await at('2025-12-03T10:00:00Z', bob.id, coachA.id), // 2000
          anaB: await at('2025-12-04T10:00:00Z', ana.id, coachB.id), // 3333
          cidB: await at('2025-12-05T10:00:00Z', cid.id, coachB.id), // unpaid
          bobB: await at('2025-12-07T10:00:00Z', bob.id, coachB.id), // 2000
          cidC: await at('2025-12-06T10:00:00Z', cid.id, coachC.id), // unpaid
          danC: await at('2025-12-22T10:00:00Z', dan.id, coachC.id), // pending
        };
        freezeTime('2025-12-31T00:00:00Z');
        const res = await fx.settlements.generate(DEC);
        return { res, atts, coachA, coachB, coachC, anaSub, bobSub, danSub };
      }

      it('SET-11 one line per trainer with sums, counts and details, ordered by amountCents DESC', async () => {
        const fx = fixtures();
        const { res, coachA, coachB, coachC } = await mixedDecember(fx);

        const expected = [
          {
            trainerId: coachA.id,
            amountCents: 3334 + 3333 + 2000,
            attendanceCount: 3,
            unpaidAttendanceCount: 0,
            details: { punchCents: 6667, timeCents: 2000 },
          },
          {
            trainerId: coachB.id,
            amountCents: 3333 + 2000,
            attendanceCount: 3,
            unpaidAttendanceCount: 1,
            details: { punchCents: 3333, timeCents: 2000 },
          },
          {
            trainerId: coachC.id, // only unpaid/pending rows: still a 0 line
            amountCents: 0,
            attendanceCount: 2,
            unpaidAttendanceCount: 1,
            details: { punchCents: 0, timeCents: 0 },
          },
        ];
        expect(res.lines).toMatchObject(expected);
        const stored = await fx.linesOf(res.settlement.id);
        expect(stored).toHaveLength(3);
        for (const line of expected) {
          expect(
            stored.find((l) => l.trainerId === line.trainerId),
          ).toMatchObject(line);
        }
      });

      it('SET-12 info counters for a mixed period', async () => {
        const fx = fixtures();
        const { res, danSub } = await mixedDecember(fx);

        expect(res.info).toEqual({
          totalAttendance: 8,
          unpaidAttendance: 2,
          reportablePunchPaidAttendance: 3,
          reportableTimePaidAttendance: 2,
          notReportableTimeAttendance: 1,
          pendingTimeSubscriptions: [
            {
              subscriptionId: danSub.id,
              endsAt: '2026-01-19T00:00:00.000Z',
              attendanceInPeriodCount: 1,
            },
          ],
        });
      });

      it("SET-13 each allocation is attributed to its attendance's trainer", async () => {
        const fx = fixtures();
        const { res, atts, coachA, coachB, coachC } = await mixedDecember(fx);

        const allocs = await fx.allocationsOf(res.settlement.id);
        const byAtt = new Map(allocs.map((a) => [a.attendanceId, a]));
        const expectAlloc = (
          key: keyof typeof atts,
          trainerId: string,
          valueCents: number,
        ) =>
          expect(byAtt.get(atts[key].id)).toMatchObject({
            trainerId,
            valueCents,
          });

        // Ana's single PUNCH sub is shared by Coach A and Coach B.
        expectAlloc('anaA1', coachA.id, 3334);
        expectAlloc('anaA2', coachA.id, 3333);
        expectAlloc('anaB', coachB.id, 3333);
        expectAlloc('bobA', coachA.id, 2000);
        expectAlloc('bobB', coachB.id, 2000);
        expectAlloc('cidB', coachB.id, 0);
        expectAlloc('cidC', coachC.id, 0);
        expectAlloc('danC', coachC.id, 0);
        expect(allocs).toHaveLength(8);
      });
    });

    it('SET-14 fully used PUNCH and fully in-period ended TIME allocate exactly paidCents', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const other = await fx.trainee('Other');
      await fx.buy(trainee.id, (await fx.punchPlan(3, 10000)).id);
      await fx.buy(other.id, (await fx.timePlan(10, 10001)).id, {
        startsAt: '2025-12-01T00:00:00Z',
      });
      for (const day of ['01', '02', '03']) {
        await attend(`2025-12-${day}T10:00:00Z`);
        await attend(`2025-12-${day}T11:00:00Z`, { traineeId: other.id });
      }
      freezeTime('2026-01-05T00:00:00Z');

      const res = await fx.settlements.generate(DEC);

      const allocs = await fx.allocationsOf(res.settlement.id);
      const sumFor = (type: PlanType) =>
        allocs
          .filter((a) => a.subscriptionType === type)
          .reduce((s, a) => s + a.valueCents, 0);
      expect(sumFor(PlanType.PUNCH)).toBe(10000);
      expect(sumFor(PlanType.TIME)).toBe(10001);
      expect(res.lines[0].amountCents).toBe(20001);
    });
  });

  describe('finalize', () => {
    async function twoPunchAttendances(fx: Fixtures) {
      const w = await world(fx);
      await fx.buy(w.trainee.id, (await fx.punchPlan(3, 10000)).id);
      // Two trainers -> two lines (3334 + 3333), so the payout must sum them.
      const a1 = await w.attend('2025-12-01T10:00:00Z');
      const a2 = await w.attend('2025-12-02T10:00:00Z', {
        trainerId: w.coachB.id,
      });
      const res = await fx.settlements.generate(DEC); // lines total 6667
      return { ...w, a1, a2, res };
    }

    it('SET-20 DRAFT -> FINAL books one SETTLEMENT_OUT of -sum(lines)', async () => {
      const fx = fixtures();
      const { res } = await twoPunchAttendances(fx);
      const lines: SettlementLineEntity[] = res.lines;
      expect(lines.map((l) => l.amountCents)).toEqual([3334, 3333]);
      expect(await fx.balance()).toBe(10000);

      const finalized = await fx.settlements.finalize(res.settlement.id);

      expect(finalized.status).toBe('FINAL');
      expect(
        (await fx.settlements.getById(res.settlement.id)).settlement.status,
      ).toBe('FINAL');
      const outs = await settlementOutTxs(fx);
      expect(outs).toHaveLength(1);
      expect(outs[0]).toMatchObject({
        sourceType: 'SETTLEMENT',
        sourceId: res.settlement.id,
        amountCents: -6667,
        balanceAfterCents: 3333,
      });
      expect(await fx.balance()).toBe(3333);
    });

    it('SET-21 insufficient balance: 400, stays DRAFT, no tx, balance unchanged', async () => {
      const fx = fixtures();
      const { res } = await twoPunchAttendances(fx);
      await fx.cashOut(5000); // balance 5000 < 6667

      const err = await rejectionOf(fx.settlements.finalize(res.settlement.id));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Cash register balance cannot be negative');
      expect(
        (await fx.settlements.getById(res.settlement.id)).settlement.status,
      ).toBe('DRAFT');
      expect(await settlementOutTxs(fx)).toHaveLength(0);
      expect(await fx.balance()).toBe(5000);
    });

    it('SET-22 total 0 (only unpaid/pending rows) -> FINAL with no cash tx', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      await attend('2025-12-05T10:00:00Z'); // UNPAID
      const { settlement } = await fx.settlements.generate(DEC);

      const finalized = await fx.settlements.finalize(settlement.id);

      expect(finalized.status).toBe('FINAL');
      expect(await fx.cashTxs()).toHaveLength(0);
      expect(await fx.balance()).toBe(0);
    });

    it('SET-23 finalizing a FINAL settlement is a no-op returning the settlement', async () => {
      const fx = fixtures();
      const { res } = await twoPunchAttendances(fx);
      await fx.settlements.finalize(res.settlement.id);
      const txCount = (await fx.cashTxs()).length;

      const again = await fx.settlements.finalize(res.settlement.id);

      expect(again).toMatchObject({ id: res.settlement.id, status: 'FINAL' });
      expect(await fx.cashTxs()).toHaveLength(txCount);
      expect(await fx.balance()).toBe(3333);
    });

    it('SET-24 unknown id -> 404 Settlement not found', async () => {
      const fx = fixtures();
      const err = await rejectionOf(fx.settlements.finalize(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Settlement not found');
    });

    // CHARACTERIZATION: possibly unintended
    it('SET-25 finalize pays the line amounts stored at generation, not the remaining allocations', async () => {
      const fx = fixtures();
      const { a1, res } = await twoPunchAttendances(fx);

      await fx.attendance.remove(a1.id); // its 3334 allocation cascades away

      const remaining = await fx.allocationsOf(res.settlement.id);
      expect(remaining.reduce((s, a) => s + a.valueCents, 0)).toBe(3333);
      await fx.settlements.finalize(res.settlement.id);
      const outs = await settlementOutTxs(fx);
      expect(outs.map((t) => t.amountCents)).toEqual([-6667]);
    });
  });

  describe('remove / read', () => {
    it('SET-30 delete cascades lines and allocations; unknown id -> 404', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      await fx.buy(trainee.id, (await fx.punchPlan(3, 3000)).id);
      await attend('2025-12-01T10:00:00Z');
      const keep = await fx.settlements.generate(DEC);
      const doomed = await fx.settlements.generate(DEC);

      expect(await fx.settlements.remove(doomed.settlement.id)).toEqual({
        deleted: true,
      });

      expect((await fx.settlementRows()).map((s) => s.id)).toEqual([
        keep.settlement.id,
      ]);
      expect(await fx.linesOf(doomed.settlement.id)).toHaveLength(0);
      expect(await fx.allocationsOf(doomed.settlement.id)).toHaveLength(0);
      expect(await fx.ds.getRepository(SettlementLineEntity).count()).toBe(1);
      expect(
        await fx.ds.getRepository(SettlementAllocationEntity).count(),
      ).toBe(1);

      const err = await rejectionOf(fx.settlements.remove(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Settlement not found');
    });

    // CHARACTERIZATION: possibly unintended
    it('SET-31 a FINAL settlement can be deleted; its cash-out stays and loses sourceDetails', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      await fx.buy(trainee.id, (await fx.punchPlan(2, 2000)).id);
      await attend('2025-12-01T10:00:00Z');
      const { settlement } = await fx.settlements.generate(DEC);
      await fx.settlements.finalize(settlement.id);

      expect(await fx.settlements.remove(settlement.id)).toEqual({
        deleted: true,
      });

      const state = await fx.cashRegister.getCurrentState();
      expect(state.balanceCents).toBe(1000);
      const out = state.transactions.find((t) => t.type === SETTLEMENT_OUT);
      expect(out).toMatchObject({
        sourceId: settlement.id,
        amountCents: -1000,
        sourceDetails: null,
      });
    });

    it('SET-32 list() is ordered by generatedAt DESC', async () => {
      const fx = fixtures();
      freezeTime('2026-01-01T00:00:00Z');
      const first = await fx.settlements.generate(DEC);
      freezeTime('2026-01-03T00:00:00Z');
      const third = await fx.settlements.generate(NOV);
      freezeTime('2026-01-02T00:00:00Z');
      const second = await fx.settlements.generate(JAN);

      const list = await fx.settlements.list();

      expect(list.map((s) => s.id)).toEqual([
        third.settlement.id,
        second.settlement.id,
        first.settlement.id,
      ]);
    });

    it('SET-33 getById returns settlement + lines, optionally limited to one trainer; unknown -> 404', async () => {
      const fx = fixtures();
      const { coachA, coachB, attend } = await world(fx);
      await attend('2025-12-01T10:00:00Z', { trainerId: coachA.id });
      await attend('2025-12-02T10:00:00Z', { trainerId: coachB.id });
      const { settlement } = await fx.settlements.generate(DEC);

      const all = await fx.settlements.getById(settlement.id);
      const onlyB = await fx.settlements.getById(settlement.id, coachB.id);

      expect(all.settlement).toMatchObject({
        id: settlement.id,
        status: 'DRAFT',
      });
      expect(all.lines.map((l) => l.trainerId).sort()).toEqual(
        [coachA.id, coachB.id].sort(),
      );
      expect(onlyB.lines.map((l) => l.trainerId)).toEqual([coachB.id]);

      const err = await rejectionOf(fx.settlements.getById(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Settlement not found');
    });

    it('SET-34 allocations: defaults, trainedAt/id ordering, paging total, trainer filter, unknown id', async () => {
      const fx = fixtures();
      const { coachB, attend } = await world(fx);
      const other = await fx.trainee('Other');
      // Created out of order; two rows share a trainedAt (tie -> id ASC).
      const d3 = await attend('2025-12-03T10:00:00Z', { trainerId: coachB.id });
      const d1 = await attend('2025-12-01T10:00:00Z');
      const d2a = await attend('2025-12-02T10:00:00Z');
      const d2b = await attend('2025-12-02T10:00:00Z', {
        traineeId: other.id,
        trainerId: coachB.id,
      });
      const { settlement } = await fx.settlements.generate(DEC);
      const tie = [d2a.id, d2b.id].sort();
      const ordered = [d1.id, ...tie, d3.id];

      const all = await fx.settlements.allocations(settlement.id, {});
      expect(all.total).toBe(4);
      expect(all.limit).toBe(50);
      expect(all.offset).toBe(0);
      expect(all.rows.map((r) => r.attendanceId)).toEqual(ordered);
      expect(all.rows[0].attendance).toMatchObject({
        id: d1.id,
        trainedAt: d1.trainedAt,
      });

      const page = await fx.settlements.allocations(settlement.id, {
        limit: 2,
        offset: 1,
      });
      expect(page).toMatchObject({ total: 4, limit: 2, offset: 1 });
      expect(page.rows.map((r) => r.attendanceId)).toEqual(ordered.slice(1, 3));

      const onlyB = await fx.settlements.allocations(settlement.id, {
        trainerId: coachB.id,
      });
      expect(onlyB.total).toBe(2);
      expect(onlyB.rows.map((r) => r.attendanceId)).toEqual([d2b.id, d3.id]);
      expect(onlyB.rows.every((r) => r.trainerId === coachB.id)).toBe(true);

      expect(await fx.settlements.allocations(randomUUID(), {})).toEqual({
        total: 0,
        limit: 50,
        offset: 0,
        rows: [],
      });
    });
  });
});
