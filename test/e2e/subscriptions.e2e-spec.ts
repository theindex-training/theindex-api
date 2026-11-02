import { AttendancePaymentStatus } from '../../src/common/enums/attendance-payment-status.enum';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Subscriptions over HTTP: DTO rules (SUB-06) and access (SUB-40, SUB-41).
 * Purchase/reconciliation/delete rules are covered in
 * `subscriptions.service.int-spec.ts`.
 */
describe('Subscriptions (e2e)', () => {
  const ctx = setupE2eSuite();

  describe('SUB-06 DTO', () => {
    it.each([
      ['non-UUID planId', { planId: 'not-a-uuid' }],
      ['negative paidCents', { paidCents: -1 }],
      ['non-integer paidCents', { paidCents: 10.5 }],
      ['string paidCents', { paidCents: '100' }],
      ['non-ISO startsAt', { startsAt: '10/12/2025' }],
      ['unknown field', { discountCents: 100 }],
    ])(
      'SUB-06 %s -> 400, no subscription and no cash',
      async (_label, patch) => {
        const c = ctx();
        const admin = await c.loginAsAdmin();
        const trainee = await c.trainee();
        const plan = await c.punchPlan(10, 10000);

        const res = await c
          .http()
          .post(`/api/trainees/${trainee.id}/subscriptions`)
          .set('Authorization', `Bearer ${admin}`)
          .send({ planId: plan.id, ...patch })
          .expect(400);

        expect(Array.isArray(messageOf(res.body))).toBe(true);
        expect(await c.subscriptionRows()).toHaveLength(0);
        expect(await c.cashTxs()).toHaveLength(0);
        expect(await c.balance()).toBe(0);
      },
    );

    it('SUB-06 control: a valid body with paidCents 0 and an ISO startsAt -> 201', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee();
      const plan = await c.punchPlan(10, 10000);

      const res = await c
        .http()
        .post(`/api/trainees/${trainee.id}/subscriptions`)
        .set('Authorization', `Bearer ${admin}`)
        .send({
          planId: plan.id,
          paidCents: 0,
          startsAt: '2025-12-10T08:00:00.000Z',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        traineeId: trainee.id,
        paidCents: 0,
        remainingCredits: 10,
        startsAt: '2025-12-10T08:00:00.000Z',
      });
      expect(await c.cashTxs()).toHaveLength(0);
    });
  });

  describe('SUB-40 create/delete access', () => {
    it.each(['ADMIN', 'TRAINER'] as const)(
      'SUB-40 %s can create (paid and paidCents 0) and delete subscriptions',
      async (role) => {
        const c = ctx();
        const trainee = await c.trainee();
        const plan = await c.punchPlan(10, 10000);
        const token =
          role === 'ADMIN'
            ? await c.loginAsAdmin()
            : await c.provisionAndLogin('trainer', (await c.trainer()).id);

        const paid = await c
          .http()
          .post(`/api/trainees/${trainee.id}/subscriptions`)
          .set('Authorization', `Bearer ${token}`)
          .send({ planId: plan.id })
          .expect(201);
        const free = await c
          .http()
          .post(`/api/trainees/${trainee.id}/subscriptions`)
          .set('Authorization', `Bearer ${token}`)
          .send({ planId: plan.id, paidCents: 0 })
          .expect(201);

        expect(await c.subscriptionRows()).toHaveLength(2);
        // Only the paid one moves cash.
        expect(await c.balance()).toBe(10000);
        expect(await c.cashTxs()).toHaveLength(1);

        for (const sub of [paid, free]) {
          await c
            .http()
            .delete(`/api/subscriptions/${(sub.body as { id: string }).id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
            .expect({ deleted: true });
        }
        expect(await c.subscriptionRows()).toHaveLength(0);
      },
    );

    it('SUB-40 TRAINEE -> 403 on create and delete (even for their own profile); nothing changes', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee();
      const plan = await c.punchPlan(10, 10000);
      const existing = await c
        .http()
        .post(`/api/trainees/${trainee.id}/subscriptions`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ planId: plan.id })
        .expect(201);
      const token = await c.provisionAndLogin('trainee', trainee.id);

      const create = await c
        .http()
        .post(`/api/trainees/${trainee.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ planId: plan.id, paidCents: 0 })
        .expect(403);
      const del = await c
        .http()
        .delete(`/api/subscriptions/${(existing.body as { id: string }).id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(create.body)).toBe('Forbidden resource');
      expect(messageOf(del.body)).toBe('Forbidden resource');
      expect(await c.subscriptionRows()).toHaveLength(1);
      expect(await c.balance()).toBe(10000);
    });

    it('SUB-40 anonymous -> 401 on create', async () => {
      const c = ctx();
      const trainee = await c.trainee();
      const plan = await c.punchPlan(10, 10000);

      await c
        .http()
        .post(`/api/trainees/${trainee.id}/subscriptions`)
        .send({ planId: plan.id })
        .expect(401);
      expect(await c.subscriptionRows()).toHaveLength(0);
    });
  });

  describe('SUB-41 TRAINEE list scope', () => {
    async function seedTwoTrainees() {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const own = await c.trainee('Own');
      const other = await c.trainee('Other');
      const plan = await c.punchPlan(10, 10000);
      for (const t of [own, other]) {
        await c
          .http()
          .post(`/api/trainees/${t.id}/subscriptions`)
          .set('Authorization', `Bearer ${admin}`)
          .send({ planId: plan.id })
          .expect(201);
      }
      return { own, other };
    }

    it('SUB-41 TRAINEE can list their own subscriptions -> 200 with only their rows', async () => {
      const c = ctx();
      const { own } = await seedTwoTrainees();
      const token = await c.provisionAndLogin('trainee', own.id);

      const res = await c
        .http()
        .get(`/api/trainees/${own.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const rows = res.body as { traineeId: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].traineeId).toBe(own.id);
    });

    it("SUB-41 TRAINEE listing another trainee's subscriptions -> 403 with the scope message", async () => {
      const c = ctx();
      const { own, other } = await seedTwoTrainees();
      const token = await c.provisionAndLogin('trainee', own.id);

      const res = await c
        .http()
        .get(`/api/trainees/${other.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINEE can only access subscriptions for their own trainee profile',
      );
    });

    it('SUB-41 TRAINEE token with traineeProfileId null -> 403', async () => {
      const c = ctx();
      const { own } = await seedTwoTrainees();
      const token = c.signToken({ role: 'TRAINEE', traineeProfileId: null });

      const res = await c
        .http()
        .get(`/api/trainees/${own.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINEE can only access subscriptions for their own trainee profile',
      );
    });

    it('SUB-41 TRAINER can list any trainee (scope check is TRAINEE-only)', async () => {
      const c = ctx();
      const { other } = await seedTwoTrainees();
      const token = await c.provisionAndLogin(
        'trainer',
        (await c.trainer()).id,
      );

      const res = await c
        .http()
        .get(`/api/trainees/${other.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  it('SUB-40 purchase over HTTP reconciles earlier UNPAID attendance (wiring check)', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const trainee = await c.trainee();
    const trainer = await c.trainer();
    const location = await c.location();
    const plan = await c.punchPlan(5, 5000);

    await c
      .http()
      .post('/api/attendance')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        traineeId: trainee.id,
        trainerId: trainer.id,
        locationId: location.id,
        trainedAt: '2025-12-01T10:00:00.000Z',
      })
      .expect(201);

    const res = await c
      .http()
      .post(`/api/trainees/${trainee.id}/subscriptions`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ planId: plan.id })
      .expect(201);

    expect(res.body).toMatchObject({ remainingCredits: 4 });
    const [att] = await c.attendanceRows();
    expect(att.paymentStatus).toBe(AttendancePaymentStatus.PAID);
    expect(att.subscriptionId).toBe((res.body as { id: string }).id);
  });
});
