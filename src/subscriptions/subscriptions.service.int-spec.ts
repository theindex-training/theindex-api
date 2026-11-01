import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PlanEntity } from '../plans/plan.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
const { PAID, UNPAID } = AttendancePaymentStatus;

describe('SubscriptionsService (integration)', () => {
  const fixtures = setupIntegrationSuite();

  /** Trainee + trainer + location, the minimum to record attendance. */
  async function world(fx: Fixtures) {
    const [trainee, trainer, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach'),
      fx.location(),
    ]);
    const attend = (trainedAt: string, traineeId = trainee.id) =>
      fx
        .attend(traineeId, trainer.id, loc.id, trainedAt)
        .then((r) => r.attendance);
    return { trainee, trainer, loc, attend };
  }

  describe('purchase', () => {
    it('SUB-01 PUNCH plan: credits copied, no end date, ACTIVE, paidCents defaults to plan price', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.punchPlan(10, 12000);

      const sub = await fx.buy(trainee.id, plan.id);

      const expected = {
        traineeId: trainee.id,
        planId: plan.id,
        type: PlanType.PUNCH,
        initialCredits: 10,
        remainingCredits: 10,
        endsAt: null,
        status: SubscriptionStatus.ACTIVE,
        paidCents: 12000,
      };
      expect(sub).toMatchObject(expected);
      expect(await fx.sub(sub.id)).toMatchObject(expected);
    });

    it('SUB-02 TIME plan: endsAt = startsAt + durationDays x 24h (fixed-length days), no credits', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.timePlan(30, 9000);

      // Crosses the Europe/Sofia DST change on 2025-03-30: still exactly 30 x 24h.
      const sub = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-03-15T10:00:00.000Z',
      });

      expect(sub.type).toBe(PlanType.TIME);
      expect(sub.startsAt.toISOString()).toBe('2025-03-15T10:00:00.000Z');
      expect(sub.endsAt!.toISOString()).toBe('2025-04-14T10:00:00.000Z');
      expect(sub.endsAt!.getTime() - sub.startsAt.getTime()).toBe(30 * DAY_MS);
      expect(sub.initialCredits).toBeNull();
      expect(sub.remainingCredits).toBeNull();
    });

    it('SUB-03 startsAt defaults to now and respects an explicit offset', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.timePlan(7, 1000);
      freezeTime('2025-12-10T08:15:00.000Z');

      const implicit = await fx.buy(trainee.id, plan.id);
      const withOffset = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-12-10T09:00:00+02:00',
      });

      expect(implicit.startsAt.toISOString()).toBe('2025-12-10T08:15:00.000Z');
      expect(withOffset.startsAt.toISOString()).toBe(
        '2025-12-10T07:00:00.000Z',
      );
    });

    // CHARACTERIZATION: possibly unintended
    it('SUB-03 date-only startsAt is UTC midnight, not Europe/Sofia midnight', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.timePlan(7, 1000);

      const sub = await fx.buy(trainee.id, plan.id, { startsAt: '2025-12-10' });

      expect(sub.startsAt.toISOString()).toBe('2025-12-10T00:00:00.000Z');
    });

    it('SUB-04 payment: override is stored and booked as SUBSCRIPTION_IN; 0 books nothing', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.punchPlan(8, 12000);

      const paid = await fx.buy(trainee.id, plan.id, { paidCents: 9000 });

      expect(paid.paidCents).toBe(9000);
      const txs = await fx.cashTxs();
      expect(txs).toHaveLength(1);
      expect(txs[0]).toMatchObject({
        type: 'SUBSCRIPTION_IN',
        sourceType: 'SUBSCRIPTION',
        sourceId: paid.id,
        amountCents: 9000,
        balanceAfterCents: 9000,
      });
      expect(await fx.balance()).toBe(9000);

      const free = await fx.buy(trainee.id, plan.id, { paidCents: 0 });

      expect(free.paidCents).toBe(0);
      expect(await fx.cashTxs()).toHaveLength(1);
      expect(await fx.balance()).toBe(9000);
    });

    it('SUB-05 inactive/missing trainee or plan is rejected with no side effects', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const unpaid = await attend('2025-12-01T10:00:00Z');
      const plan = await fx.punchPlan(5, 5000);
      const inactivePlan = await fx.punchPlan(5, 5000, { isActive: false });
      const inactiveTrainee = await fx.trainee('Gone', { isActive: false });

      const cases: Array<[string, string, string]> = [
        [inactiveTrainee.id, plan.id, 'Trainee not found or inactive'],
        [randomUUID(), plan.id, 'Trainee not found or inactive'],
        [trainee.id, inactivePlan.id, 'Plan not found or inactive'],
        [trainee.id, randomUUID(), 'Plan not found or inactive'],
      ];
      for (const [traineeId, planId, message] of cases) {
        const err = await rejectionOf(fx.buy(traineeId, planId));
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(message);
      }

      // Deactivating the trainee after attendance exists: still rejected.
      await fx.ds
        .getRepository(TraineeProfileEntity)
        .update(trainee.id, { isActive: false });
      expect((await rejectionOf(fx.buy(trainee.id, plan.id))).message).toBe(
        'Trainee not found or inactive',
      );

      expect(await fx.subscriptionRows()).toHaveLength(0);
      expect(await fx.cashTxs()).toHaveLength(0);
      expect(await fx.att(unpaid.id)).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
    });

    it('SUB-07 plans with a broken shape (direct DB edit) are rejected', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const planRepo = fx.ds.getRepository(PlanEntity);
      const punch = await fx.punchPlan(5, 1000);
      const time = await fx.timePlan(30, 1000);
      await planRepo.update(punch.id, { credits: null });
      await planRepo.update(time.id, { durationDays: 0 });

      expect((await rejectionOf(fx.buy(trainee.id, punch.id))).message).toBe(
        'Punch plan must have credits',
      );
      expect((await rejectionOf(fx.buy(trainee.id, time.id))).message).toBe(
        'Time plan must have durationDays',
      );
      expect(await fx.subscriptionRows()).toHaveLength(0);
    });
  });

  describe('reconciliation of unpaid attendance on purchase', () => {
    it('SUB-10 PUNCH with more credits than unpaid rows pays all of them', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const rows = [
        await attend('2025-12-01T10:00:00Z'),
        await attend('2025-12-02T10:00:00Z'),
        await attend('2025-12-03T10:00:00Z'),
      ];
      const plan = await fx.punchPlan(5, 5000);

      const sub = await fx.buy(trainee.id, plan.id);

      expect(sub.remainingCredits).toBe(2); // returned entity is reloaded
      expect(sub.status).toBe(SubscriptionStatus.ACTIVE);
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 2,
        initialCredits: 5,
        status: SubscriptionStatus.ACTIVE,
      });
      for (const row of rows) {
        expect(await fx.att(row.id)).toMatchObject({
          paymentStatus: PAID,
          subscriptionId: sub.id,
        });
      }
    });

    it('SUB-11 PUNCH with fewer credits pays the oldest by trainedAt (then createdAt) and exhausts', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      // Created out of chronological order to prove trainedAt drives the order.
      const dec3 = await attend('2025-12-03T10:00:00Z');
      const dec1 = await attend('2025-12-01T10:00:00Z');
      const dec4 = await attend('2025-12-04T10:00:00Z');
      const dec2a = await attend('2025-12-02T10:00:00Z'); // created first
      const dec2b = await attend('2025-12-02T10:00:00Z'); // same trainedAt, created later
      const plan = await fx.punchPlan(2, 2000);

      const sub = await fx.buy(trainee.id, plan.id);

      expect(sub).toMatchObject({
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });
      expect((await fx.att(dec1.id)).paymentStatus).toBe(PAID);
      expect((await fx.att(dec2a.id)).paymentStatus).toBe(PAID);
      for (const later of [dec2b, dec3, dec4]) {
        expect(await fx.att(later.id)).toMatchObject({
          paymentStatus: UNPAID,
          subscriptionId: null,
        });
      }
    });

    it('SUB-12 PUNCH with exactly as many credits as unpaid rows is EXHAUSTED', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      await attend('2025-12-01T10:00:00Z');
      await attend('2025-12-02T10:00:00Z');
      const plan = await fx.punchPlan(2, 2000);

      const sub = await fx.buy(trainee.id, plan.id);

      expect(sub).toMatchObject({
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });
      const rows = await fx.attendanceRows();
      expect(rows.every((r) => r.paymentStatus === PAID)).toBe(true);
    });

    // CHARACTERIZATION: possibly unintended
    it('SUB-13 TIME marks ALL unpaid attendance PAID, even outside [startsAt, endsAt)', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const before = await attend('2025-11-01T10:00:00Z');
      const inside = await attend('2025-12-10T10:00:00Z');
      const after = await attend('2026-03-01T10:00:00Z');
      const plan = await fx.timePlan(30, 6000);

      const sub = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-12-01T00:00:00Z',
      });

      for (const row of [before, inside, after]) {
        expect(await fx.att(row.id)).toMatchObject({
          paymentStatus: PAID,
          subscriptionId: sub.id,
        });
      }
      // The resolver itself would not match the out-of-window ones.
      expect(
        await fx.resolver.resolveForAttendance(trainee.id, before.trainedAt),
      ).toBeNull();
    });

    it('SUB-14 reconciliation touches only this trainee and only UNPAID rows', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const other = await fx.trainee('Other');
      const otherUnpaid = await attend('2025-12-01T10:00:00Z', other.id);

      const oldPlan = await fx.punchPlan(1, 1000);
      const oldSub = await fx.buy(trainee.id, oldPlan.id);
      const alreadyPaid = await attend('2025-11-01T10:00:00Z'); // uses oldSub
      const unpaid = await attend('2025-11-02T10:00:00Z'); // oldSub exhausted

      const plan = await fx.punchPlan(5, 5000);
      const sub = await fx.buy(trainee.id, plan.id);

      expect(await fx.att(otherUnpaid.id)).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
      expect(await fx.att(alreadyPaid.id)).toMatchObject({
        paymentStatus: PAID,
        subscriptionId: oldSub.id,
      });
      expect(await fx.att(unpaid.id)).toMatchObject({
        paymentStatus: PAID,
        subscriptionId: sub.id,
      });
      expect((await fx.sub(sub.id)).remainingCredits).toBe(4);
      expect((await fx.sub(oldSub.id)).remainingCredits).toBe(0);
    });

    it('SUB-15 PUNCH reconciliation ignores startsAt: older unpaid attendance consumes credits', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const old = await attend('2025-10-01T10:00:00Z');
      const plan = await fx.punchPlan(3, 3000);

      const sub = await fx.buy(trainee.id, plan.id, {
        startsAt: '2026-01-01T00:00:00Z',
      });

      expect(await fx.att(old.id)).toMatchObject({
        paymentStatus: PAID,
        subscriptionId: sub.id,
      });
      expect(sub.remainingCredits).toBe(2);
    });
  });

  describe('delete', () => {
    it('SUB-20 frees its PAID attendance and leaves other rows untouched', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const other = await fx.trainee('Other');
      const plan = await fx.punchPlan(2, 2000);
      const sub = await fx.buy(trainee.id, plan.id);
      const otherSub = await fx.buy(other.id, plan.id);
      const paid1 = await attend('2025-12-01T10:00:00Z');
      const paid2 = await attend('2025-12-02T10:00:00Z');
      const unpaid = await attend('2025-12-03T10:00:00Z'); // sub exhausted
      const otherPaid = await attend('2025-12-01T10:00:00Z', other.id);

      const result = await fx.subscriptions.remove(sub.id);

      expect(result).toEqual({ deleted: true });
      expect(
        (await fx.subscriptionRows()).map((s) => s.id).includes(sub.id),
      ).toBe(false);
      for (const row of [paid1, paid2, unpaid]) {
        expect(await fx.att(row.id)).toMatchObject({
          paymentStatus: UNPAID,
          subscriptionId: null,
        });
      }
      expect(await fx.att(otherPaid.id)).toMatchObject({
        paymentStatus: PAID,
        subscriptionId: otherSub.id,
      });
    });

    it('SUB-20 unknown id -> 404 Subscription not found', async () => {
      const fx = fixtures();
      const err = await rejectionOf(fx.subscriptions.remove(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Subscription not found');
    });

    // CHARACTERIZATION: possibly unintended
    it('SUB-21 deleting does not reverse the cash register; sourceDetails becomes null', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const plan = await fx.punchPlan(5, 7000);
      const sub = await fx.buy(trainee.id, plan.id);

      await fx.subscriptions.remove(sub.id);

      const state = await fx.cashRegister.getCurrentState();
      expect(state.balanceCents).toBe(7000);
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0]).toMatchObject({
        type: 'SUBSCRIPTION_IN',
        sourceId: sub.id,
        amountCents: 7000,
        sourceDetails: null,
      });
    });

    // CHARACTERIZATION: possibly unintended
    it('SUB-22 freed attendance is not re-reconciled against other active subscriptions', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const first = await fx.buy(trainee.id, (await fx.punchPlan(1, 1000)).id, {
        startsAt: '2025-11-01T00:00:00Z',
      });
      const second = await fx.buy(
        trainee.id,
        (await fx.punchPlan(5, 5000)).id,
        { startsAt: '2025-11-02T00:00:00Z' },
      );
      const row = await attend('2025-12-01T10:00:00Z'); // earliest startsAt wins
      expect(row.subscriptionId).toBe(first.id);

      await fx.subscriptions.remove(first.id);

      expect(await fx.att(row.id)).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
      expect(await fx.sub(second.id)).toMatchObject({
        remainingCredits: 5,
        status: SubscriptionStatus.ACTIVE,
      });
    });

    it('SUB-23 settlement allocations of a deleted sub keep their value with subscriptionId null', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(3, 10000)).id);
      const row = await attend('2025-12-01T10:00:00Z');
      const { settlement } = await fx.settlements.generate({
        periodStart: '2025-12-01',
        periodEnd: '2025-12-31',
      });

      await fx.subscriptions.remove(sub.id);

      const allocs = await fx.allocationsOf(settlement.id);
      expect(allocs).toHaveLength(1);
      expect(allocs[0]).toMatchObject({
        attendanceId: row.id,
        subscriptionId: null,
        subscriptionType: PlanType.PUNCH,
        valueCents: 3334,
        reason: 'PUNCH_CREDIT',
      });
    });
  });

  describe('list', () => {
    it('SUB-30 listForTrainee returns all statuses ordered by startsAt DESC, createdAt DESC', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const other = await fx.trainee('Other');
      const plan = await fx.punchPlan(1, 1000);
      const jan = await fx.buy(trainee.id, plan.id, {
        startsAt: '2026-01-01T00:00:00Z',
      });
      const decA = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-12-01T00:00:00Z',
      });
      const decB = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-12-01T00:00:00Z',
      });
      const feb = await fx.buy(trainee.id, plan.id, {
        startsAt: '2026-02-01T00:00:00Z',
      });
      await fx.buy(other.id, plan.id);
      await attend('2025-12-05T10:00:00Z'); // exhausts decA (earliest)

      const list = await fx.subscriptions.listForTrainee(trainee.id);

      expect(list.map((s) => s.id)).toEqual([feb.id, jan.id, decB.id, decA.id]);
      expect(list.find((s) => s.id === decA.id)!.status).toBe(
        SubscriptionStatus.EXHAUSTED,
      );
    });
  });

  describe('exhaustPastEndTimeSubscriptions (cron job body)', () => {
    // CHARACTERIZATION: possibly unintended (sets EXHAUSTED, never EXPIRED)
    it('CRON-01 exhausts ACTIVE TIME subs with endsAt < now only and returns the count', async () => {
      const fx = fixtures();
      const { trainee } = await world(fx);
      const now = new Date('2026-01-10T02:00:00.000Z');
      const base = {
        traineeId: trainee.id,
        planId: (await fx.timePlan(30, 0)).id,
      };
      const past = await fx.insertSubscription({
        ...base,
        type: PlanType.TIME,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: new Date(now.getTime() - 1),
      });
      const exactlyNow = await fx.insertSubscription({
        ...base,
        type: PlanType.TIME,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: now,
      });
      const pastCancelled = await fx.insertSubscription({
        ...base,
        type: PlanType.TIME,
        status: SubscriptionStatus.CANCELLED,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: new Date('2025-12-31T00:00:00Z'),
      });
      const punch = await fx.insertSubscription({
        ...base,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: new Date('2025-12-31T00:00:00Z'), // impossible via API
        initialCredits: 5,
        remainingCredits: 5,
      });
      freezeTime(now);

      const affected = await fx.subscriptions.exhaustPastEndTimeSubscriptions();

      expect(affected).toBe(1);
      expect((await fx.sub(past.id)).status).toBe(SubscriptionStatus.EXHAUSTED);
      expect((await fx.sub(exactlyNow.id)).status).toBe(
        SubscriptionStatus.ACTIVE,
      );
      expect((await fx.sub(pastCancelled.id)).status).toBe(
        SubscriptionStatus.CANCELLED,
      );
      expect((await fx.sub(punch.id)).status).toBe(SubscriptionStatus.ACTIVE);
    });
  });
});

