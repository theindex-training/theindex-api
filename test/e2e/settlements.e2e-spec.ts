import { SettlementStatus } from '../../src/settlements/enums/settlement-status.enum';
import { messageOf, setupE2eSuite } from './e2e-app';

type Line = { trainerId: string; amountCents: number };
type AllocationsBody = {
  total: number;
  rows: { trainerId: string; attendanceId: string }[];
};

/**
 * Settlements over HTTP: period validation (SET-03), allocation query
 * validation (SET-35) and the TRAINER restrictions enforced in the
 * controller (SET-40..43). The settlement math itself is covered in
 * `settlements.service.int-spec.ts`.
 */
describe('Settlements (e2e)', () => {
  const ctx = setupE2eSuite();

  /**
   * Two trainers, each with PAID PUNCH attendance in December 2025, and a
   * cash balance big enough to finalize. Everything goes through HTTP.
   */
  async function seedDecember() {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const trainerA = await c.trainer('Alice');
    const trainerB = await c.trainer('Bob');
    const trainee = await c.trainee('Tom');
    const location = await c.location();
    const plan = await c.punchPlan(4, 8000); // 2000 per credit

    await c
      .http()
      .post(`/api/trainees/${trainee.id}/subscriptions`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ planId: plan.id })
      .expect(201);

    const attend = (trainerId: string, trainedAt: string) =>
      c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: trainee.id,
          trainerId,
          locationId: location.id,
          trainedAt,
        })
        .expect(201);

    await attend(trainerA.id, '2025-12-02T10:00:00.000Z');
    await attend(trainerA.id, '2025-12-03T10:00:00.000Z');
    await attend(trainerB.id, '2025-12-04T10:00:00.000Z');

    const generated = await c
      .http()
      .post('/api/settlements')
      .set('Authorization', `Bearer ${admin}`)
      .send({ periodStart: '2025-12-01', periodEnd: '2025-12-31' })
      .expect(201);
    const settlementId = (generated.body as { settlement: { id: string } })
      .settlement.id;

    return { admin, trainerA, trainerB, settlementId };
  }

  describe('SET-03 period validation', () => {
    it('SET-03 periodStart after periodEnd -> 400 "from must be <= to", nothing persisted', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .post('/api/settlements')
        .set('Authorization', `Bearer ${admin}`)
        .send({ periodStart: '2025-12-02', periodEnd: '2025-12-01' })
        .expect(400);

      expect(messageOf(res.body)).toBe('from must be <= to');
      expect(await c.settlementRows()).toHaveLength(0);
    });

    it('SET-03 periodStart == periodEnd is a valid one-day period -> 201 DRAFT', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .post('/api/settlements')
        .set('Authorization', `Bearer ${admin}`)
        .send({ periodStart: '2025-12-01', periodEnd: '2025-12-01' })
        .expect(201);

      const body = res.body as {
        settlement: { periodStart: string; periodEnd: string; status: string };
      };
      expect(body.settlement).toMatchObject({
        periodStart: '2025-12-01',
        periodEnd: '2025-12-01',
        status: SettlementStatus.DRAFT,
      });
      expect(await c.settlementRows()).toHaveLength(1);
    });

    it.each([
      ['2025-12-1', '2025-12-31'],
      ['2025-12-01', '31.12.2025'],
      ['2025-12-01T00:00:00Z', '2025-12-31'],
    ])(
      'SET-03 non-YYYY-MM-DD period (%s .. %s) -> 400 from the DTO',
      async (periodStart, periodEnd) => {
        const c = ctx();
        const admin = await c.loginAsAdmin();

        const res = await c
          .http()
          .post('/api/settlements')
          .set('Authorization', `Bearer ${admin}`)
          .send({ periodStart, periodEnd })
          .expect(400);

        expect(Array.isArray(messageOf(res.body))).toBe(true);
        expect(await c.settlementRows()).toHaveLength(0);
      },
    );

    // CHARACTERIZATION: possibly unintended
    it('SET-03 impossible date 2025-02-30 passes validation but Postgres rejects it -> 500, nothing persisted', async () => {
      // The plan expected a silent rollover to 2025-03-02. Observed instead:
      // getLocalDateInterval rolls it over (new Date(2025, 1, 30) is valid),
      // then the `date` column insert fails, so the client gets a 500.
      const c = ctx();
      const admin = await c.loginAsAdmin();

      await c
        .http()
        .post('/api/settlements')
        .set('Authorization', `Bearer ${admin}`)
        .send({ periodStart: '2025-02-01', periodEnd: '2025-02-30' })
        .expect(500);

      expect(await c.settlementRows()).toHaveLength(0);
    });
  });

  describe('SET-35 allocation query validation', () => {
    it.each([
      ['limit=0'],
      ['limit=501'],
      ['offset=-1'],
      ['limit=abc'],
      ['offset=1.5'],
      ['trainerId=not-a-uuid'],
      ['unknown=1'],
    ])('SET-35 %s -> 400', async (query) => {
      const c = ctx();
      const { admin, settlementId } = await seedDecember();

      await c
        .http()
        .get(`/api/settlements/${settlementId}/allocations?${query}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(400);
    });

    it('SET-35 numeric strings are coerced: limit=1&offset=1 returns the 2nd row, total counts all', async () => {
      const c = ctx();
      const { admin, settlementId } = await seedDecember();

      const all = await c
        .http()
        .get(`/api/settlements/${settlementId}/allocations`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      const page = await c
        .http()
        .get(`/api/settlements/${settlementId}/allocations?limit=1&offset=1`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      const allBody = all.body as AllocationsBody;
      const pageBody = page.body as AllocationsBody;
      expect(allBody.total).toBe(3);
      expect(pageBody.total).toBe(3);
      expect(pageBody.rows).toHaveLength(1);
      expect(pageBody.rows[0].attendanceId).toBe(allBody.rows[1].attendanceId);
    });

    it('SET-35 limit=500 (the max) is accepted', async () => {
      const c = ctx();
      const { admin, settlementId } = await seedDecember();

      const res = await c
        .http()
        .get(`/api/settlements/${settlementId}/allocations?limit=500`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect((res.body as AllocationsBody).rows).toHaveLength(3);
    });
  });

  describe('SET-40..43 TRAINER access', () => {
    it('SET-40 TRAINER cannot generate a settlement -> 403 with the handler message, nothing persisted', async () => {
      const c = ctx();
      const trainer = await c.trainer('Alice');
      const token = await c.provisionAndLogin('trainer', trainer.id);

      const res = await c
        .http()
        .post('/api/settlements')
        .set('Authorization', `Bearer ${token}`)
        .send({ periodStart: '2025-12-01', periodEnd: '2025-12-31' })
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINER cannot generate settlement reports',
      );
      expect(await c.settlementRows()).toHaveLength(0);
    });

    it('SET-40 TRAINER cannot finalize -> 403, settlement stays DRAFT and no cash moves', async () => {
      const c = ctx();
      const { trainerA, settlementId } = await seedDecember();
      const token = await c.provisionAndLogin('trainer', trainerA.id);
      const balanceBefore = await c.balance();
      const txsBefore = (await c.cashTxs()).length;

      const res = await c
        .http()
        .post(`/api/settlements/${settlementId}/finalize`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINER cannot finalize settlement reports',
      );
      const [settlement] = await c.settlementRows();
      expect(settlement.status).toBe(SettlementStatus.DRAFT);
      expect(await c.balance()).toBe(balanceBefore);
      expect(await c.cashTxs()).toHaveLength(txsBefore);
    });

    it('SET-40 TRAINER cannot delete -> 403, settlement, lines and allocations remain', async () => {
      const c = ctx();
      const { trainerA, settlementId } = await seedDecember();
      const token = await c.provisionAndLogin('trainer', trainerA.id);

      const res = await c
        .http()
        .delete(`/api/settlements/${settlementId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINER cannot delete settlement reports',
      );
      expect(await c.settlementRows()).toHaveLength(1);
      expect(await c.linesOf(settlementId)).toHaveLength(2);
      expect(await c.allocationsOf(settlementId)).toHaveLength(3);
    });

    it('SET-40 control: ADMIN can finalize (cash out) and delete', async () => {
      const c = ctx();
      const { admin, settlementId } = await seedDecember();

      await c
        .http()
        .post(`/api/settlements/${settlementId}/finalize`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);
      // 8000 in from the subscription, 3 × 2000 out.
      expect(await c.balance()).toBe(2000);

      await c
        .http()
        .delete(`/api/settlements/${settlementId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200)
        .expect({ deleted: true });
      expect(await c.settlementRows()).toHaveLength(0);
    });

    it('SET-41 TRAINER GET /:id sees only their own line; ADMIN sees all lines', async () => {
      const c = ctx();
      const { admin, trainerA, trainerB, settlementId } = await seedDecember();
      const tokenA = await c.provisionAndLogin('trainer', trainerA.id);

      const asTrainer = await c
        .http()
        .get(`/api/settlements/${settlementId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const asAdmin = await c
        .http()
        .get(`/api/settlements/${settlementId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      const trainerLines = (asTrainer.body as { lines: Line[] }).lines;
      expect(trainerLines).toHaveLength(1);
      expect(trainerLines[0]).toMatchObject({
        trainerId: trainerA.id,
        amountCents: 4000,
      });

      const adminLines = (asAdmin.body as { lines: Line[] }).lines;
      expect(adminLines.map((l) => l.trainerId).sort()).toEqual(
        [trainerA.id, trainerB.id].sort(),
      );
    });

    it('SET-41 TRAINER token without trainerProfileId -> 403 "Trainer profile is required for this action"', async () => {
      const c = ctx();
      const { settlementId } = await seedDecember();
      const token = c.signToken({ role: 'TRAINER', trainerProfileId: null });

      const res = await c
        .http()
        .get(`/api/settlements/${settlementId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'Trainer profile is required for this action',
      );
    });

    it('SET-42 TRAINER allocations: ?trainerId=<other> is overridden with their own id', async () => {
      const c = ctx();
      const { trainerA, trainerB, settlementId } = await seedDecember();
      const tokenA = await c.provisionAndLogin('trainer', trainerA.id);

      const res = await c
        .http()
        .get(
          `/api/settlements/${settlementId}/allocations?trainerId=${trainerB.id}`,
        )
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = res.body as AllocationsBody;
      expect(body.total).toBe(2);
      expect(body.rows).toHaveLength(2);
      expect(body.rows.every((r) => r.trainerId === trainerA.id)).toBe(true);
    });

    it('SET-42 TRAINER allocations without trainerProfileId -> 403', async () => {
      const c = ctx();
      const { settlementId } = await seedDecember();
      const token = c.signToken({ role: 'TRAINER', trainerProfileId: null });

      const res = await c
        .http()
        .get(`/api/settlements/${settlementId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'Trainer profile is required for this action',
      );
    });

    it('SET-43 TRAINER GET /settlements lists all settlement headers (not filtered)', async () => {
      const c = ctx();
      const { admin, trainerB } = await seedDecember();
      // A second settlement in which trainer B has no attendance at all.
      await c
        .http()
        .post('/api/settlements')
        .set('Authorization', `Bearer ${admin}`)
        .send({ periodStart: '2026-01-01', periodEnd: '2026-01-31' })
        .expect(201);
      const tokenB = await c.provisionAndLogin('trainer', trainerB.id);

      const res = await c
        .http()
        .get('/api/settlements')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const periods = (res.body as { periodStart: string }[])
        .map((s) => s.periodStart)
        .sort();
      expect(periods).toEqual(['2025-12-01', '2026-01-01']);
    });

    it('SET-40..43 TRAINEE -> 403 "Forbidden resource" on every settlements route', async () => {
      const c = ctx();
      const { settlementId } = await seedDecember();
      const trainee = await c.trainee('Other');
      const token = await c.provisionAndLogin('trainee', trainee.id);
      const auth = { Authorization: `Bearer ${token}` };

      // Sequential: parallel supertest calls each start a server and can reset.
      const responses = [
        await c.http().get('/api/settlements').set(auth),
        await c.http().get(`/api/settlements/${settlementId}`).set(auth),
        await c
          .http()
          .get(`/api/settlements/${settlementId}/allocations`)
          .set(auth),
        await c
          .http()
          .post('/api/settlements')
          .set(auth)
          .send({ periodStart: '2025-11-01', periodEnd: '2025-11-30' }),
        await c
          .http()
          .post(`/api/settlements/${settlementId}/finalize`)
          .set(auth),
        await c.http().delete(`/api/settlements/${settlementId}`).set(auth),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      const [settlement] = await c.settlementRows();
      expect(settlement.status).toBe(SettlementStatus.DRAFT);
      expect(await c.settlementRows()).toHaveLength(1);
    });
  });
});
