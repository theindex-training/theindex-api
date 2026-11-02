import { freezeTime } from '../../test/int/clock';
import { Fixtures } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { AttendanceEntity } from './attendance.entity';
import { AttendanceSessionsQueryDto } from './dto/attendance-sessions.query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const { PAID, UNPAID } = AttendancePaymentStatus;

describe('AttendanceService read path (integration)', () => {
  const fixtures = setupIntegrationSuite();

  /** Two trainees, one trainer, one location. */
  async function world(fx: Fixtures) {
    const [ana, bob, coach, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainee('Bob'),
      fx.trainer('Coach'),
      fx.location('Main'),
    ]);
    const attend = (
      trainedAt: string,
      traineeId = ana.id,
      trainerId = coach.id,
      locationId = loc.id,
    ) =>
      fx
        .attend(traineeId, trainerId, locationId, trainedAt)
        .then((r) => r.attendance);
    return { ana, bob, coach, loc, attend };
  }

  function trainingTime(fx: Fixtures, startTime: string, endTime: string) {
    return fx.ds.getRepository(TrainingTimeEntity).save({ startTime, endTime });
  }

  function sessions(fx: Fixtures, query: AttendanceSessionsQueryDto) {
    return fx.attendance.sessions(query);
  }

  /** attendanceId -> price info, flattened over all sessions. */
  async function prices(fx: Fixtures, query: AttendanceSessionsQueryDto) {
    const res = await sessions(fx, query);
    return new Map(
      res.sessions.flatMap((s) =>
        s.attendance.map((a) => [a.id, a.price] as const),
      ),
    );
  }

  describe('dates', () => {
    it('ATR-02 per-day counts, ASC order, empty days omitted, from/to echoed', async () => {
      const fx = fixtures();
      const { ana, coach, loc } = await world(fx);
      const row = (trainedAt: string, paymentStatus: AttendancePaymentStatus) =>
        fx.insertAttendance({
          traineeId: ana.id,
          trainerId: coach.id,
          locationId: loc.id,
          trainedAt: new Date(trainedAt),
          paymentStatus,
        });
      await row('2025-12-05T10:00:00Z', PAID);
      await row('2025-12-03T10:00:00Z', UNPAID);
      await row('2025-12-03T11:00:00Z', PAID);
      await row('2025-12-03T12:00:00Z', UNPAID);
      await row('2025-12-01T10:00:00Z', UNPAID);

      const res = await fx.attendance.dates({
        from: '2025-12-01',
        to: '2025-12-31',
      });

      expect(res.from).toBe('2025-12-01');
      expect(res.to).toBe('2025-12-31');
      expect(res.days).toEqual([
        {
          date: '2025-12-01',
          count: 1,
          unpaidCount: 1,
          paidCount: 0,
          hasUnpaid: true,
        },
        {
          date: '2025-12-03',
          count: 3,
          unpaidCount: 2,
          paidCount: 1,
          hasUnpaid: true,
        },
        {
          date: '2025-12-05',
          count: 1,
          unpaidCount: 0,
          paidCount: 1,
          hasUnpaid: false,
        },
      ]);
    });

    it('ATR-02 trainerId and traineeId filters', async () => {
      const fx = fixtures();
      const { ana, bob, coach, loc, attend } = await world(fx);
      const other = await fx.trainer('Other');
      await attend('2025-12-01T10:00:00Z', ana.id, coach.id, loc.id);
      await attend('2025-12-01T11:00:00Z', bob.id, coach.id, loc.id);
      await attend('2025-12-02T10:00:00Z', ana.id, other.id, loc.id);

      const byTrainer = await fx.attendance.dates({
        from: '2025-12-01',
        to: '2025-12-31',
        trainerId: other.id,
      });
      expect(byTrainer.days.map((d) => [d.date, d.count])).toEqual([
        ['2025-12-02', 1],
      ]);

      const byTrainee = await fx.attendance.dates({
        from: '2025-12-01',
        to: '2025-12-31',
        traineeId: ana.id,
      });
      expect(byTrainee.days.map((d) => [d.date, d.count])).toEqual([
        ['2025-12-01', 1],
        ['2025-12-02', 1],
      ]);

      const both = await fx.attendance.dates({
        from: '2025-12-01',
        to: '2025-12-31',
        trainerId: coach.id,
        traineeId: bob.id,
      });
      expect(both.days.map((d) => [d.date, d.count])).toEqual([
        ['2025-12-01', 1],
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATR-01 grouped by Sofia date but filtered by a server-TZ (UTC) range', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      // 2026-01-01 01:30 Sofia: inside a to=2025-12-31 UTC range, labelled Jan 1.
      await attend('2025-12-31T23:30:00.000Z');
      // 2025-12-01 01:00 Sofia: outside a from=2025-12-01 UTC range.
      await attend('2025-11-30T23:00:00.000Z');
      // Last instant included by the UTC range.
      await attend('2025-12-31T23:59:59.999Z');
      // First instant excluded by the UTC range (Jan 1 02:00 Sofia).
      await attend('2026-01-01T00:00:00.000Z');

      const res = await fx.attendance.dates({
        from: '2025-12-01',
        to: '2025-12-31',
      });

      expect(res.days).toEqual([
        {
          date: '2026-01-01',
          count: 2,
          unpaidCount: 2,
          paidCount: 0,
          hasUnpaid: true,
        },
      ]);

      const nov = await fx.attendance.dates({
        from: '2025-11-30',
        to: '2025-11-30',
      });
      expect(nov.days.map((d) => [d.date, d.count])).toEqual([
        ['2025-12-01', 1],
      ]);
    });
  });

  describe('sessions', () => {
    it('ATR-10 slot sessions use [start, end); outside a slot -> custom HH:mm session of 60 min', async () => {
      const fx = fixtures();
      const { coach, loc, attend } = await world(fx);
      const slot = await trainingTime(fx, '18:00', '19:00');

      const a1 = await attend('2025-12-10T18:00:00.000Z');
      const a2 = await attend('2025-12-10T18:59:00.000Z');
      const a3 = await attend('2025-12-10T19:00:00.000Z');
      const a4 = await attend('2025-12-10T20:15:30.000Z');

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-10',
      });

      const tail = `${coach.id}|${loc.id}`;
      expect(
        res.sessions.map((s) => ({
          sessionKey: s.sessionKey,
          date: s.date,
          start: s.start,
          end: s.end,
          trainingTimeId: s.trainingTimeId,
          trainerId: s.trainerId,
          locationId: s.locationId,
          ids: s.attendance.map((a) => a.id),
        })),
      ).toEqual([
        {
          sessionKey: `2025-12-10|slot:${slot.id}|${tail}`,
          date: '2025-12-10',
          start: '2025-12-10T18:00:00.000Z',
          end: '2025-12-10T19:00:00.000Z',
          trainingTimeId: slot.id,
          trainerId: coach.id,
          locationId: loc.id,
          ids: [a1.id, a2.id],
        },
        {
          sessionKey: `2025-12-10|custom:19:00|${tail}`,
          date: '2025-12-10',
          start: '2025-12-10T19:00:00.000Z',
          end: '2025-12-10T20:00:00.000Z',
          trainingTimeId: null,
          trainerId: coach.id,
          locationId: loc.id,
          ids: [a3.id],
        },
        {
          sessionKey: `2025-12-10|custom:20:15|${tail}`,
          date: '2025-12-10',
          start: '2025-12-10T20:15:00.000Z',
          end: '2025-12-10T21:15:00.000Z',
          trainingTimeId: null,
          trainerId: coach.id,
          locationId: loc.id,
          ids: [a4.id],
        },
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATR-10 day, hour and slot matching use server-local time (UTC), not Sofia', async () => {
      const fx = fixtures();
      const { coach, loc, attend } = await world(fx);
      await trainingTime(fx, '18:00', '19:00');
      // 18:30 Sofia = 16:30 UTC: not in the 18:00-19:00 slot.
      const evening = await attend('2025-12-10T16:30:00.000Z');
      // 2025-12-11 00:30 Sofia = 2025-12-10 22:30 UTC: listed under Dec 10.
      const lateNight = await attend('2025-12-10T22:30:00.000Z');

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-10',
      });

      const tail = `${coach.id}|${loc.id}`;
      expect(
        res.sessions.map((s) => [s.sessionKey, s.attendance[0].id]),
      ).toEqual([
        [`2025-12-10|custom:16:30|${tail}`, evening.id],
        [`2025-12-10|custom:22:30|${tail}`, lateNight.id],
      ]);
    });

    it('ATR-11 separate sessions per trainer and location; overlapping slots -> first by startTime', async () => {
      const fx = fixtures();
      const { ana, bob, coach, loc, attend } = await world(fx);
      const other = await fx.trainer('Other');
      const loc2 = await fx.location('Second');
      // Inserted in reverse so the winner isn't just the first row stored.
      await trainingTime(fx, '18:30', '19:30');
      const early = await trainingTime(fx, '18:00', '20:00');

      await attend('2025-12-10T18:45:00.000Z', ana.id, coach.id, loc.id);
      await attend('2025-12-10T18:46:00.000Z', bob.id, coach.id, loc.id);
      await attend('2025-12-10T18:45:00.000Z', bob.id, other.id, loc.id);
      await attend('2025-12-10T18:50:00.000Z', ana.id, coach.id, loc2.id);

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-10',
      });

      expect(
        res.sessions.map((s) => [
          s.trainingTimeId,
          s.trainerId,
          s.locationId,
          s.attendance.length,
        ]),
      ).toEqual([
        [early.id, coach.id, loc.id, 2],
        [early.id, other.id, loc.id, 1],
        [early.id, coach.id, loc2.id, 1],
      ]);
      expect(res.sessions[0].start).toBe('2025-12-10T18:00:00.000Z');
      expect(res.sessions[0].end).toBe('2025-12-10T20:00:00.000Z');
    });

    it('ATR-11 totals, de-duplicated entities and default filters', async () => {
      const fx = fixtures();
      const { ana, bob, coach, loc, attend } = await world(fx);
      const gs = await fx.gymSubscription('MultiSport');
      await fx.ds
        .getRepository(TraineeProfileEntity)
        .update({ id: ana.id }, { gymSubscriptionId: gs.id, nickname: 'Ani' });
      const plan = await fx.punchPlan(5, 5000);
      await fx.buy(ana.id, plan.id);

      const a1 = await attend('2025-12-10T10:00:00.000Z', ana.id); // PAID
      const a2 = await attend('2025-12-10T10:00:00.000Z', bob.id); // UNPAID
      await attend('2025-12-11T10:00:00.000Z', ana.id); // PAID, other day

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-11',
      });

      expect(res.filters).toEqual({
        startDate: '2025-12-10',
        endDate: '2025-12-11',
        startTime: '00:00',
        endTime: '23:59',
        trainerId: null,
      });
      expect(res.sessions.map((s) => [s.date, s.totals])).toEqual([
        ['2025-12-10', { count: 2, paid: 1, unpaid: 1 }],
        ['2025-12-11', { count: 1, paid: 1, unpaid: 0 }],
      ]);
      expect(res.sessions[0].attendance).toEqual([
        expect.objectContaining({
          id: a1.id,
          trainedAt: '2025-12-10T10:00:00.000Z',
          paymentStatus: PAID,
          traineeId: ana.id,
          subscriptionId: a1.subscriptionId,
          gymSubscriptionId: gs.id,
        }),
        expect.objectContaining({
          id: a2.id,
          paymentStatus: UNPAID,
          traineeId: bob.id,
          subscriptionId: null,
          gymSubscriptionId: null,
        }),
      ]);
      expect(res.entities.trainees).toEqual([
        { id: ana.id, name: 'Ana', nickname: 'Ani' },
        { id: bob.id, name: 'Bob', nickname: null },
      ]);
      expect(res.entities.trainers).toEqual([
        { id: coach.id, name: 'Coach', nickname: null },
      ]);
      expect(res.entities.locations).toEqual([{ id: loc.id, name: 'Main' }]);
      expect(res.entities.gymSubscriptions).toEqual([
        { id: gs.id, name: 'MultiSport' },
      ]);
    });

    it('ATR-11 trainerId filter and echoed custom filters', async () => {
      const fx = fixtures();
      const { coach, attend, ana } = await world(fx);
      const other = await fx.trainer('Other');
      await attend('2025-12-10T10:00:00.000Z', ana.id, coach.id);
      const mine = await attend('2025-12-10T11:00:00.000Z', ana.id, other.id);

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-10',
        startTime: '08:00',
        endTime: '22:00',
        trainerId: other.id,
      });

      expect(res.filters).toEqual({
        startDate: '2025-12-10',
        endDate: '2025-12-10',
        startTime: '08:00',
        endTime: '22:00',
        trainerId: other.id,
      });
      expect(
        res.sessions.flatMap((s) => s.attendance.map((a) => a.id)),
      ).toEqual([mine.id]);
      expect(res.entities.trainers).toEqual([
        { id: other.id, name: 'Other', nickname: null },
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATR-11 startTime/endTime bound one continuous range, not a daily time window', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      const before = await attend('2025-12-10T07:59:00.000Z');
      const firstDayEvening = await attend('2025-12-10T23:00:00.000Z');
      const secondDayMorning = await attend('2025-12-11T06:00:00.000Z');
      const endMinute = await attend('2025-12-11T09:00:59.999Z');
      const after = await attend('2025-12-11T09:01:00.000Z');

      const res = await sessions(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-11',
        startTime: '08:00',
        endTime: '09:00',
      });

      const ids = res.sessions.flatMap((s) => s.attendance.map((a) => a.id));
      expect(ids).toEqual([
        firstDayEvening.id,
        secondDayMorning.id,
        endMinute.id,
      ]);
      expect(ids).not.toContain(before.id);
      expect(ids).not.toContain(after.id);
    });
  });

  describe('session price info', () => {
    it('ATR-12 UNPAID -> 0 / UNPAID / null type / final', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);
      const a = await attend('2025-12-10T10:00:00.000Z');

      const p = await prices(fx, {
        startDate: '2025-12-10',
        endDate: '2025-12-10',
      });

      expect(p.get(a.id)).toEqual({
        priceCents: 0,
        calculation: 'UNPAID',
        subscriptionType: null,
        isFinal: true,
      });
    });

    it('ATR-12 PUNCH -> split of paidCents by initialCredits at the global index', async () => {
      const fx = fixtures();
      const { ana, attend } = await world(fx);
      const plan = await fx.punchPlan(3, 10000);
      await fx.buy(ana.id, plan.id);
      // The Nov attendance is outside the query but takes index 0 (3334).
      await attend('2025-11-10T10:00:00.000Z');
      const dec5 = await attend('2025-12-05T10:00:00.000Z');
      const dec6 = await attend('2025-12-06T10:00:00.000Z');

      const p = await prices(fx, {
        startDate: '2025-12-01',
        endDate: '2025-12-31',
      });

      expect(p.get(dec5.id)).toEqual({
        priceCents: 3333,
        calculation: 'PUNCH_CREDIT',
        subscriptionType: PlanType.PUNCH,
        isFinal: true,
      });
      expect(p.get(dec6.id)?.priceCents).toBe(3333);

      const nov = await prices(fx, {
        startDate: '2025-11-01',
        endDate: '2025-11-30',
      });
      expect([...nov.values()].map((v) => v.priceCents)).toEqual([3334]);
    });

    it('ATR-12 TIME -> split by the current number of PAID attendances; final once endsAt <= now', async () => {
      const fx = fixtures();
      const { ana, attend } = await world(fx);
      const plan = await fx.timePlan(30, 10000);
      const sub = await fx.buy(ana.id, plan.id, {
        startsAt: '2025-12-01T00:00:00.000Z',
      });
      freezeTime('2025-12-15T00:00:00.000Z');

      const a1 = await attend('2025-12-02T10:00:00.000Z');
      const a2 = await attend('2025-12-03T10:00:00.000Z');
      const q = { startDate: '2025-12-01', endDate: '2025-12-31' };

      let p = await prices(fx, q);
      expect(p.get(a1.id)).toEqual({
        priceCents: 5000,
        calculation: 'TIME_PRORATA',
        subscriptionType: PlanType.TIME,
        isFinal: false,
      });
      expect(p.get(a2.id)?.priceCents).toBe(5000);

      // A third attendance lowers everyone's value; extra cent goes to the first.
      const a3 = await attend('2025-12-04T10:00:00.000Z');
      p = await prices(fx, q);
      expect([a1, a2, a3].map((a) => p.get(a.id)?.priceCents)).toEqual([
        3334, 3333, 3333,
      ]);

      // Exactly at endsAt the value becomes final.
      freezeTime(sub.endsAt!);
      p = await prices(fx, q);
      expect(p.get(a1.id)).toEqual({
        priceCents: 3334,
        calculation: 'TIME_PRORATA',
        subscriptionType: PlanType.TIME,
        isFinal: true,
      });

      // Only a window containing a2 still uses all 3 PAID rows for the split.
      const only = await prices(fx, {
        startDate: '2025-12-03',
        endDate: '2025-12-03',
      });
      expect(only.get(a2.id)?.priceCents).toBe(3333);
    });

    it('ATR-12 PUNCH attendance beyond initialCredits -> UNALLOCATED, not final', async () => {
      const fx = fixtures();
      const { ana, coach, loc } = await world(fx);
      const plan = await fx.punchPlan(2, 1000);
      const sub = await fx.insertSubscription({
        traineeId: ana.id,
        planId: plan.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        paidCents: 1000,
        initialCredits: 2,
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });
      const rows: AttendanceEntity[] = [];
      for (const day of [10, 11, 12]) {
        rows.push(
          await fx.insertAttendance({
            traineeId: ana.id,
            trainerId: coach.id,
            locationId: loc.id,
            trainedAt: new Date(Date.UTC(2025, 11, day, 10)),
            paymentStatus: PAID,
            subscriptionId: sub.id,
          }),
        );
      }

      const p = await prices(fx, {
        startDate: '2025-12-01',
        endDate: '2025-12-31',
      });

      expect(rows.map((r) => p.get(r.id))).toEqual([
        {
          priceCents: 500,
          calculation: 'PUNCH_CREDIT',
          subscriptionType: PlanType.PUNCH,
          isFinal: true,
        },
        {
          priceCents: 500,
          calculation: 'PUNCH_CREDIT',
          subscriptionType: PlanType.PUNCH,
          isFinal: true,
        },
        {
          priceCents: 0,
          calculation: 'UNALLOCATED',
          subscriptionType: PlanType.PUNCH,
          isFinal: false,
        },
      ]);
    });

    it('ATR-13 session priceCents equals the settlement allocation for PUNCH and ended TIME', async () => {
      const fx = fixtures();
      const { ana, bob, attend } = await world(fx);
      const punch = await fx.punchPlan(3, 10000);
      const time = await fx.timePlan(10, 9001);
      await fx.buy(ana.id, punch.id);
      await fx.buy(bob.id, time.id, { startsAt: '2025-12-01T00:00:00.000Z' });

      const ids: string[] = [];
      for (const day of [2, 3, 4]) {
        ids.push((await attend(`2025-12-0${day}T10:00:00.000Z`, ana.id)).id);
        ids.push((await attend(`2025-12-0${day}T11:00:00.000Z`, bob.id)).id);
      }
      // Bob's TIME pass has ended (Dec 11), so its value is final.
      freezeTime('2025-12-20T00:00:00.000Z');

      const { settlement } = await fx.settlements.generate({
        periodStart: '2025-12-01',
        periodEnd: '2025-12-31',
      });
      const allocations = await fx.allocationValues(settlement.id);
      const p = await prices(fx, {
        startDate: '2025-12-01',
        endDate: '2025-12-31',
      });

      for (const id of ids) {
        expect({ id, cents: p.get(id)?.priceCents }).toEqual({
          id,
          cents: allocations.get(id),
        });
      }
      expect(ids.map((id) => p.get(id)?.priceCents)).toEqual([
        3334, 3001, 3333, 3000, 3333, 3000,
      ]);
    });
  });

  describe('reports', () => {
    const NOW = '2025-12-15T12:00:00.000Z';
    const daysBefore = (n: number, extraMs = 0) =>
      new Date(Date.parse(NOW) - n * DAY_MS + extraMs).toISOString();

    it('ATR-20 inactive trainees: never trained or last training strictly before now - N days', async () => {
      const fx = fixtures();
      const coach = await fx.trainer('Coach');
      const loc = await fx.location();
      const [atThreshold, justBefore, older, recent] = await Promise.all([
        fx.trainee('AtThreshold'),
        fx.trainee('JustBefore'),
        fx.trainee('Older', { nickname: 'Old' }),
        fx.trainee('Recent'),
        fx.trainee('Never'),
      ]);
      freezeTime(NOW);
      const at = (traineeId: string, trainedAt: string) =>
        fx.attend(traineeId, coach.id, loc.id, trainedAt);
      await at(atThreshold.id, daysBefore(7));
      await at(justBefore.id, daysBefore(7, -1));
      await at(older.id, daysBefore(30));
      await at(older.id, daysBefore(20)); // MAX(trainedAt) wins
      await at(recent.id, daysBefore(1));

      const res = await fx.attendance.listTraineesWithoutRecentTrainings({
        skipDays: 7,
      });

      expect(res).toEqual([
        {
          name: 'JustBefore',
          nickname: null,
          lastTrainingDate: daysBefore(7, -1),
          activeSubscription: null,
        },
        {
          name: 'Older',
          nickname: 'Old',
          lastTrainingDate: daysBefore(20),
          activeSubscription: null,
        },
        {
          name: 'Never',
          nickname: null,
          lastTrainingDate: null,
          activeSubscription: null,
        },
      ]);

      // skipDays 0: everyone who trained before now, plus never-trained.
      const all = await fx.attendance.listTraineesWithoutRecentTrainings({
        skipDays: 0,
      });
      expect(all.map((r) => r.name)).toEqual([
        'Recent',
        'AtThreshold',
        'JustBefore',
        'Older',
        'Never',
      ]);
    });

    it('ATR-20 activeSubscription = newest currently active sub, with PUNCH/TIME report shape', async () => {
      const fx = fixtures();
      const [punchT, timeT, mixedT] = await Promise.all([
        fx.trainee('Punch'),
        fx.trainee('Time'),
        fx.trainee('Mixed'),
      ]);
      const punch = await fx.punchPlan(10, 10000, { title: 'Ten' });
      const time = await fx.timePlan(30, 9000, { title: 'Month' });
      freezeTime(NOW);
      const base = (traineeId: string) => ({ traineeId });

      await fx.insertSubscription({
        ...base(punchT.id),
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 4,
      });
      // endsAt - now = 2.5 days -> remainingDays 3 (ceil).
      await fx.insertSubscription({
        ...base(timeT.id),
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-18T00:00:00Z'),
        endsAt: new Date('2025-12-18T00:00:00Z'),
      });
      // Mixed: older active PUNCH, newer active TIME, newest inactive ones.
      await fx.insertSubscription({
        ...base(mixedT.id),
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-11-01T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 1,
      });
      await fx.insertSubscription({
        ...base(mixedT.id),
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-20T00:00:00Z'),
        endsAt: new Date('2025-12-20T00:00:00Z'),
      });
      await fx.insertSubscription({
        ...base(mixedT.id),
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 0,
      });
      await fx.insertSubscription({
        ...base(mixedT.id),
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-15T12:00:00Z'),
        endsAt: new Date(NOW), // ended exactly now -> not active
      });
      await fx.insertSubscription({
        ...base(mixedT.id),
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-05T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 10,
        status: SubscriptionStatus.CANCELLED,
      });

      const res = await fx.attendance.listTraineesWithoutRecentTrainings({
        skipDays: 7,
      });
      const byName = new Map(res.map((r) => [r.name, r.activeSubscription]));

      expect(byName.get('Punch')).toEqual({
        planName: 'Ten',
        type: PlanType.PUNCH,
        startDate: '2025-12-01T00:00:00.000Z',
        endDate: null,
        remainingTrainings: 4,
        remainingDays: null,
      });
      expect(byName.get('Time')).toEqual({
        planName: 'Month',
        type: PlanType.TIME,
        startDate: '2025-11-18T00:00:00.000Z',
        endDate: '2025-12-18T00:00:00.000Z',
        remainingTrainings: null,
        remainingDays: 3,
      });
      expect(byName.get('Mixed')).toMatchObject({
        type: PlanType.TIME,
        startDate: '2025-11-20T00:00:00.000Z',
        remainingDays: 5,
      });
    });

    /**
     * Trainees whose only subscription sits exactly on the "active" boundary:
     * an ACTIVE TIME pass ending exactly now, and an ACTIVE PUNCH card with
     * 0 credits left (direct insert; the services would mark it EXHAUSTED).
     */
    async function boundaryTrainees(fx: Fixtures) {
      const [endsNow, zeroCredits] = await Promise.all([
        fx.trainee('EndsNow'),
        fx.trainee('ZeroCredits'),
      ]);
      const time = await fx.timePlan(30, 9000, { title: 'Month' });
      const punch = await fx.punchPlan(5, 5000, { title: 'Five' });
      freezeTime(NOW);
      await fx.insertSubscription({
        traineeId: endsNow.id,
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date(Date.parse(NOW) - 30 * DAY_MS),
        endsAt: new Date(NOW),
      });
      await fx.insertSubscription({
        traineeId: zeroCredits.id,
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 5,
        remainingCredits: 0,
      });
    }

    it('ATR-20 a TIME pass ending exactly now or an ACTIVE PUNCH with 0 credits is not active', async () => {
      const fx = fixtures();
      await boundaryTrainees(fx);

      const res = await fx.attendance.listTraineesWithoutRecentTrainings({
        skipDays: 7,
      });

      expect(res.map((r) => [r.name, r.activeSubscription])).toEqual([
        ['EndsNow', null],
        ['ZeroCredits', null],
      ]);
    });

    it('ATR-21 a TIME pass ending exactly now or an ACTIVE PUNCH with 0 credits is not active', async () => {
      const fx = fixtures();
      await boundaryTrainees(fx);

      const res = await fx.attendance.listTraineesWithoutActiveSubscription();

      expect(res).toEqual([
        {
          name: 'EndsNow',
          nickname: null,
          lastTrainingDate: null,
          lastActiveSubscription: {
            planName: 'Month',
            type: PlanType.TIME,
            startDate: new Date(Date.parse(NOW) - 30 * DAY_MS).toISOString(),
            endDate: NOW,
            remainingTrainings: null,
            remainingDays: 0,
          },
        },
        {
          name: 'ZeroCredits',
          nickname: null,
          lastTrainingDate: null,
          lastActiveSubscription: {
            planName: 'Five',
            type: PlanType.PUNCH,
            startDate: '2025-12-01T00:00:00.000Z',
            endDate: null,
            remainingTrainings: 0,
            remainingDays: null,
          },
        },
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATR-20 includes deactivated trainees and counts a not-yet-started TIME pass as active', async () => {
      const fx = fixtures();
      await fx.trainee('Gone', { isActive: false });
      const future = await fx.trainee('Future');
      const time = await fx.timePlan(30, 9000, { title: 'Month' });
      freezeTime(NOW);
      await fx.insertSubscription({
        traineeId: future.id,
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-01-31T00:00:00Z'),
      });

      const res = await fx.attendance.listTraineesWithoutRecentTrainings({
        skipDays: 7,
      });

      expect(res.map((r) => r.name)).toEqual(['Future', 'Gone']);
      expect(res[0].activeSubscription).toEqual({
        planName: 'Month',
        type: PlanType.TIME,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T00:00:00.000Z',
        remainingTrainings: null,
        remainingDays: 47,
      });
    });

    it('ATR-21 without active subscription: excludes trainees with an active sub, same sort', async () => {
      const fx = fixtures();
      const coach = await fx.trainer('Coach');
      const loc = await fx.location();
      const [covered, futureTime, exhausted, ended] = await Promise.all([
        fx.trainee('Covered'),
        fx.trainee('FutureTime'),
        fx.trainee('Exhausted'),
        fx.trainee('Ended'),
        fx.trainee('Never'),
      ]);
      const punch = await fx.punchPlan(1, 1000, { title: 'One' });
      const time = await fx.timePlan(30, 9000, { title: 'Month' });
      freezeTime(NOW);
      await fx.insertSubscription({
        traineeId: covered.id,
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 2,
        remainingCredits: 2,
      });
      // Not started yet, but counts as active (same rule as ATR-20).
      await fx.insertSubscription({
        traineeId: futureTime.id,
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-01-31T00:00:00Z'),
      });
      await fx.insertSubscription({
        traineeId: exhausted.id,
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-11-01T00:00:00Z'),
        initialCredits: 1,
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });
      // Still ACTIVE (cron not run) but ended: not active; remainingDays clamps to 0.
      await fx.insertSubscription({
        traineeId: ended.id,
        planId: time.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-01T00:00:00Z'),
        endsAt: new Date('2025-12-01T00:00:00Z'),
      });
      const at = (traineeId: string, trainedAt: string) =>
        fx.attend(traineeId, coach.id, loc.id, trainedAt);
      await at(exhausted.id, '2025-11-05T10:00:00.000Z');
      await at(ended.id, '2025-11-20T10:00:00.000Z');
      await at(covered.id, '2025-12-14T10:00:00.000Z');

      const res = await fx.attendance.listTraineesWithoutActiveSubscription();

      expect(res).toEqual([
        {
          name: 'Ended',
          nickname: null,
          lastTrainingDate: '2025-11-20T10:00:00.000Z',
          lastActiveSubscription: {
            planName: 'Month',
            type: PlanType.TIME,
            startDate: '2025-11-01T00:00:00.000Z',
            endDate: '2025-12-01T00:00:00.000Z',
            remainingTrainings: null,
            remainingDays: 0,
          },
        },
        {
          name: 'Exhausted',
          nickname: null,
          lastTrainingDate: '2025-11-05T10:00:00.000Z',
          lastActiveSubscription: {
            planName: 'One',
            type: PlanType.PUNCH,
            startDate: '2025-11-01T00:00:00.000Z',
            endDate: null,
            remainingTrainings: 0,
            remainingDays: null,
          },
        },
        {
          name: 'Never',
          nickname: null,
          lastTrainingDate: null,
          lastActiveSubscription: null,
        },
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATR-21 lastActiveSubscription is the newest sub of any status; deactivated trainees are listed', async () => {
      const fx = fixtures();
      const t = await fx.trainee('Ana');
      await fx.trainee('Gone', { isActive: false });
      const punch = await fx.punchPlan(5, 5000, { title: 'Five' });
      const other = await fx.punchPlan(3, 3000, { title: 'Three' });
      freezeTime(NOW);
      await fx.insertSubscription({
        traineeId: t.id,
        planId: punch.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-11-01T00:00:00Z'),
        initialCredits: 5,
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });
      // Never used, cancelled: still reported as the "last active" one.
      await fx.insertSubscription({
        traineeId: t.id,
        planId: other.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-11-20T00:00:00Z'),
        initialCredits: 3,
        remainingCredits: 3,
        status: SubscriptionStatus.CANCELLED,
      });

      const res = await fx.attendance.listTraineesWithoutActiveSubscription();

      expect(res.map((r) => r.name)).toEqual(['Ana', 'Gone']);
      expect(res[0].lastActiveSubscription).toMatchObject({
        planName: 'Three',
        startDate: '2025-11-20T00:00:00.000Z',
        remainingTrainings: 3,
      });
    });
  });
});
