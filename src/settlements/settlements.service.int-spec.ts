import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { CashRegisterTransactionType } from '../cash-register/enums/cash-register-transaction-type.enum';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { SettlementStatus } from './enums/settlement-status.enum';
import { SettlementsCronService } from './settlements-cron.service';

const { SETTLEMENT_OUT } = CashRegisterTransactionType;
/** Every subscription in these tests is bought on Oct 1, 2025, before the trainings. */
const BOUGHT = '2025-10-01T08:00:00.000Z';

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
    /** Buys a pass for the trainee, dated `boughtAt` (Oct 1, 2025 by default). */
    const buy = async (
      planId: string,
      opts: { traineeId?: string; startsAt?: string; boughtAt?: string } = {},
    ) => {
      const sub = await fx.buy(opts.traineeId ?? trainee.id, planId, {
        startsAt: opts.startsAt,
      });
      return fx.boughtAt(sub.id, opts.boughtAt ?? BOUGHT);
    };
    return { trainee, coachA, coachB, loc, attend, buy };
  }

  const settlementOutTxs = async (fx: Fixtures) =>
    (await fx.cashTxs()).filter((t) => t.type === SETTLEMENT_OUT);
  const report = (fx: Fixtures, id: string) => fx.settlements.getById(id);
  const paidIds = async (fx: Fixtures, id: string) =>
    (await fx.settlements.allocations(id, { limit: 500 })).rows.map(
      (r) => r.attendanceId,
    );

  describe('creating reports', () => {
    it('AUTO-01 with no report yet: creates the half month that ended last, as a DRAFT', async () => {
      const fx = fixtures();
      freezeTime('2026-11-19T10:00:00.000Z');

      const created = await fx.settlements.createDueReports();

      expect(created).toHaveLength(1);
      expect(await fx.settlementRows()).toEqual([
        expect.objectContaining({
          periodStart: '2026-11-01',
          periodEnd: '2026-11-15',
          status: SettlementStatus.DRAFT,
          generatedAt: new Date('2026-11-19T10:00:00.000Z'),
          finalizedAt: null,
        }),
      ]);
    });

    it('AUTO-02 after the manual report to Nov 15: Nov 16-30 at 04:00 Sofia on Dec 1, once', async () => {
      const fx = fixtures();
      await fx.report('2026-01-01', '2026-11-15');

      freezeTime('2026-12-01T01:59:59.000Z'); // 03:59:59 Sofia
      expect(await fx.settlements.createDueReports()).toEqual([]);

      freezeTime('2026-12-01T02:00:00.000Z'); // 04:00 Sofia
      const created = await fx.settlements.createDueReports();
      expect(
        created.map((s) => [s.periodStart, s.periodEnd, s.status]),
      ).toEqual([['2026-11-16', '2026-11-30', 'DRAFT']]);

      expect(await fx.settlements.createDueReports()).toEqual([]);
      expect(await fx.settlementRows()).toHaveLength(2);
    });

    it('AUTO-03 catches up on every period missed, and runs twice at once without duplicates', async () => {
      const fx = fixtures();
      await fx.report('2026-01-01', '2026-11-15');
      freezeTime('2027-01-02T12:00:00.000Z');

      await Promise.all([
        fx.settlements.createDueReports(),
        fx.settlements.createDueReports(),
      ]);

      const periods = (await fx.settlements.list()).map((s) => [
        s.periodStart,
        s.periodEnd,
      ]);
      expect(periods).toEqual([
        ['2026-12-16', '2026-12-31'],
        ['2026-12-01', '2026-12-15'],
        ['2026-11-16', '2026-11-30'],
        ['2026-01-01', '2026-11-15'],
      ]);
    });

    it('AUTO-04 the job creates the due reports when the API starts', async () => {
      const fx = fixtures();
      const cron = fx.moduleRef.get(SettlementsCronService);
      await fx.report('2026-01-01', '2026-11-15');
      freezeTime('2026-12-02T10:00:00.000Z');

      try {
        await cron.onModuleInit();
      } finally {
        cron.onModuleDestroy();
      }

      expect((await fx.settlements.list()).map((s) => s.periodStart)).toEqual([
        '2026-11-16',
        '2026-01-01',
      ]);
    });
  });

  describe('create-due (the job on demand)', () => {
    it('AUTO-05 creates every due report after the latest one, oldest first, never before it, then 409 says when the next comes', async () => {
      const fx = fixtures();
      // Production: the manual report from Jan 1 to Nov 15, 2026.
      await fx.report('2026-01-01', '2026-11-15');
      freezeTime('2027-01-02T10:00:00.000Z');

      const { created } = await fx.settlements.createDueReportsNow();

      expect(
        created.map((s) => [s.periodStart, s.periodEnd, s.status]),
      ).toEqual([
        ['2026-11-16', '2026-11-30', 'DRAFT'],
        ['2026-12-01', '2026-12-15', 'DRAFT'],
        ['2026-12-16', '2026-12-31', 'DRAFT'],
      ]);
      expect(
        (await fx.settlementRows()).map((s) => s.periodStart).sort(),
      ).toEqual(['2026-01-01', '2026-11-16', '2026-12-01', '2026-12-16']);

      const err = await rejectionOf(fx.settlements.createDueReportsNow());
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'The report for 2026-12-16 to 2026-12-31 already exists; the next one (2027-01-01 to 2027-01-15) is created on 2027-01-16 at 04:00 Europe/Sofia time',
      );
      expect(await fx.settlementRows()).toHaveLength(4);
    });

    it('AUTO-06 creates nothing before 04:00 Sofia on the day after the period', async () => {
      const fx = fixtures();
      await fx.report('2026-01-01', '2026-11-15');
      freezeTime('2026-12-01T01:59:00.000Z'); // 03:59 Sofia

      const err = await rejectionOf(fx.settlements.createDueReportsNow());
      expect(err.message).toBe(
        'The report for 2026-01-01 to 2026-11-15 already exists; the next one (2026-11-16 to 2026-11-30) is created on 2026-12-01 at 04:00 Europe/Sofia time',
      );

      freezeTime('2026-12-01T02:00:00.000Z');
      expect(
        (await fx.settlements.createDueReportsNow()).created.map(
          (s) => s.periodStart,
        ),
      ).toEqual(['2026-11-16']);
    });
  });

  describe('what a draft pays', () => {
    it('SET-02 periods are gym-local (Europe/Sofia) half months', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      const lastOfNov = await attend('2025-11-30T21:59:59.999Z'); // 23:59:59.999 Sofia
      const sofiaDec1 = await attend('2025-12-01T01:00:00+02:00'); // 23:00Z Nov 30
      const dec15 = await attend('2025-12-15T21:59:59.999Z');
      const dec16 = await attend('2025-12-15T22:00:00.000Z'); // Dec 16 00:00 Sofia
      const nov = await fx.report('2025-11-16', '2025-11-30');
      const dec = await fx.report('2025-12-01', '2025-12-15');

      const waitingIds = async (id: string) =>
        (await report(fx, id)).waiting.map((w) => w.attendanceId).sort();
      expect(await waitingIds(nov.id)).toEqual([lastOfNov.id]);
      expect(await waitingIds(dec.id)).toEqual([sofiaDec1.id, dec15.id].sort());
      expect(await waitingIds(dec.id)).not.toContain(dec16.id);
    });

    it('SET-05 PUNCH value = splitCents(paidCents, initialCredits) by trainedAt; the unused credit is never paid', async () => {
      const fx = fixtures();
      const { attend, buy, coachA } = await world(fx);
      const sub = await buy((await fx.punchPlan(3, 10000)).id);
      const later = await attend('2025-12-10T10:00:00Z');
      const earlier = await attend('2025-12-05T10:00:00Z');
      const dec = await fx.report('2025-12-01', '2025-12-15');

      const { rows } = await fx.settlements.allocations(dec.id, {});
      expect(rows.map((r) => [r.attendanceId, r.valueCents])).toEqual([
        [earlier.id, 3334],
        [later.id, 3333],
      ]);
      expect(rows[0]).toMatchObject({
        subscriptionId: sub.id,
        subscriptionType: 'PUNCH',
        reason: 'PUNCH_CREDIT',
        fromEarlierPeriod: false,
        attendance: { traineeId: earlier.traineeId, trainerId: coachA.id },
      });
      expect((await report(fx, dec.id)).lines).toEqual([
        {
          trainerId: coachA.id,
          amountCents: 6667,
          attendanceCount: 2,
          punchCents: 6667,
          timeCents: 0,
          earlierPeriodsCents: 0,
          earlierPeriodsCount: 0,
          waitingCount: 0,
        },
      ]);
    });

    it('SET-06 a PUNCH training keeps its place in the pass across periods', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      await buy((await fx.punchPlan(3, 10000)).id);
      const first = await attend('2025-11-20T10:00:00Z');
      const second = await attend('2025-12-05T10:00:00Z');
      const nov = await fx.report('2025-11-16', '2025-11-30');
      const dec = await fx.report('2025-12-01', '2025-12-15');

      const value = async (id: string) =>
        (await fx.settlements.allocations(id, {})).rows.map((r) => [
          r.attendanceId,
          r.valueCents,
        ]);
      expect(await value(nov.id)).toEqual([[first.id, 3334]]);
      await fx.settlements.finalize(nov.id);
      expect(await value(dec.id)).toEqual([[second.id, 3333]]);
    });

    it('SET-04 unpaid trainings are not paid; they wait in their own report only', async () => {
      const fx = fixtures();
      const { attend, coachA } = await world(fx);
      const unpaid = await attend('2025-12-05T10:00:00Z');
      const dec1 = await fx.report('2025-12-01', '2025-12-15');
      const dec2 = await fx.report('2025-12-16', '2025-12-31');

      expect(await report(fx, dec1.id)).toMatchObject({
        lines: [
          expect.objectContaining({
            trainerId: coachA.id,
            amountCents: 0,
            attendanceCount: 0,
            waitingCount: 1,
          }),
        ],
        waiting: [
          expect.objectContaining({
            attendanceId: unpaid.id,
            trainerId: coachA.id,
            traineeId: unpaid.traineeId,
            reason: 'UNPAID',
            subscriptionType: null,
            availableFrom: null,
          }),
        ],
      });
      expect(await report(fx, dec2.id)).toMatchObject({
        lines: [],
        waiting: [],
      });
    });

    it('SET-07/SET-09 a TIME pass waits until it ends, then the next report pays all of it, carried over', async () => {
      const fx = fixtures();
      const { attend, buy, coachA, coachB } = await world(fx);
      const sub = await buy((await fx.timePlan(30, 9001)).id, {
        startsAt: '2025-12-01T00:00:00.000Z',
      }); // ends 2025-12-31T00:00Z, in Dec 16-31
      const a = await attend('2025-12-02T10:00:00Z');
      const b = await attend('2025-12-10T10:00:00Z', { trainerId: coachB.id });
      const c = await attend('2025-12-20T10:00:00Z');
      const dec1 = await fx.report('2025-12-01', '2025-12-15');
      const dec2 = await fx.report('2025-12-16', '2025-12-31');

      const first = await report(fx, dec1.id);
      expect(first.waiting.map((w) => [w.attendanceId, w.reason])).toEqual([
        [a.id, 'TIME_PASS_NOT_ENDED'],
        [b.id, 'TIME_PASS_NOT_ENDED'],
      ]);
      expect(first.waiting[0].availableFrom).toEqual(sub.endsAt);
      expect(await paidIds(fx, dec1.id)).toEqual([]);
      await fx.settlements.finalize(dec1.id);

      const { rows } = await fx.settlements.allocations(dec2.id, {});
      expect(
        rows.map((r) => [r.attendanceId, r.valueCents, r.fromEarlierPeriod]),
      ).toEqual([
        [a.id, 3001, true],
        [b.id, 3000, true],
        [c.id, 3000, false],
      ]);
      expect((await report(fx, dec2.id)).lines).toEqual([
        expect.objectContaining({
          trainerId: coachA.id,
          amountCents: 6001,
          attendanceCount: 2,
          timeCents: 6001,
          earlierPeriodsCents: 3001,
          earlierPeriodsCount: 1,
        }),
        expect.objectContaining({
          trainerId: coachB.id,
          amountCents: 3000,
          earlierPeriodsCents: 3000,
          earlierPeriodsCount: 1,
        }),
      ]);
      // The finalized first half still lists them as waiting until the second half is final.
      expect(
        (await report(fx, dec1.id)).waiting.map((w) => w.attendanceId),
      ).toEqual([a.id, b.id]);
      await fx.cashIn(9001);
      await fx.settlements.finalize(dec2.id);
      expect((await report(fx, dec1.id)).waiting).toEqual([]);
    });

    it('SET-15 unpaid trainings covered by a pass bought later are paid in the report of the purchase', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      const u1 = await attend('2025-12-03T10:00:00Z');
      const u2 = await attend('2025-12-05T10:00:00Z');
      const dec1 = await fx.report('2025-12-01', '2025-12-15');
      const dec2 = await fx.report('2025-12-16', '2025-12-31');
      await fx.settlements.finalize(dec1.id); // pays nothing: both unpaid

      // Bought on Dec 18; the purchase covers both unpaid trainings.
      await buy((await fx.punchPlan(4, 8000)).id, {
        boughtAt: '2025-12-18T09:00:00.000Z',
      });
      expect((await fx.att(u1.id)).paymentStatus).toBe(
        AttendancePaymentStatus.PAID,
      );

      const { rows } = await fx.settlements.allocations(dec2.id, {});
      expect(
        rows.map((r) => [r.attendanceId, r.valueCents, r.fromEarlierPeriod]),
      ).toEqual([
        [u1.id, 2000, true],
        [u2.id, 2000, true],
      ]);
    });

    it('SET-18 while the previous report is a draft, the next one leaves its trainings to it', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      await buy((await fx.punchPlan(4, 4000)).id);
      const paidEarly = await attend('2025-12-02T10:00:00Z');
      const unpaid = await attend('2025-12-03T10:00:00Z', {
        traineeId: (await fx.trainee('Bob')).id,
      });
      const dec1 = await fx.report('2025-12-01', '2025-12-15');
      const dec2 = await fx.report('2025-12-16', '2025-12-31');
      await fx.boughtAt(
        (await fx.buy(unpaid.traineeId, (await fx.punchPlan(1, 500)).id)).id,
        '2025-12-20T10:00:00.000Z',
      );

      expect(await paidIds(fx, dec1.id)).toEqual([paidEarly.id]);
      expect(await paidIds(fx, dec2.id)).toEqual([unpaid.id]);
    });

    it('SET-16 a pass bought after the period end (before finalizing) waits for the next report', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      const u = await attend('2025-12-05T10:00:00Z');
      const dec1 = await fx.report('2025-12-01', '2025-12-15');
      await buy((await fx.punchPlan(1, 1000)).id, {
        boughtAt: '2025-12-16T09:00:00.000Z',
      });

      expect((await report(fx, dec1.id)).waiting).toEqual([
        expect.objectContaining({
          attendanceId: u.id,
          reason: 'NEXT_REPORT',
          subscriptionType: 'PUNCH',
          availableFrom: new Date('2025-12-16T09:00:00.000Z'),
        }),
      ]);
      expect(await paidIds(fx, dec1.id)).toEqual([]);
    });

    it('SET-17 a draft is worked out live: trainings recorded or deleted after it was created count', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      await buy((await fx.punchPlan(4, 4000)).id);
      const kept = await attend('2025-12-02T10:00:00Z');
      const removed = await attend('2025-12-03T10:00:00Z');
      const dec1 = await fx.report('2025-12-01', '2025-12-15');

      await fx.attendance.remove(removed.id);
      const late = await attend('2025-12-15T18:00:00Z'); // recorded after the period

      expect(await paidIds(fx, dec1.id)).toEqual([kept.id, late.id]);
    });

    it('SET-10 a training is paid once: a second report for the same period pays nothing for it', async () => {
      const fx = fixtures();
      const { attend, buy } = await world(fx);
      await fx.cashIn(10000);
      await buy((await fx.punchPlan(3, 3000)).id);
      await attend('2025-12-01T10:00:00Z');
      await attend('2025-12-02T10:00:00Z');
      // Two old drafts of the same period.
      const s1 = await fx.report('2025-12-01', '2025-12-15');
      const s2 = await fx.report('2025-12-01', '2025-12-15');

      await fx.settlements.finalize(s1.id);
      const second = await fx.settlements.finalize(s2.id);

      expect(second.status).toBe('FINAL');
      expect(await fx.allocationsOf(s2.id)).toEqual([]);
      expect((await settlementOutTxs(fx)).map((t) => t.amountCents)).toEqual([
        -2000,
      ]);
      expect(await fx.balance()).toBe(10000 + 3000 - 2000);
    });
  });

  describe("SET-19 a TIME pass is paid by the report of the period it ends in (the owner's example)", () => {
    /**
     * $100 for 30 days, bought Jan 12 (ends Feb 11). Ten trainings within the pass: one on Jan 13,
     * six from Jan 15 to Jan 31, three from Feb 1 to Feb 11. Neither January report pays any of
     * them (the price per training isn't known yet); the Feb 1-15 report pays all ten, $10 each,
     * January's carried over, to whoever led each one.
     */
    async function timePassExample(fx: Fixtures) {
      const { attend, buy, coachA, coachB } = await world(fx);
      const sub = await buy((await fx.timePlan(30, 10000)).id, {
        startsAt: '2026-01-12T08:00:00.000Z', // 10:00 Sofia
      });
      expect(sub.endsAt).toEqual(new Date('2026-02-11T08:00:00.000Z'));
      const led = (day: string, coach: { id: string }) =>
        attend(`${day}T16:00:00.000Z`, { trainerId: coach.id }); // 18:00 Sofia
      const firstHalf = [
        await led('2026-01-13', coachA),
        await led('2026-01-15', coachA),
      ];
      const secondHalf = [
        await led('2026-01-17', coachB),
        await led('2026-01-20', coachA),
        await led('2026-01-23', coachA),
        await led('2026-01-27', coachB),
        await led('2026-01-31', coachA),
      ];
      const february = [
        await led('2026-02-02', coachA),
        await led('2026-02-06', coachB),
        await led('2026-02-10', coachA),
      ];
      const reports = {
        jan1: await fx.report('2026-01-01', '2026-01-15'),
        jan2: await fx.report('2026-01-16', '2026-01-31'),
        feb1: await fx.report('2026-02-01', '2026-02-15'),
      };
      return { sub, coachA, coachB, firstHalf, secondHalf, february, reports };
    }

    it('neither January report pays them: each lists its own as waiting for the pass to end on Feb 11', async () => {
      const fx = fixtures();
      const { sub, firstHalf, secondHalf, reports } = await timePassExample(fx);

      for (const [report, own] of [
        [reports.jan1, firstHalf],
        [reports.jan2, secondHalf],
      ] as const) {
        const { lines, waiting } = await fx.settlements.getById(report.id);
        expect(await paidIds(fx, report.id)).toEqual([]);
        expect(lines.every((l) => l.amountCents === 0)).toBe(true);
        expect(waiting.map((w) => [w.attendanceId, w.reason])).toEqual(
          own.map((a) => [a.id, 'TIME_PASS_NOT_ENDED']),
        );
        expect(
          waiting.every(
            (w) => w.availableFrom?.getTime() === sub.endsAt!.getTime(),
          ),
        ).toBe(true);
      }
    });

    it('the Feb 1-15 report pays all ten at $10 each, January carried over, even while January is still a draft', async () => {
      const fx = fixtures();
      const { coachA, coachB, firstHalf, secondHalf, february, reports } =
        await timePassExample(fx);
      const january = [...firstHalf, ...secondHalf];

      const { rows } = await fx.settlements.allocations(reports.feb1.id, {});
      expect(
        rows.map((r) => [r.attendanceId, r.valueCents, r.fromEarlierPeriod]),
      ).toEqual([
        ...january.map((a) => [a.id, 1000, true]),
        ...february.map((a) => [a.id, 1000, false]),
      ]);
      expect((await fx.settlements.getById(reports.feb1.id)).lines).toEqual([
        expect.objectContaining({
          trainerId: coachA.id,
          amountCents: 7000,
          attendanceCount: 7,
          timeCents: 7000,
          earlierPeriodsCents: 5000,
          earlierPeriodsCount: 5,
        }),
        expect.objectContaining({
          trainerId: coachB.id,
          amountCents: 3000,
          attendanceCount: 3,
          earlierPeriodsCents: 2000,
          earlierPeriodsCount: 2,
        }),
      ]);
    });

    it('finalizing in order pays $0, $0, then $100, and each training is settled once', async () => {
      const fx = fixtures();
      const { firstHalf, secondHalf, february, reports } =
        await timePassExample(fx);

      await fx.settlements.finalize(reports.jan1.id);
      await fx.settlements.finalize(reports.jan2.id);
      await fx.settlements.finalize(reports.feb1.id);

      expect(
        (await settlementOutTxs(fx)).map((t) => [t.sourceId, t.amountCents]),
      ).toEqual([[reports.feb1.id, -10000]]);
      const paidInFeb = (await fx.allocationsOf(reports.feb1.id))
        .map((a) => a.attendanceId)
        .sort();
      expect(paidInFeb).toEqual(
        [...firstHalf, ...secondHalf, ...february].map((a) => a.id).sort(),
      );
      expect(await fx.allocationsOf(reports.jan1.id)).toEqual([]);
      expect(await fx.allocationsOf(reports.jan2.id)).toEqual([]);
      // Nothing of January waits any more: the February report paid it.
      expect((await fx.settlements.getById(reports.jan1.id)).waiting).toEqual(
        [],
      );
      expect((await fx.settlements.getById(reports.jan2.id)).waiting).toEqual(
        [],
      );
    });
  });

  describe('SET-20 a calendar-month TIME pass', () => {
    it('Apr 16 -> May 16 ends at midnight Sofia, so the May 1-15 report pays it and May 16 is not covered', async () => {
      const fx = fixtures();
      const { attend, buy, coachA, coachB } = await world(fx);
      const sub = await buy((await fx.monthPlan(1, 9000)).id, {
        startsAt: '2026-04-16',
      });
      expect(sub.endsAt).toEqual(new Date('2026-05-15T21:00:00.000Z')); // May 16 00:00 Sofia
      const covered = [
        await attend('2026-04-16T15:00:00Z'), // 18:00 Sofia
        await attend('2026-04-30T15:00:00Z', { trainerId: coachB.id }),
        await attend('2026-05-15T20:30:00Z'), // 23:30 Sofia, its last evening
      ];
      const after = await attend('2026-05-15T21:30:00Z'); // 00:30 Sofia on May 16
      expect(after.paymentStatus).toBe(AttendancePaymentStatus.UNPAID);
      const apr2 = await fx.report('2026-04-16', '2026-04-30');
      const may1 = await fx.report('2026-05-01', '2026-05-15');
      const may2 = await fx.report('2026-05-16', '2026-05-31');

      expect(await paidIds(fx, apr2.id)).toEqual([]);
      expect(
        (await report(fx, apr2.id)).waiting.map((w) => [
          w.attendanceId,
          w.reason,
        ]),
      ).toEqual(covered.slice(0, 2).map((a) => [a.id, 'TIME_PASS_NOT_ENDED']));

      const { rows } = await fx.settlements.allocations(may1.id, {});
      expect(
        rows.map((r) => [r.attendanceId, r.valueCents, r.fromEarlierPeriod]),
      ).toEqual([
        [covered[0].id, 3000, true],
        [covered[1].id, 3000, true],
        [covered[2].id, 3000, false],
      ]);
      expect((await report(fx, may1.id)).lines).toEqual([
        expect.objectContaining({ trainerId: coachA.id, amountCents: 6000 }),
        expect.objectContaining({ trainerId: coachB.id, amountCents: 3000 }),
      ]);
      expect(await paidIds(fx, may2.id)).toEqual([]);
      expect(
        (await report(fx, may2.id)).waiting.map((w) => [
          w.attendanceId,
          w.reason,
        ]),
      ).toEqual([[after.id, 'UNPAID']]);
    });
  });

  describe('finalize', () => {
    async function twoPunchTrainings(fx: Fixtures) {
      const w = await world(fx);
      await w.buy((await fx.punchPlan(3, 10000)).id);
      const a1 = await w.attend('2025-12-01T10:00:00Z');
      const a2 = await w.attend('2025-12-02T10:00:00Z', {
        trainerId: w.coachB.id,
      });
      const unpaid = await w.attend('2025-12-03T10:00:00Z', {
        traineeId: (await fx.trainee('Bob')).id,
      });
      const dec = await fx.report('2025-12-01', '2025-12-15');
      return { ...w, a1, a2, unpaid, dec };
    }

    it('SET-20 stores what it pays, books one SETTLEMENT_OUT and becomes FINAL', async () => {
      const fx = fixtures();
      const { dec, a1, a2, coachA, coachB } = await twoPunchTrainings(fx);
      freezeTime('2026-01-05T10:00:00.000Z');

      const finalized = await fx.settlements.finalize(dec.id);

      expect(finalized).toMatchObject({
        status: 'FINAL',
        finalizedAt: new Date('2026-01-05T10:00:00.000Z'),
      });
      const allocs = await fx.allocationsOf(dec.id);
      expect(
        allocs
          .map((a) => [a.attendanceId, a.trainerId, a.valueCents])
          .sort((x, y) => (x[2] as number) - (y[2] as number)),
      ).toEqual([
        [a2.id, coachB.id, 3333],
        [a1.id, coachA.id, 3334],
      ]);
      const lines = await fx.linesOf(dec.id);
      expect(lines.find((l) => l.trainerId === coachA.id)).toMatchObject({
        amountCents: 3334,
        attendanceCount: 1,
        unpaidAttendanceCount: 1,
        details: {
          punchCents: 3334,
          timeCents: 0,
          earlierPeriodsCents: 0,
          earlierPeriodsCount: 0,
        },
      });
      const outs = await settlementOutTxs(fx);
      expect(outs).toHaveLength(1);
      expect(outs[0]).toMatchObject({
        sourceType: 'SETTLEMENT',
        sourceId: dec.id,
        amountCents: -6667,
      });
      expect(await fx.balance()).toBe(3333);
    });

    it('SET-25 pays what the draft pays at finalize time, not what it paid when created', async () => {
      const fx = fixtures();
      const { dec, a1 } = await twoPunchTrainings(fx);

      await fx.attendance.remove(a1.id);
      await fx.settlements.finalize(dec.id);

      // Only a2 is paid: now the pass's first training, so it takes the extra cent.
      expect((await settlementOutTxs(fx)).map((t) => t.amountCents)).toEqual([
        -3334,
      ]);
    });

    it('SET-26 a finalized report shows what it paid; trainings of its period still waiting are listed', async () => {
      const fx = fixtures();
      const { dec, unpaid, coachA, coachB } = await twoPunchTrainings(fx);
      await fx.settlements.finalize(dec.id);

      const after = await report(fx, dec.id);

      expect(after.settlement.status).toBe('FINAL');
      expect(
        after.lines.map((l) => [l.trainerId, l.amountCents, l.waitingCount]),
      ).toEqual([
        [coachA.id, 3334, 1],
        [coachB.id, 3333, 0],
      ]);
      expect(after.waiting.map((w) => [w.attendanceId, w.reason])).toEqual([
        [unpaid.id, 'UNPAID'],
      ]);
      expect((await fx.settlements.allocations(dec.id, {})).total).toBe(2);
    });

    it('SET-27 replaces the rows an old manual draft stored when it was generated', async () => {
      const fx = fixtures();
      const { dec, a1, coachA } = await twoPunchTrainings(fx);
      await fx.ds.query(
        `INSERT INTO "settlement_allocations" ("settlementId", "attendanceId", "trainerId", "valueCents", "reason")
         VALUES ($1, $2, $3, 99999, 'PUNCH_CREDIT')`,
        [dec.id, a1.id, coachA.id],
      );
      await fx.ds.query(
        `INSERT INTO "settlement_lines" ("settlementId", "trainerId", "amountCents", "attendanceCount", "unpaidAttendanceCount")
         VALUES ($1, $2, 99999, 1, 0)`,
        [dec.id, coachA.id],
      );

      await fx.settlements.finalize(dec.id);

      expect(
        (await fx.allocationsOf(dec.id)).map((a) => a.valueCents).sort(),
      ).toEqual([3333, 3334]);
      expect(
        (await fx.linesOf(dec.id)).find((l) => l.trainerId === coachA.id)
          ?.amountCents,
      ).toBe(3334);
      expect(await fx.balance()).toBe(3333);
    });

    it('SET-28 refuses (409) while an older report is a draft, and leaves both drafts', async () => {
      const fx = fixtures();
      await fx.report('2025-12-01', '2025-12-15');
      const newer = await fx.report('2025-12-16', '2025-12-31');

      const err = await rejectionOf(fx.settlements.finalize(newer.id));

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'Finalize the report for 2025-12-01 to 2025-12-15 first',
      );
      expect(
        (await fx.settlementRows()).every(
          (s) => s.status === SettlementStatus.DRAFT,
        ),
      ).toBe(true);
    });

    it('SET-29 refuses (409) before the period is over (Sofia midnight)', async () => {
      const fx = fixtures();
      const s = await fx.report('2026-11-16', '2026-11-30');
      freezeTime('2026-11-30T21:59:59.000Z'); // 23:59:59 Sofia

      const err = await rejectionOf(fx.settlements.finalize(s.id));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(
        'The period ends on 2026-11-30; the report can be finalized after that',
      );

      freezeTime('2026-11-30T22:00:00.000Z');
      expect((await fx.settlements.finalize(s.id)).status).toBe('FINAL');
    });

    it('SET-21 insufficient balance: 400, stays DRAFT, nothing stored, balance unchanged', async () => {
      const fx = fixtures();
      const { dec } = await twoPunchTrainings(fx);
      await fx.cashOut(5000); // balance 5000 < 6667

      const err = await rejectionOf(fx.settlements.finalize(dec.id));

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Cash register balance cannot be negative');
      expect((await report(fx, dec.id)).settlement.status).toBe('DRAFT');
      expect(await fx.allocationsOf(dec.id)).toEqual([]);
      expect(await settlementOutTxs(fx)).toHaveLength(0);
      expect(await fx.balance()).toBe(5000);
    });

    it('SET-22 a report paying nothing becomes FINAL with no cash movement', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      await attend('2025-12-05T10:00:00Z'); // unpaid
      const dec = await fx.report('2025-12-01', '2025-12-15');

      expect((await fx.settlements.finalize(dec.id)).status).toBe('FINAL');
      expect(await fx.cashTxs()).toHaveLength(0);
    });

    it('SET-23 finalizing a FINAL report is a no-op', async () => {
      const fx = fixtures();
      const { dec } = await twoPunchTrainings(fx);
      await fx.settlements.finalize(dec.id);
      const txCount = (await fx.cashTxs()).length;

      const again = await fx.settlements.finalize(dec.id);

      expect(again).toMatchObject({ id: dec.id, status: 'FINAL' });
      expect(await fx.cashTxs()).toHaveLength(txCount);
    });

    it('SET-24 unknown id -> 404 Settlement not found', async () => {
      const fx = fixtures();
      const err = await rejectionOf(fx.settlements.finalize(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Settlement not found');
    });
  });

  describe('attendance in a finalized period', () => {
    async function finalizedDecember(fx: Fixtures) {
      const w = await world(fx);
      const settled = await w.attend('2025-12-15T21:00:00Z'); // 23:00 Sofia, Dec 15
      const dec = await fx.report('2025-12-01', '2025-12-15');
      await fx.settlements.finalize(dec.id);
      return { ...w, settled };
    }
    const message =
      "Attendance on or before 2025-12-15 is in a finalized settlement report and can't be changed";

    it('SET-50 recording a training dated in it is refused (409), single and batch, preview included', async () => {
      const fx = fixtures();
      const { trainee, coachA, loc } = await finalizedDecember(fx);
      const body = {
        trainerId: coachA.id,
        locationId: loc.id,
        trainedAt: '2025-12-15T21:59:00.000Z',
      };

      for (const attempt of [
        fx.attendance.create({ ...body, traineeId: trainee.id }),
        fx.attendance.createBatch({ ...body, traineeIds: [trainee.id] }),
        fx.attendance.previewBatch({ ...body, traineeIds: [trainee.id] }),
      ]) {
        const err = await rejectionOf(attempt);
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.message).toBe(message);
      }
      expect(await fx.attendanceRows()).toHaveLength(1);
    });

    it('SET-51 deleting one is refused (409); after the period both work', async () => {
      const fx = fixtures();
      const { settled, attend } = await finalizedDecember(fx);

      const err = await rejectionOf(fx.attendance.remove(settled.id));
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(message);

      const next = await attend('2025-12-15T22:00:00.000Z'); // Dec 16 00:00 Sofia
      expect(await fx.attendance.remove(next.id)).toEqual({ deleted: true });
      expect((await fx.attendanceRows()).map((a) => a.id)).toEqual([
        settled.id,
      ]);
    });

    it('SET-52 a pass bought later still pays the unpaid trainings of a finalized period', async () => {
      const fx = fixtures();
      const { settled, buy } = await finalizedDecember(fx);

      await buy((await fx.punchPlan(1, 1000)).id, {
        boughtAt: '2025-12-20T10:00:00.000Z',
      });
      const dec2 = await fx.report('2025-12-16', '2025-12-31');

      expect(await paidIds(fx, dec2.id)).toEqual([settled.id]);
    });
  });

  describe('read', () => {
    it('SET-32 list() is ordered by period, latest first', async () => {
      const fx = fixtures();
      const b = await fx.report('2025-12-16', '2025-12-31');
      const a = await fx.report('2025-12-01', '2025-12-15');
      const c = await fx.report('2026-01-01', '2026-01-15');

      expect((await fx.settlements.list()).map((s) => s.id)).toEqual([
        c.id,
        b.id,
        a.id,
      ]);
    });

    it('SET-33 getById optionally limits lines and waiting to one trainer; unknown -> 404', async () => {
      const fx = fixtures();
      const { coachA, coachB, attend } = await world(fx);
      await attend('2025-12-01T10:00:00Z', { trainerId: coachA.id });
      await attend('2025-12-02T10:00:00Z', { trainerId: coachB.id });
      const dec = await fx.report('2025-12-01', '2025-12-15');

      const all = await fx.settlements.getById(dec.id);
      const onlyB = await fx.settlements.getById(dec.id, coachB.id);

      expect(all.lines.map((l) => l.trainerId).sort()).toEqual(
        [coachA.id, coachB.id].sort(),
      );
      expect(onlyB.lines.map((l) => l.trainerId)).toEqual([coachB.id]);
      expect(onlyB.waiting.map((w) => w.trainerId)).toEqual([coachB.id]);

      const err = await rejectionOf(fx.settlements.getById(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Settlement not found');
    });

    it('SET-34 allocations: defaults, trainedAt/id ordering, paging total, trainer filter, unknown id -> 404', async () => {
      const fx = fixtures();
      const { coachB, attend, buy } = await world(fx);
      const other = await fx.trainee('Other');
      await buy((await fx.punchPlan(5, 5000)).id);
      await buy((await fx.punchPlan(5, 5000)).id, { traineeId: other.id });
      const d3 = await attend('2025-12-03T10:00:00Z', { trainerId: coachB.id });
      const d1 = await attend('2025-12-01T10:00:00Z');
      const d2a = await attend('2025-12-02T10:00:00Z');
      const d2b = await attend('2025-12-02T10:00:00Z', {
        traineeId: other.id,
        trainerId: coachB.id,
      });
      const dec = await fx.report('2025-12-01', '2025-12-15');
      const ordered = [d1.id, ...[d2a.id, d2b.id].sort(), d3.id];

      const all = await fx.settlements.allocations(dec.id, {});
      expect(all).toMatchObject({ total: 4, limit: 50, offset: 0 });
      expect(all.rows.map((r) => r.attendanceId)).toEqual(ordered);

      const page = await fx.settlements.allocations(dec.id, {
        limit: 2,
        offset: 1,
      });
      expect(page).toMatchObject({ total: 4, limit: 2, offset: 1 });
      expect(page.rows.map((r) => r.attendanceId)).toEqual(ordered.slice(1, 3));

      const onlyB = await fx.settlements.allocations(dec.id, {
        trainerId: coachB.id,
      });
      expect(onlyB.rows.map((r) => r.attendanceId)).toEqual([d2b.id, d3.id]);

      const err = await rejectionOf(
        fx.settlements.allocations(randomUUID(), {}),
      );
      expect(err).toBeInstanceOf(NotFoundException);
    });
  });
});
