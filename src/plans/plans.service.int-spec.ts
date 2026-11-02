import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlanEntity } from './plan.entity';
import { PlansModule } from './plans.module';
import { PlansService } from './plans.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('PlansService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [PlansModule] });

  const svc = (fx: Fixtures) => fx.moduleRef.get(PlansService);
  const planRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(PlanEntity).findOneByOrFail({ id });

  async function expectBadRequest(promise: Promise<unknown>, message: string) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(message);
  }

  describe('create', () => {
    it('PLN-01 PUNCH: credits stored, durationDays forced to null, title trimmed, active by default', async () => {
      const fx = fixtures();

      const plan = await svc(fx).create({
        type: PlanType.PUNCH,
        title: '  10 trainings  ',
        priceCents: 12000,
        credits: 10,
        durationDays: 30,
      });

      const expected = {
        type: PlanType.PUNCH,
        title: '10 trainings',
        priceCents: 12000,
        credits: 10,
        durationDays: null,
        isActive: true,
      };
      expect(plan).toMatchObject(expected);
      expect(await planRow(fx, plan.id)).toMatchObject(expected);
    });

    it('PLN-01 an explicit isActive: false is stored', async () => {
      const fx = fixtures();

      const plan = await svc(fx).create({
        type: PlanType.PUNCH,
        title: 'Hidden',
        priceCents: 0,
        credits: 1,
        isActive: false,
      });

      expect((await planRow(fx, plan.id)).isActive).toBe(false);
    });

    it('PLN-02 TIME: durationDays stored, credits forced to null', async () => {
      const fx = fixtures();

      const plan = await svc(fx).create({
        type: PlanType.TIME,
        title: 'Monthly',
        priceCents: 9000,
        credits: 12,
        durationDays: 30,
      });

      const expected = {
        type: PlanType.TIME,
        title: 'Monthly',
        priceCents: 9000,
        credits: null,
        durationDays: 30,
        isActive: true,
      };
      expect(plan).toMatchObject(expected);
      expect(await planRow(fx, plan.id)).toMatchObject(expected);
    });

    it('PLN-03 PUNCH without credits / TIME without durationDays -> 400, nothing stored', async () => {
      const fx = fixtures();

      await expectBadRequest(
        svc(fx).create({ type: PlanType.PUNCH, title: 'P', priceCents: 100 }),
        'Punch plan requires credits',
      );
      // credits: 0 never reaches the service over HTTP (DTO Min(1)), but the
      // service rejects it with the same message.
      await expectBadRequest(
        svc(fx).create({
          type: PlanType.PUNCH,
          title: 'P',
          priceCents: 100,
          credits: 0,
        }),
        'Punch plan requires credits',
      );
      // A durationDays does not make a PUNCH plan valid.
      await expectBadRequest(
        svc(fx).create({
          type: PlanType.PUNCH,
          title: 'P',
          priceCents: 100,
          durationDays: 30,
        }),
        'Punch plan requires credits',
      );
      await expectBadRequest(
        svc(fx).create({
          type: PlanType.TIME,
          title: 'T',
          priceCents: 100,
          credits: 10,
        }),
        'Time plan requires durationDays',
      );

      expect(await fx.ds.getRepository(PlanEntity).count()).toBe(0);
    });

    // CHARACTERIZATION: possibly unintended
    it('PLN-03 a whitespace-only title passes the DTO and is stored as an empty string', async () => {
      const fx = fixtures();
      const body = {
        type: PlanType.PUNCH,
        title: '   ',
        priceCents: 100,
        credits: 1,
      };

      const dtoErrors = await validate(plainToInstance(CreatePlanDto, body));
      expect(dtoErrors).toEqual([]);

      const plan = await svc(fx).create(body);

      expect((await planRow(fx, plan.id)).title).toBe('');
    });
  });

  describe('update', () => {
    it('PLN-04 partial update changes only the sent fields (title trimmed)', async () => {
      const fx = fixtures();
      const plan = await fx.punchPlan(10, 12000, { title: 'Ten' });

      await svc(fx).update(plan.id, { priceCents: 15000 });
      expect(await planRow(fx, plan.id)).toMatchObject({
        type: PlanType.PUNCH,
        title: 'Ten',
        priceCents: 15000,
        credits: 10,
        durationDays: null,
        isActive: true,
      });

      await svc(fx).update(plan.id, { title: '  Ten+  ', isActive: false });
      expect(await planRow(fx, plan.id)).toMatchObject({
        title: 'Ten+',
        priceCents: 15000,
        credits: 10,
        isActive: false,
      });
    });

    it('PLN-04 PUNCH -> TIME needs durationDays, else 400 and the row is unchanged', async () => {
      const fx = fixtures();
      const plan = await fx.punchPlan(10, 12000);

      await expectBadRequest(
        svc(fx).update(plan.id, { type: PlanType.TIME }),
        'Time plan requires durationDays',
      );
      expect(await planRow(fx, plan.id)).toMatchObject({
        type: PlanType.PUNCH,
        credits: 10,
        durationDays: null,
      });

      const updated = await svc(fx).update(plan.id, {
        type: PlanType.TIME,
        durationDays: 30,
      });

      const expected = { type: PlanType.TIME, credits: null, durationDays: 30 };
      expect(updated).toMatchObject(expected);
      expect(await planRow(fx, plan.id)).toMatchObject(expected);
    });

    it('PLN-04 PUNCH -> TIME accepts a durationDays already stored on the row', async () => {
      const fx = fixtures();
      // Only reachable by direct insert: the service always nulls it for PUNCH.
      const plan = await fx.punchPlan(10, 12000, { durationDays: 14 });

      await svc(fx).update(plan.id, { type: PlanType.TIME });

      expect(await planRow(fx, plan.id)).toMatchObject({
        type: PlanType.TIME,
        credits: null,
        durationDays: 14,
      });
    });

    it('PLN-04 TIME -> PUNCH needs credits, and the switch clears durationDays', async () => {
      const fx = fixtures();
      const plan = await fx.timePlan(30, 9000);

      await expectBadRequest(
        svc(fx).update(plan.id, { type: PlanType.PUNCH }),
        'Punch plan requires credits',
      );
      expect((await planRow(fx, plan.id)).type).toBe(PlanType.TIME);

      await svc(fx).update(plan.id, { type: PlanType.PUNCH, credits: 8 });

      expect(await planRow(fx, plan.id)).toMatchObject({
        type: PlanType.PUNCH,
        credits: 8,
        durationDays: null,
      });
    });

    it('PLN-04 credits: null on a PUNCH plan -> 400; durationDays: null on TIME -> 400', async () => {
      const fx = fixtures();
      const punch = await fx.punchPlan(10, 12000);
      const time = await fx.timePlan(30, 9000);

      await expectBadRequest(
        svc(fx).update(punch.id, { credits: null }),
        'Punch plan requires credits',
      );
      await expectBadRequest(
        svc(fx).update(time.id, { durationDays: null }),
        'Time plan requires durationDays',
      );

      expect((await planRow(fx, punch.id)).credits).toBe(10);
      expect((await planRow(fx, time.id)).durationDays).toBe(30);
    });

    it('PLN-04 credits sent for a TIME plan are silently dropped', async () => {
      const fx = fixtures();
      const plan = await fx.timePlan(30, 9000);

      const updated = await svc(fx).update(plan.id, { credits: 12 });

      expect(updated.credits).toBeNull();
      expect(await planRow(fx, plan.id)).toMatchObject({
        type: PlanType.TIME,
        credits: null,
        durationDays: 30,
      });
    });

    it('PLN-04 durationDays sent for a PUNCH plan are silently dropped', async () => {
      const fx = fixtures();
      const plan = await fx.punchPlan(10, 12000);

      await svc(fx).update(plan.id, { durationDays: 30 });

      expect(await planRow(fx, plan.id)).toMatchObject({
        credits: 10,
        durationDays: null,
      });
    });

    it('PLN-05 changing price/credits/duration does not touch existing subscriptions', async () => {
      const fx = fixtures();
      const trainee = await fx.trainee('Ana');
      const punch = await fx.punchPlan(10, 12000);
      const time = await fx.timePlan(30, 9000);
      const punchSub = await fx.buy(trainee.id, punch.id);
      const timeSub = await fx.buy(trainee.id, time.id, {
        startsAt: '2025-12-01T10:00:00.000Z',
      });

      await svc(fx).update(punch.id, { priceCents: 20000, credits: 20 });
      await svc(fx).update(time.id, { priceCents: 15000, durationDays: 60 });

      expect(await fx.sub(punchSub.id)).toMatchObject({
        paidCents: 12000,
        initialCredits: 10,
        remainingCredits: 10,
      });
      const storedTime = await fx.sub(timeSub.id);
      expect(storedTime.paidCents).toBe(9000);
      expect(storedTime.endsAt!.toISOString()).toBe(
        new Date(
          Date.parse('2025-12-01T10:00:00.000Z') + 30 * DAY_MS,
        ).toISOString(),
      );

      // New purchases do use the new plan values.
      const newPunch = await fx.buy(trainee.id, punch.id);
      expect(newPunch).toMatchObject({
        paidCents: 20000,
        initialCredits: 20,
      });
    });

    it('PLN-08 unknown id -> 404 Plan not found (getById, update, deactivate)', async () => {
      const fx = fixtures();
      const id = randomUUID();

      for (const call of [
        () => svc(fx).getById(id),
        () => svc(fx).update(id, { priceCents: 1 }),
        () => svc(fx).deactivate(id),
      ]) {
        const err = await rejectionOf(call());
        expect(err).toBeInstanceOf(NotFoundException);
        expect(err.message).toBe('Plan not found');
      }
    });
  });

  describe('deactivate / list', () => {
    it('PLN-06 deactivate keeps the row, blocks new purchases, existing subs keep paying', async () => {
      const fx = fixtures();
      const [trainee, trainer, loc] = await Promise.all([
        fx.trainee('Ana'),
        fx.trainer('Coach'),
        fx.location(),
      ]);
      const plan = await fx.punchPlan(5, 5000);
      const sub = await fx.buy(trainee.id, plan.id);

      const result = await svc(fx).deactivate(plan.id);

      expect(result).toMatchObject({ id: plan.id, isActive: false });
      expect(await planRow(fx, plan.id)).toMatchObject({
        isActive: false,
        credits: 5,
        priceCents: 5000,
      });
      expect(await svc(fx).getById(plan.id)).toMatchObject({ isActive: false });

      const err = await rejectionOf(fx.buy(trainee.id, plan.id));
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Plan not found or inactive');
      expect(await fx.subscriptionRows()).toHaveLength(1);

      const { attendance } = await fx.attend(
        trainee.id,
        trainer.id,
        loc.id,
        '2025-12-01T10:00:00.000Z',
      );
      expect(attendance).toMatchObject({
        paymentStatus: AttendancePaymentStatus.PAID,
        subscriptionId: sub.id,
      });
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 4,
        status: SubscriptionStatus.ACTIVE,
      });
    });

    it('PLN-07 list: active=true / false / undefined, ordered createdAt DESC', async () => {
      const fx = fixtures();
      // Separate saves = separate transactions, so createdAt increases.
      const a = await fx.punchPlan(1, 100, { title: 'A' });
      const b = await fx.timePlan(30, 100, { title: 'B', isActive: false });
      const c = await fx.punchPlan(2, 100, { title: 'C' });
      const d = await fx.timePlan(60, 100, { title: 'D', isActive: false });

      const ids = (plans: PlanEntity[]) => plans.map((p) => p.id);
      expect(ids(await svc(fx).list())).toEqual([d.id, c.id, b.id, a.id]);
      expect(ids(await svc(fx).list(true))).toEqual([c.id, a.id]);
      expect(ids(await svc(fx).list(false))).toEqual([d.id, b.id]);
    });
  });
});
