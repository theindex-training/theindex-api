import { AttendancePaymentStatus } from '../../src/common/enums/attendance-payment-status.enum';
import { PlanType } from '../../src/common/enums/plan-type.enum';
import { PlanEntity } from '../../src/plans/plan.entity';
import { setupE2eSuite } from './e2e-app';

type Line = { trainerId: string; amountCents: number };

/**
 * Cross-cutting HTTP behavior (X-01..05): the `/api` prefix, the error body
 * shape, unvalidated path ids, query-param handling, and one end-to-end money
 * scenario that ties subscriptions, attendance, settlements and the cash
 * register together.
 */
describe('Cross-cutting (e2e)', () => {
  const ctx = setupE2eSuite();

  it('X-01 routes exist only under /api', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();

    await c.http().get('/health').expect(404);
    await c
      .http()
      .get('/plans')
      .set('Authorization', `Bearer ${admin}`)
      .expect(404);
    await c
      .http()
      .post('/auth/login')
      .send({ email: 'x', password: 'y' })
      .expect(404);
    // Control: the same routes under /api.
    await c.http().get('/api/health').expect(200);
    await c
      .http()
      .get('/api/plans')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
  });

  it('X-02 unknown body fields -> 400 { statusCode, message: string[], error }', async () => {
    const c = ctx();

    const res = await c
      .http()
      .post('/api/gym-locations')
      .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
      .send({ name: 'Main', capacity: 30 })
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: ['property capacity should not exist'],
      error: 'Bad Request',
    });
  });

  it('X-02 service errors use the same shape with a string message', async () => {
    const c = ctx();

    const res = await c
      .http()
      .get('/api/plans/7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b')
      .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
      .expect(404);

    expect(res.body).toEqual({
      statusCode: 404,
      message: 'Plan not found',
      error: 'Not Found',
    });
  });

  // CHARACTERIZATION: possibly unintended
  it.each([
    ['get', '/api/plans/abc'],
    ['get', '/api/trainees/abc'],
    ['delete', '/api/subscriptions/abc'],
    ['get', '/api/settlements/abc'],
  ] as const)(
    'X-03 non-UUID path id on %s %s reaches Postgres -> 500',
    async (method, path) => {
      const c = ctx();

      const res = await c
        .http()
        [method](path)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`);

      expect(res.status).toBe(500);
    },
  );

  it('X-05 plans/trainees/trainers ignore unknown query params (no DTO); gym-locations rejects them', async () => {
    const c = ctx();
    const admin = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    await c.trainee('Ivan');
    await c.trainer('Velcho');
    await c.punchPlan(5, 1000);

    for (const path of ['/api/plans', '/api/trainees', '/api/trainers']) {
      const res = await c.http().get(`${path}?foo=bar&page=2`).set(admin);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    }
    for (const path of ['/api/gym-locations', '/api/gym-subscriptions']) {
      await c.http().get(`${path}?foo=bar`).set(admin).expect(400);
    }
  });

  it('X-04 money scenario: balance = manual + paid subscriptions - finalized lines; lines match hand-computed values', async () => {
    const c = ctx();
    const admin = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const alice = await c.trainer('Alice');
    const bob = await c.trainer('Bob');
    const punchTrainee = await c.trainee('Pavel');
    const timeTrainee = await c.trainee('Teodora');
    const location = await c.location();
    const punch = await c.punchPlan(10, 10000); // 1000 per credit bought
    const time = await c.ds.getRepository(PlanEntity).save({
      type: PlanType.TIME,
      title: 'Month',
      priceCents: 9000,
      credits: null,
      durationDays: 30,
      isActive: true,
    });

    const attend = async (
      traineeId: string,
      trainerId: string,
      trainedAt: string,
    ) =>
      (
        await c
          .http()
          .post('/api/attendance')
          .set(admin)
          .send({ traineeId, trainerId, locationId: location.id, trainedAt })
          .expect(201)
      ).body as { attendance: { paymentStatus: string } };
    const buy = (traineeId: string, body: object) =>
      c
        .http()
        .post(`/api/trainees/${traineeId}/subscriptions`)
        .set(admin)
        .send(body)
        .expect(201);

    // 1. Opening cash.
    await c
      .http()
      .post('/api/cash-register/transactions/manual')
      .set(admin)
      .send({ direction: 'IN', amountCents: 50000, notes: 'float' })
      .expect(201);

    // 2. PUNCH: an unpaid visit, reconciled by the purchase, then a paid one.
    const unpaid = await attend(
      punchTrainee.id,
      alice.id,
      '2025-12-02T10:00:00.000Z',
    );
    expect(unpaid.attendance.paymentStatus).toBe('UNPAID');
    await buy(punchTrainee.id, { planId: punch.id });
    const paid = await attend(
      punchTrainee.id,
      bob.id,
      '2025-12-03T10:00:00.000Z',
    );
    expect(paid.attendance.paymentStatus).toBe('PAID');

    // 3. TIME pass for December 2025 (ended long before "now"), 3 visits.
    await buy(timeTrainee.id, {
      planId: time.id,
      startsAt: '2025-12-01T00:00:00.000Z',
    });
    await attend(timeTrainee.id, alice.id, '2025-12-05T10:00:00.000Z');
    await attend(timeTrainee.id, alice.id, '2025-12-10T10:00:00.000Z');
    await attend(timeTrainee.id, bob.id, '2025-12-15T10:00:00.000Z');
    expect(
      (await c.attendanceRows()).every(
        (a) => a.paymentStatus === AttendancePaymentStatus.PAID,
      ),
    ).toBe(true);
    expect(await c.balance()).toBe(50000 + 10000 + 9000);

    // 4. Settle December.
    const generated = await c
      .http()
      .post('/api/settlements')
      .set(admin)
      .send({ periodStart: '2025-12-01', periodEnd: '2025-12-31' })
      .expect(201);
    const { settlement, lines } = generated.body as {
      settlement: { id: string };
      lines: Line[];
    };
    // Alice: PUNCH 1000 + TIME 9000/3 * 2 = 7000. Bob: 1000 + 3000 = 4000.
    expect(
      lines.map((l) => ({
        trainerId: l.trainerId,
        amountCents: l.amountCents,
      })),
    ).toEqual([
      { trainerId: alice.id, amountCents: 7000 },
      { trainerId: bob.id, amountCents: 4000 },
    ]);

    await c
      .http()
      .post(`/api/settlements/${settlement.id}/finalize`)
      .set(admin)
      .expect(201);

    const register = await c
      .http()
      .get('/api/cash-register')
      .set(admin)
      .expect(200);
    const state = register.body as {
      balanceCents: number;
      transactions: { type: string; amountCents: number }[];
    };
    expect(state.balanceCents).toBe(50000 + 10000 + 9000 - 11000);
    expect(await c.balance()).toBe(58000);
    expect(
      state.transactions.map((t) => [t.type, t.amountCents]).sort(),
    ).toEqual(
      [
        ['MANUAL_IN', 50000],
        ['SUBSCRIPTION_IN', 10000],
        ['SUBSCRIPTION_IN', 9000],
        ['SETTLEMENT_OUT', -11000],
      ].sort(),
    );
  });
});
