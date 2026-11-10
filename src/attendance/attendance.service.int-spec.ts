import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';

const { PAID, UNPAID } = AttendancePaymentStatus;

describe('AttendanceService write path (integration)', () => {
  const fixtures = setupIntegrationSuite();

  async function world(fx: Fixtures) {
    const [trainee, trainer, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach'),
      fx.location(),
    ]);
    const attend = (trainedAt: string, traineeId = trainee.id) =>
      fx.attend(traineeId, trainer.id, loc.id, trainedAt);
    return { trainee, trainer, loc, attend };
  }

  describe('create', () => {
    it('ATT-01 eligible PUNCH: PAID, linked, consumes one credit, full info', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(10, 10000)).id);

      const { attendance, info } = await attend('2025-12-01T10:00:00Z');

      expect(await fx.att(attendance.id)).toMatchObject({
        paymentStatus: PAID,
        subscriptionId: sub.id,
      });
      expect((await fx.sub(sub.id)).remainingCredits).toBe(9);
      expect(info).toEqual({
        paymentStatus: 'PAID',
        subscriptionId: sub.id,
        subscriptionType: 'PUNCH',
        remainingCredits: 9,
      });
    });

    it('ATT-02 last credit exhausts the sub; the next attendance is UNPAID', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(1, 1000)).id);

      const last = await attend('2025-12-01T10:00:00Z');
      expect(last.info).toMatchObject({ remainingCredits: 0 });
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 0,
        status: SubscriptionStatus.EXHAUSTED,
      });

      const next = await attend('2025-12-02T10:00:00Z');
      expect(next.attendance).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
    });

    it('ATT-02 after exhausting one sub, the next eligible sub pays', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const plan = await fx.punchPlan(1, 1000);
      const first = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-11-01T00:00:00Z',
      });
      const second = await fx.buy(trainee.id, plan.id, {
        startsAt: '2025-11-02T00:00:00Z',
      });

      const a = await attend('2025-12-01T10:00:00Z');
      const b = await attend('2025-12-02T10:00:00Z');

      expect(a.attendance.subscriptionId).toBe(first.id);
      expect(b.attendance.subscriptionId).toBe(second.id);
      expect((await fx.sub(second.id)).status).toBe(
        SubscriptionStatus.EXHAUSTED,
      );
    });

    it('ATT-03 eligible TIME: PAID, no credit change, info has no remainingCredits', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-01T00:00:00Z',
      });

      const { attendance, info } = await attend('2025-12-05T10:00:00Z');

      expect(attendance.paymentStatus).toBe(PAID);
      expect(info).toEqual({
        paymentStatus: 'PAID',
        subscriptionId: sub.id,
        subscriptionType: 'TIME',
      });
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: null,
        status: SubscriptionStatus.ACTIVE,
      });
    });

    it('ATT-04 no eligible sub: UNPAID with null subscription info', async () => {
      const fx = fixtures();
      const { attend } = await world(fx);

      const { attendance, info } = await attend('2025-12-05T10:00:00Z');

      expect(await fx.att(attendance.id)).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
      expect(info).toEqual({
        paymentStatus: 'UNPAID',
        subscriptionId: null,
        subscriptionType: null,
      });
    });

    it("ATT-05 gymSubscriptionId is a snapshot of the trainee's value at creation", async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const g1 = await fx.gymSubscription('MultiSport');
      const g2 = await fx.gymSubscription('Coolfit');
      const traineeRepo = fx.ds.getRepository(TraineeProfileEntity);
      await traineeRepo.update(trainee.id, { gymSubscriptionId: g1.id });

      const old = await attend('2025-12-01T10:00:00Z');
      await traineeRepo.update(trainee.id, { gymSubscriptionId: g2.id });
      const fresh = await attend('2025-12-02T10:00:00Z');

      expect((await fx.att(old.attendance.id)).gymSubscriptionId).toBe(g1.id);
      expect((await fx.att(fresh.attendance.id)).gymSubscriptionId).toBe(g2.id);
    });

    it('ATT-06 inactive/missing trainee, trainer, location are rejected in that order', async () => {
      const fx = fixtures();
      const { trainee, trainer, loc } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(5, 0)).id);
      const badTrainee = await fx.trainee('Off', { isActive: false });
      const badTrainer = await fx.trainer('Off', { isActive: false });
      const badLoc = await fx.location('Closed', { isActive: false });

      const cases: Array<[string, string, string, string]> = [
        [
          badTrainee.id,
          badTrainer.id,
          badLoc.id,
          'Trainee not found or inactive',
        ],
        [randomUUID(), trainer.id, loc.id, 'Trainee not found or inactive'],
        [trainee.id, badTrainer.id, badLoc.id, 'Trainer not found or inactive'],
        [trainee.id, randomUUID(), loc.id, 'Trainer not found or inactive'],
        [trainee.id, trainer.id, badLoc.id, 'Location not found or inactive'],
        [
          trainee.id,
          trainer.id,
          randomUUID(),
          'Location not found or inactive',
        ],
      ];
      for (const [traineeId, trainerId, locationId, message] of cases) {
        const err = await rejectionOf(
          fx.attend(traineeId, trainerId, locationId, '2025-12-01T10:00:00Z'),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(message);
      }

      expect(await fx.attendanceRows()).toHaveLength(0);
      expect((await fx.sub(sub.id)).remainingCredits).toBe(5);
    });

    it('ATT-07 persisted trainedAt follows resolveTrainedAt', async () => {
      const fx = fixtures();
      const { trainee, trainer, loc } = await world(fx);
      freezeTime('2026-01-20T09:45:00.000Z');
      const base = {
        traineeId: trainee.id,
        trainerId: trainer.id,
        locationId: loc.id,
      };

      const explicit = await fx.attendance.create({
        ...base,
        trainedAt: '2025-12-28T18:30:00Z',
      });
      const sofiaLocal = await fx.attendance.create({
        ...base,
        trainedAt: '2025-12-28T18:30',
      });
      const dateAndTime = await fx.attendance.create({
        ...base,
        trainedDate: '2025-07-01',
        trainedTime: '18:30',
      });
      const dateOnly = await fx.attendance.create({
        ...base,
        trainedDate: '2025-12-28',
      });
      const nothing = await fx.attendance.create(base);

      const stored = async (r: { attendance: { id: string } }) =>
        (await fx.att(r.attendance.id)).trainedAt.toISOString();
      expect(await stored(explicit)).toBe('2025-12-28T18:30:00.000Z');
      expect(await stored(sofiaLocal)).toBe('2025-12-28T16:30:00.000Z'); // +02:00
      expect(await stored(dateAndTime)).toBe('2025-07-01T15:30:00.000Z'); // +03:00
      expect(await stored(dateOnly)).toBe('2025-12-28T10:00:00.000Z'); // 12:00 Sofia
      expect(await stored(nothing)).toBe('2026-01-20T09:45:00.000Z');
    });

    // CHARACTERIZATION: possibly unintended
    it('ATT-08 future-dated and exact duplicate attendance are accepted; each consumes a credit', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      freezeTime('2025-12-01T12:00:00.000Z');
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(5, 0)).id);

      const future = await attend('2026-06-01T10:00:00Z');
      const dup1 = await attend('2025-12-01T10:00:00Z');
      const dup2 = await attend('2025-12-01T10:00:00Z');

      for (const r of [future, dup1, dup2]) {
        expect(r.attendance.paymentStatus).toBe(PAID);
      }
      expect(dup1.attendance.id).not.toBe(dup2.attendance.id);
      expect(await fx.attendanceRows()).toHaveLength(3);
      expect((await fx.sub(sub.id)).remainingCredits).toBe(2);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATT-09 parallel creates on a 1-credit sub: exactly one PAID, credits never < 0, the loser is UNPAID or fails with a deadlock', async () => {
      const fx = fixtures();
      const { trainer, loc } = await world(fx);
      const plan = await fx.punchPlan(1, 0);
      const seen = new Set<string>();

      // Postgres detects the deadlock after deadlock_timeout (1s), hence the
      // longer jest timeout. Flaky-prone by nature: the outcome mix varies.
      for (let round = 1; round <= 4; round++) {
        // Fresh trainee per round: buying would otherwise reconcile the
        // previous round's UNPAID loser.
        const trainee = await fx.trainee(`Round ${round}`);
        const sub = await fx.buy(trainee.id, plan.id);
        const settled = await Promise.allSettled([
          fx.attend(
            trainee.id,
            trainer.id,
            loc.id,
            `2025-12-${String(round).padStart(2, '0')}T10:00:00Z`,
          ),
          fx.attend(
            trainee.id,
            trainer.id,
            loc.id,
            `2025-12-${String(round).padStart(2, '0')}T11:00:00Z`,
          ),
        ]);

        const rejected = settled.filter(
          (r): r is PromiseRejectedResult => r.status === 'rejected',
        );
        const fresh = (await fx.attendanceRows()).filter(
          (r) => !seen.has(r.id),
        );
        fresh.forEach((r) => seen.add(r.id));
        const paid = fresh.filter((r) => r.paymentStatus === PAID);

        expect(paid).toHaveLength(1);
        expect(paid[0].subscriptionId).toBe(sub.id);
        expect(rejected.length).toBeLessThanOrEqual(1);
        for (const r of rejected) {
          expect(String((r.reason as Error).message)).toMatch(
            /deadlock detected/,
          );
        }
        // Loser either persisted as UNPAID, or rolled back entirely.
        expect(fresh.length + rejected.length).toBe(2);
        expect(await fx.sub(sub.id)).toMatchObject({
          remainingCredits: 0,
          status: SubscriptionStatus.EXHAUSTED,
        });
      }
    }, 30_000);
  });

  describe('batch', () => {
    it('ATT-10 de-duplicates traineeIds and resolves payment per trainee', async () => {
      const fx = fixtures();
      const { trainee: a, trainer, loc } = await world(fx);
      const b = await fx.trainee('Bob');
      const sub = await fx.buy(a.id, (await fx.punchPlan(5, 0)).id);

      const res = await fx.attendance.createBatch({
        trainerId: trainer.id,
        locationId: loc.id,
        traineeIds: [a.id, b.id, a.id],
        trainedAt: '2025-12-10T18:00:00Z',
      });

      expect(res.trainerId).toBe(trainer.id);
      expect(res.trainedAt).toBe('2025-12-10T18:00:00.000Z');
      expect(res.count).toBe(2);
      expect(res.results).toHaveLength(2);
      const byTrainee = new Map(
        (
          res.results as Array<{
            attendance: { traineeId: string };
            info: unknown;
          }>
        ).map((r) => [r.attendance.traineeId, r.info]),
      );
      expect(byTrainee.get(a.id)).toEqual({
        paymentStatus: 'PAID',
        subscriptionId: sub.id,
        subscriptionType: 'PUNCH',
        remainingCredits: 4,
      });
      expect(byTrainee.get(b.id)).toEqual({
        paymentStatus: 'UNPAID',
        subscriptionId: null,
        subscriptionType: null,
      });
      expect(await fx.attendanceRows()).toHaveLength(2);
      expect((await fx.sub(sub.id)).remainingCredits).toBe(4);
    });

    it('ATT-11 any missing/inactive trainee rejects the whole batch with invalidTraineeIds', async () => {
      const fx = fixtures();
      const { trainee, trainer, loc } = await world(fx);
      const inactive = await fx.trainee('Off', { isActive: false });
      const missing = randomUUID();

      const err = await rejectionOf(
        fx.attendance.createBatch({
          trainerId: trainer.id,
          locationId: loc.id,
          traineeIds: [trainee.id, inactive.id, missing],
          trainedAt: '2025-12-10T18:00:00Z',
        }),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual({
        message: 'Some trainees are missing or inactive',
        invalidTraineeIds: [inactive.id, missing],
      });
      expect(await fx.attendanceRows()).toHaveLength(0);
    });

    it('ATT-12 validates trainer, then trainees, then location, all before any insert', async () => {
      const fx = fixtures();
      const { trainee, trainer, loc } = await world(fx);
      const badTrainer = await fx.trainer('Off', { isActive: false });
      const badLoc = await fx.location('Closed', { isActive: false });
      const missing = randomUUID();
      const batch = (
        trainerId: string,
        traineeIds: string[],
        locationId: string,
      ) =>
        rejectionOf(
          fx.attendance.createBatch({
            trainerId,
            traineeIds,
            locationId,
            trainedAt: '2025-12-10T18:00:00Z',
          }),
        );

      expect((await batch(badTrainer.id, [missing], badLoc.id)).message).toBe(
        'Trainer not found or inactive',
      );
      expect((await batch(trainer.id, [missing], badLoc.id)).message).toBe(
        'Some trainees are missing or inactive',
      );
      expect((await batch(trainer.id, [trainee.id], badLoc.id)).message).toBe(
        'Location not found or inactive',
      );
      expect(
        (await batch(trainer.id, [trainee.id], randomUUID())).message,
      ).toBe('Location not found or inactive');
      expect(await fx.attendanceRows()).toHaveLength(0);
      // sanity: the same batch with a valid location succeeds
      await fx.attendance.createBatch({
        trainerId: trainer.id,
        traineeIds: [trainee.id],
        locationId: loc.id,
        trainedAt: '2025-12-10T18:00:00Z',
      });
      expect(await fx.attendanceRows()).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('ATT-20 deleting PAID PUNCH attendance restores a credit and re-activates an EXHAUSTED sub', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(2, 0)).id);
      const a = await attend('2025-12-01T10:00:00Z');
      await attend('2025-12-02T10:00:00Z');
      expect((await fx.sub(sub.id)).status).toBe(SubscriptionStatus.EXHAUSTED);

      const res = await fx.attendance.remove(a.attendance.id);

      expect(res).toEqual({ deleted: true });
      expect(await fx.attendanceRows()).toHaveLength(1);
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 1,
        status: SubscriptionStatus.ACTIVE,
      });
    });

    it('ATT-20 restored credits are capped at initialCredits', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(3, 0)).id);
      const a = await attend('2025-12-01T10:00:00Z');
      // Corrupt the counter to "full" (only possible by direct edit).
      await fx.ds
        .getRepository(SubscriptionEntity)
        .update(sub.id, { remainingCredits: 3 });

      await fx.attendance.remove(a.attendance.id);

      expect((await fx.sub(sub.id)).remainingCredits).toBe(3);
    });

    it('ATT-21 any status becomes ACTIVE when credits are restored (even EXPIRED/CANCELLED)', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const plan = await fx.punchPlan(3, 0);
      for (const status of [
        SubscriptionStatus.EXPIRED,
        SubscriptionStatus.CANCELLED,
      ]) {
        const sub = await fx.buy(trainee.id, plan.id);
        const a = await attend('2025-12-01T10:00:00Z');
        expect(a.attendance.subscriptionId).toBe(sub.id);
        await fx.ds
          .getRepository(SubscriptionEntity)
          .update(sub.id, { status });

        await fx.attendance.remove(a.attendance.id);

        expect(await fx.sub(sub.id)).toMatchObject({
          remainingCredits: 3,
          status: SubscriptionStatus.ACTIVE,
        });
        await fx.subscriptions.remove(sub.id);
      }
    });

    it('ATT-22 deleting TIME-linked or UNPAID attendance leaves subscriptions untouched', async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const time = await fx.buy(trainee.id, (await fx.timePlan(10, 0)).id, {
        startsAt: '2025-12-01T00:00:00Z',
      });
      const timeAtt = await attend('2025-12-02T10:00:00Z');
      const unpaid = await attend('2026-01-15T10:00:00Z'); // outside TIME window
      expect(unpaid.attendance.paymentStatus).toBe(UNPAID);
      const punch = await fx.insertSubscription({
        traineeId: trainee.id,
        planId: (await fx.punchPlan(3, 0)).id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 3,
        remainingCredits: 1,
      });
      const snapshot = async () =>
        (await fx.subscriptionRows()).sort((x, y) => x.id.localeCompare(y.id));
      const before = await snapshot();

      await fx.attendance.remove(timeAtt.attendance.id);
      await fx.attendance.remove(unpaid.attendance.id);

      expect(await snapshot()).toEqual(before);
      expect((await fx.sub(punch.id)).remainingCredits).toBe(1);
      expect((await fx.sub(time.id)).status).toBe(SubscriptionStatus.ACTIVE);
      expect(await fx.attendanceRows()).toHaveLength(0);
    });

    // CHARACTERIZATION: possibly unintended
    it("ATT-23 the restored credit is not applied to the trainee's other UNPAID attendance", async () => {
      const fx = fixtures();
      const { trainee, attend } = await world(fx);
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(1, 0)).id);
      const paid = await attend('2025-12-01T10:00:00Z');
      const unpaid = await attend('2025-12-02T10:00:00Z');

      await fx.attendance.remove(paid.attendance.id);

      expect(await fx.att(unpaid.attendance.id)).toMatchObject({
        paymentStatus: UNPAID,
        subscriptionId: null,
      });
      expect((await fx.sub(sub.id)).remainingCredits).toBe(1);
    });

    // CHARACTERIZATION: possibly unintended
    it('ATT-24 deleting settled attendance drops its allocation but not the (FINAL) settlement line', async () => {
      const fx = fixtures();
      const { trainee, trainer, attend } = await world(fx);
      await fx.buy(trainee.id, (await fx.punchPlan(2, 1000)).id);
      const a = await attend('2025-12-01T10:00:00Z');
      await attend('2025-12-02T10:00:00Z');
      const { settlement } = await fx.settlements.generate({
        periodStart: '2025-12-01',
        periodEnd: '2025-12-31',
      });
      await fx.settlements.finalize(settlement.id);

      await fx.attendance.remove(a.attendance.id);

      const allocs = await fx.allocationsOf(settlement.id);
      expect(allocs).toHaveLength(1);
      expect(allocs.reduce((s, r) => s + r.valueCents, 0)).toBe(500);
      const [line] = await fx.linesOf(settlement.id);
      expect(line).toMatchObject({
        trainerId: trainer.id,
        amountCents: 1000,
        attendanceCount: 2,
      });
      expect(
        (await fx.settlements.getById(settlement.id)).settlement.status,
      ).toBe('FINAL');
    });

    it('ATT-25 unknown id -> 404 Attendance not found', async () => {
      const fx = fixtures();
      const err = await rejectionOf(fx.attendance.remove(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Attendance not found');
    });
  });

  describe('previewBatch', () => {
    const TRAINED_AT = '2025-12-10T18:00:00Z';

    async function previewWorld(fx: Fixtures) {
      const { trainee: ana, trainer, loc } = await world(fx);
      const [bob, cara, dan] = await Promise.all([
        fx.trainee('Bob', { nickname: 'Bobby' }),
        fx.trainee('Cara'),
        fx.trainee('Dan'),
      ]);
      const body = (traineeIds: string[]) => ({
        trainerId: trainer.id,
        locationId: loc.id,
        traineeIds,
        trainedAt: TRAINED_AT,
      });
      return { ana, bob, cara, dan, trainer, loc, body };
    }

    it('ATT-40 shows what is left per trainee after the training, attention first', async () => {
      const fx = fixtures();
      freezeTime('2025-12-10T09:00:00Z');
      const { ana, bob, cara, dan, trainer, loc, body } =
        await previewWorld(fx);
      const anaSub = await fx.buy(ana.id, (await fx.punchPlan(10, 10000)).id);
      const bobSub = await fx.buy(bob.id, (await fx.punchPlan(1, 1000)).id);
      const caraSub = await fx.buy(cara.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-01T00:00:00Z',
      });

      const res = await fx.attendance.previewBatch(
        body([ana.id, bob.id, cara.id, dan.id, ana.id]),
      );

      expect(res).toEqual({
        trainerId: trainer.id,
        locationId: loc.id,
        trainedAt: '2025-12-10T18:00:00.000Z',
        count: 4,
        trainees: [
          {
            traineeId: dan.id,
            name: 'Dan',
            nickname: null,
            paymentStatus: UNPAID,
            level: 'UNPAID',
            subscription: null,
          },
          {
            traineeId: bob.id,
            name: 'Bob',
            nickname: 'Bobby',
            paymentStatus: PAID,
            level: 'LAST',
            subscription: {
              id: bobSub.id,
              type: 'PUNCH',
              planTitle: 'Punch 1',
              remainingCreditsAfter: 0,
              endsAt: null,
              daysLeft: null,
            },
          },
          {
            traineeId: ana.id,
            name: 'Ana',
            nickname: null,
            paymentStatus: PAID,
            level: 'OK',
            subscription: {
              id: anaSub.id,
              type: 'PUNCH',
              planTitle: 'Punch 10',
              remainingCreditsAfter: 9,
              endsAt: null,
              daysLeft: null,
            },
          },
          {
            traineeId: cara.id,
            name: 'Cara',
            nickname: null,
            paymentStatus: PAID,
            level: 'OK',
            subscription: {
              id: caraSub.id,
              type: 'TIME',
              planTitle: 'Time 30d',
              remainingCreditsAfter: null,
              endsAt: caraSub.endsAt,
              daysLeft: 21,
            },
          },
        ],
      });
    });

    it('ATT-41 saves nothing: no attendance, credits and statuses unchanged', async () => {
      const fx = fixtures();
      const { ana, body } = await previewWorld(fx);
      const sub = await fx.buy(ana.id, (await fx.punchPlan(1, 1000)).id);

      await fx.attendance.previewBatch(body([ana.id]));
      await fx.attendance.previewBatch(body([ana.id]));

      expect(await fx.attendanceRows()).toHaveLength(0);
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 1,
        status: SubscriptionStatus.ACTIVE,
      });
    });

    it('ATT-42 agrees with what createBatch then does for the same body', async () => {
      const fx = fixtures();
      const { ana, bob, cara, dan, trainer, loc, body } =
        await previewWorld(fx);
      const punch = await fx.punchPlan(2, 2000);
      // Ana: two cards, the earlier started one pays. Bob: an exhausted card
      // and a period that is over. Cara: a card and a period, the period
      // started first. Dan: a period that has not started yet.
      await fx.buy(ana.id, punch.id, { startsAt: '2025-11-02T00:00:00Z' });
      await fx.buy(ana.id, punch.id, { startsAt: '2025-11-01T00:00:00Z' });
      const used = await fx.buy(bob.id, (await fx.punchPlan(1, 1000)).id);
      await fx.attend(bob.id, trainer.id, loc.id, '2025-11-20T10:00:00Z');
      expect((await fx.sub(used.id)).status).toBe(SubscriptionStatus.EXHAUSTED);
      await fx.buy(bob.id, (await fx.timePlan(7, 1000)).id, {
        startsAt: '2025-11-01T00:00:00Z',
      });
      await fx.buy(cara.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-01T00:00:00Z',
      });
      await fx.buy(cara.id, punch.id, { startsAt: '2025-12-05T00:00:00Z' });
      await fx.buy(dan.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-12-11T00:00:00Z',
      });
      const ids = [ana.id, bob.id, cara.id, dan.id];

      const preview = await fx.attendance.previewBatch(body(ids));
      const saved = await fx.attendance.createBatch(body(ids));

      const savedByTrainee = new Map(
        (
          saved.results as Array<{
            attendance: {
              traineeId: string;
              paymentStatus: string;
              subscriptionId: string | null;
            };
          }>
        ).map((r) => [r.attendance.traineeId, r.attendance]),
      );
      expect(preview.trainees).toHaveLength(4);
      for (const row of preview.trainees) {
        const attendance = savedByTrainee.get(row.traineeId)!;
        expect([
          row.name,
          row.paymentStatus,
          row.subscription?.id ?? null,
        ]).toEqual([
          row.name,
          attendance.paymentStatus,
          attendance.subscriptionId,
        ]);
      }
      expect(
        new Map(preview.trainees.map((r) => [r.name, r.paymentStatus])),
      ).toEqual(
        new Map([
          ['Ana', PAID],
          ['Bob', UNPAID],
          ['Cara', PAID],
          ['Dan', UNPAID],
        ]),
      );

      // Ana had 2 + 2 trainings; the preview said 3 would be left.
      const anaRow = preview.trainees.find((r) => r.traineeId === ana.id)!;
      const anaLeft = (await fx.subscriptionRows())
        .filter((s) => s.traineeId === ana.id)
        .reduce((sum, s) => sum + (s.remainingCredits ?? 0), 0);
      expect(anaRow.subscription?.remainingCreditsAfter).toBe(3);
      expect(anaLeft).toBe(3);
    });

    it('ATT-43 fails like createBatch: trainer, then trainees, then location', async () => {
      const fx = fixtures();
      const { ana, trainer } = await previewWorld(fx);
      const badTrainer = await fx.trainer('Off', { isActive: false });
      const badLoc = await fx.location('Closed', { isActive: false });
      const inactive = await fx.trainee('Off', { isActive: false });
      const missing = randomUUID();
      const preview = (
        trainerId: string,
        traineeIds: string[],
        locationId: string,
      ) =>
        rejectionOf(
          fx.attendance.previewBatch({
            trainerId,
            traineeIds,
            locationId,
            trainedAt: TRAINED_AT,
          }),
        );

      expect((await preview(badTrainer.id, [missing], badLoc.id)).message).toBe(
        'Trainer not found or inactive',
      );
      const err = await preview(
        trainer.id,
        [ana.id, inactive.id, missing],
        badLoc.id,
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual({
        message: 'Some trainees are missing or inactive',
        invalidTraineeIds: [inactive.id, missing],
      });
      expect((await preview(trainer.id, [ana.id], badLoc.id)).message).toBe(
        'Location not found or inactive',
      );
      expect(await fx.attendanceRows()).toHaveLength(0);
    });

    it('ATT-44 the training date decides TIME cover; trainedDate + trainedTime are gym-local', async () => {
      const fx = fixtures();
      const { ana, trainer, loc } = await previewWorld(fx);
      // Starts at 00:00 Sofia on 1 Dec (22:00Z on 30 Nov).
      await fx.buy(ana.id, (await fx.timePlan(30, 6000)).id, {
        startsAt: '2025-11-30T22:00:00Z',
      });
      const on = (trainedDate: string, trainedTime?: string) =>
        fx.attendance.previewBatch({
          trainerId: trainer.id,
          locationId: loc.id,
          traineeIds: [ana.id],
          trainedDate,
          ...(trainedTime ? { trainedTime } : {}),
        });

      const before = await on('2025-11-30', '23:30');
      const after = await on('2025-12-01', '00:30');

      expect(before.trainedAt).toBe('2025-11-30T21:30:00.000Z');
      expect(before.trainees[0].paymentStatus).toBe(UNPAID);
      expect(after.trainedAt).toBe('2025-11-30T22:30:00.000Z');
      expect(after.trainees[0].paymentStatus).toBe(PAID);
    });
  });

  describe('lists', () => {
    it('ATT-30 listForTraineeByPaymentStatus filters, orders trainedAt/createdAt DESC and loads relations', async () => {
      const fx = fixtures();
      const { trainee, trainer, loc, attend } = await world(fx);
      const other = await fx.trainee('Other');
      const gym = await fx.gymSubscription('MultiSport');
      await fx.ds
        .getRepository(TraineeProfileEntity)
        .update(trainee.id, { gymSubscriptionId: gym.id });
      const sub = await fx.buy(trainee.id, (await fx.punchPlan(2, 0)).id);
      const paidOld = await attend('2025-12-01T10:00:00Z');
      const paidNewA = await attend('2025-12-05T10:00:00Z');
      const unpaidNewB = await attend('2025-12-05T10:00:00Z'); // same trainedAt, created later
      const unpaidOld = await attend('2025-11-01T10:00:00Z');
      await attend('2025-12-03T10:00:00Z', other.id);

      const all = await fx.attendance.listForTraineeByPaymentStatus(trainee.id);
      const paid = await fx.attendance.listForTraineeByPaymentStatus(
        trainee.id,
        PAID,
      );
      const unpaid = await fx.attendance.listForTraineeByPaymentStatus(
        trainee.id,
        UNPAID,
      );

      expect(all.map((a) => a.id)).toEqual([
        unpaidNewB.attendance.id,
        paidNewA.attendance.id,
        paidOld.attendance.id,
        unpaidOld.attendance.id,
      ]);
      expect(paid.map((a) => a.id)).toEqual([
        paidNewA.attendance.id,
        paidOld.attendance.id,
      ]);
      expect(unpaid.map((a) => a.id)).toEqual([
        unpaidNewB.attendance.id,
        unpaidOld.attendance.id,
      ]);
      const first = paid[0];
      expect(first.trainer).toMatchObject({ id: trainer.id, name: 'Coach' });
      expect(first.location).toMatchObject({ id: loc.id });
      expect(first.subscription).toMatchObject({ id: sub.id, type: 'PUNCH' });
      expect(first.gymSubscription).toMatchObject({ id: gym.id });
      expect(unpaid[0].subscription).toBeNull();
    });
  });
});