describe('SubscriptionResolverService (integration)', () => {
  const fixtures = setupIntegrationSuite();

  async function world(fx: Fixtures) {
    const [trainee, trainer, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach'),
      fx.location(),
    ]);
    return { trainee, trainer, loc };
  }

  it('RES-01 PUNCH is eligible when ACTIVE with credits, regardless of startsAt', async () => {
    const fx = fixtures();
    const { trainee, trainer, loc } = await world(fx);
    const sub = await fx.buy(trainee.id, (await fx.punchPlan(3, 3000)).id, {
      startsAt: '2026-02-01T00:00:00Z',
    });

    const { attendance } = await fx.attend(
      trainee.id,
      trainer.id,
      loc.id,
      '2026-01-10T10:00:00Z',
    );

    expect(attendance).toMatchObject({
      paymentStatus: PAID,
      subscriptionId: sub.id,
    });
  });

  it('RES-01 PUNCH that is ACTIVE but has 0 credits is not eligible', async () => {
    const fx = fixtures();
    const { trainee } = await world(fx);
    await fx.insertSubscription({
      traineeId: trainee.id,
      planId: (await fx.punchPlan(3, 0)).id,
      type: PlanType.PUNCH,
      startsAt: new Date('2025-01-01T00:00:00Z'),
      initialCredits: 3,
      remainingCredits: 0,
    });

    expect(
      await fx.resolver.resolveForAttendance(
        trainee.id,
        new Date('2025-06-01T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('RES-02 TIME window is [startsAt, endsAt): start inclusive, end exclusive', async () => {
    const fx = fixtures();
    const { trainee, trainer, loc } = await world(fx);
    const sub = await fx.buy(trainee.id, (await fx.timePlan(10, 5000)).id, {
      startsAt: '2025-12-01T00:00:00.000Z',
    });
    const resolve = (iso: string) =>
      fx.resolver
        .resolveForAttendance(trainee.id, new Date(iso))
        .then((s) => s?.id ?? null);

    expect(await resolve('2025-11-30T23:59:59.999Z')).toBeNull();
    expect(await resolve('2025-12-01T00:00:00.000Z')).toBe(sub.id);
    expect(await resolve('2025-12-10T23:59:59.999Z')).toBe(sub.id);
    expect(await resolve('2025-12-11T00:00:00.000Z')).toBeNull();

    const atEnd = await fx.attend(
      trainee.id,
      trainer.id,
      loc.id,
      '2025-12-11T00:00:00.000Z',
    );
    const atStart = await fx.attend(
      trainee.id,
      trainer.id,
      loc.id,
      '2025-12-01T00:00:00.000Z',
    );
    expect(atEnd.attendance.paymentStatus).toBe(UNPAID);
    expect(atStart.attendance.subscriptionId).toBe(sub.id);
  });

  it('RES-03 non-ACTIVE subscriptions are never eligible', async () => {
    const fx = fixtures();
    const { trainee } = await world(fx);
    const punchPlan = await fx.punchPlan(5, 0);
    const timePlan = await fx.timePlan(30, 0);
    for (const status of [
      SubscriptionStatus.EXHAUSTED,
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELLED,
    ]) {
      await fx.insertSubscription({
        traineeId: trainee.id,
        planId: punchPlan.id,
        type: PlanType.PUNCH,
        status,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 5,
        remainingCredits: 5,
      });
      await fx.insertSubscription({
        traineeId: trainee.id,
        planId: timePlan.id,
        type: PlanType.TIME,
        status,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: new Date('2025-12-31T00:00:00Z'),
      });
    }

    expect(
      await fx.resolver.resolveForAttendance(
        trainee.id,
        new Date('2025-12-10T10:00:00Z'),
      ),
    ).toBeNull();
  });

  it('RES-04 earliest startsAt wins, PUNCH and TIME compete on the same ordering', async () => {
    const fx = fixtures();
    const { trainee } = await world(fx);
    const at = new Date('2025-12-10T10:00:00Z');
    const time = await fx.buy(trainee.id, (await fx.timePlan(30, 0)).id, {
      startsAt: '2025-12-01T00:00:00Z',
    });
    const olderPunch = await fx.buy(trainee.id, (await fx.punchPlan(5, 0)).id, {
      startsAt: '2025-11-15T00:00:00Z',
    });

    expect((await fx.resolver.resolveForAttendance(trainee.id, at))!.id).toBe(
      olderPunch.id,
    );

    await fx.subscriptions.remove(olderPunch.id);
    expect((await fx.resolver.resolveForAttendance(trainee.id, at))!.id).toBe(
      time.id,
    );
  });

  it('RES-04 equal startsAt: the earliest created wins', async () => {
    const fx = fixtures();
    const { trainee } = await world(fx);
    const plan = await fx.punchPlan(5, 0);
    const first = await fx.buy(trainee.id, plan.id, {
      startsAt: '2025-12-01T00:00:00Z',
    });
    await fx.buy(trainee.id, plan.id, { startsAt: '2025-12-01T00:00:00Z' });

    expect(
      (await fx.resolver.resolveForAttendance(
        trainee.id,
        new Date('2025-12-10T10:00:00Z'),
      ))!.id,
    ).toBe(first.id);
  });

  it("RES-05 another trainee's subscription is never used", async () => {
    const fx = fixtures();
    const { trainee, trainer, loc } = await world(fx);
    const other = await fx.trainee('Other');
    const otherSub = await fx.buy(other.id, (await fx.punchPlan(5, 0)).id);

    const { attendance, info } = await fx.attend(
      trainee.id,
      trainer.id,
      loc.id,
      '2025-12-10T10:00:00Z',
    );

    expect(attendance.paymentStatus).toBe(UNPAID);
    expect(info.subscriptionId).toBeNull();
    expect((await fx.sub(otherSub.id)).remainingCredits).toBe(5);
  });
});
