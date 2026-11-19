import { SettlementStatus } from '../../src/settlements/enums/settlement-status.enum';
import { periodsDue } from '../../src/settlements/settlement-periods';
import { messageOf, setupE2eSuite } from './e2e-app';

type Line = { trainerId: string; amountCents: number };
type AllocationsBody = {
  total: number;
  rows: { trainerId: string; attendanceId: string }[];
};

/**
 * Settlements over HTTP: reports are created automatically (no route creates or deletes one),
 * allocation query validation (SET-35), finalizing in order (SET-44), attendance locked in a
 * finalized period (SET-53) and the TRAINER restrictions enforced in the controller
 * (SET-40..43). The settlement math itself is covered in `settlements.service.int-spec.ts`.
 */
describe('Settlements (e2e)', () => {
  const ctx = setupE2eSuite();

  /**
   * Two trainers, each with PAID PUNCH trainings in the first half of December 2025, and the
   * automatic report for that half. Everything but the report goes through HTTP.
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
    // Bought before the trainings (createdAt is the database clock).
    await c.allBoughtAt('2025-11-20T10:00:00.000Z');

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

    const settlementId = (await c.report('2025-12-01', '2025-12-15')).id;

    return { admin, trainerA, trainerB, trainee, location, settlementId };
  }

  it('SET-03 no route creates or deletes a report: POST /settlements and DELETE /settlements/:id -> 404', async () => {
    const c = ctx();
    const { admin, settlementId } = await seedDecember();
    const auth = { Authorization: `Bearer ${admin}` };

    await c
      .http()
      .post('/api/settlements')
      .set(auth)
      .send({ periodStart: '2025-12-01', periodEnd: '2025-12-31' })
      .expect(404);
    await c
      .http()
      .delete(`/api/settlements/${settlementId}`)
      .set(auth)
      .expect(404);

    expect(await c.settlementRows()).toHaveLength(1);
  });

  it('SET-45 POST /create-due (ADMIN) creates what the job would, then 409; TRAINER -> 403', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const trainer = await c.trainer('Alice');
    const trainerToken = await c.provisionAndLogin('trainer', trainer.id);
    // With no report yet, the job creates the half month that ended last.
    const [expected] = periodsDue(null, new Date());

    const forbidden = await c
      .http()
      .post('/api/settlements/create-due')
      .set('Authorization', `Bearer ${trainerToken}`)
      .expect(403);
    expect(messageOf(forbidden.body)).toBe('Forbidden resource');

    const res = await c
      .http()
      .post('/api/settlements/create-due')
      .set('Authorization', `Bearer ${admin}`)
      .expect(201);
    expect(res.body).toMatchObject({
      created: [{ ...expected, status: 'DRAFT', finalizedAt: null }],
    });

    const again = await c
      .http()
      .post('/api/settlements/create-due')
      .set('Authorization', `Bearer ${admin}`)
      .expect(409);
    expect(messageOf(again.body)).toMatch(
      new RegExp(
        `^The report for ${expected.periodStart} to ${expected.periodEnd} already exists; the next one`,
      ),
    );
    expect(await c.settlementRows()).toHaveLength(1);
  });

  it('SET-36 GET /:id answers the report, its lines and the trainings of the period still waiting', async () => {
    const c = ctx();
    const { admin, trainerA, trainerB, settlementId } = await seedDecember();

    const res = await c
      .http()
      .get(`/api/settlements/${settlementId}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);

    expect(res.body).toMatchObject({
      settlement: {
        id: settlementId,
        periodStart: '2025-12-01',
        periodEnd: '2025-12-15',
        status: 'DRAFT',
        finalizedAt: null,
      },
      lines: [
        {
          trainerId: trainerA.id,
          amountCents: 4000,
          attendanceCount: 2,
          punchCents: 4000,
          timeCents: 0,
          earlierPeriodsCents: 0,
          earlierPeriodsCount: 0,
          waitingCount: 0,
        },
        { trainerId: trainerB.id, amountCents: 2000 },
      ],
      waiting: [],
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

  it('SET-44 finalizing a newer report while an older one is a draft -> 409 with the older period', async () => {
    const c = ctx();
    const { admin } = await seedDecember();
    const newer = await c.report('2025-12-16', '2025-12-31');

    const res = await c
      .http()
      .post(`/api/settlements/${newer.id}/finalize`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(409);

    expect(messageOf(res.body)).toBe(
      'Finalize the report for 2025-12-01 to 2025-12-15 first',
    );
    expect(
      (await c.settlementRows()).every(
        (s) => s.status === SettlementStatus.DRAFT,
      ),
    ).toBe(true);
  });

  it('SET-53 once finalized, attendance dated in its period can be neither recorded nor deleted (409)', async () => {
    const c = ctx();
    const { admin, trainerA, trainee, location, settlementId } =
      await seedDecember();
    const auth = { Authorization: `Bearer ${admin}` };
    await c
      .http()
      .post(`/api/settlements/${settlementId}/finalize`)
      .set(auth)
      .expect(201);
    const message =
      "Attendance on or before 2025-12-15 is in a finalized settlement report and can't be changed";

    const create = await c
      .http()
      .post('/api/attendance')
      .set(auth)
      .send({
        traineeId: trainee.id,
        trainerId: trainerA.id,
        locationId: location.id,
        trainedAt: '2025-12-10T10:00:00.000Z',
      })
      .expect(409);
    expect(messageOf(create.body)).toBe(message);

    const [existing] = await c.attendanceRows();
    const remove = await c
      .http()
      .delete(`/api/attendance/${existing.id}`)
      .set(auth)
      .expect(409);
    expect(messageOf(remove.body)).toBe(message);
    expect(await c.attendanceRows()).toHaveLength(3);
  });

  describe('SET-40..43 TRAINER access', () => {
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

    it('SET-40 control: ADMIN can finalize (cash out)', async () => {
      const c = ctx();
      const { admin, settlementId } = await seedDecember();

      const res = await c
        .http()
        .post(`/api/settlements/${settlementId}/finalize`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(201);

      expect(res.body).toMatchObject({ id: settlementId, status: 'FINAL' });
      // 8000 in from the subscription, 3 × 2000 out.
      expect(await c.balance()).toBe(2000);
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

    it('SET-43 TRAINER GET /settlements lists all settlement headers (not filtered), drafts included', async () => {
      const c = ctx();
      const { trainerB } = await seedDecember();
      // A second report in which trainer B has no attendance at all.
      await c.report('2025-12-16', '2025-12-31');
      const tokenB = await c.provisionAndLogin('trainer', trainerB.id);

      const res = await c
        .http()
        .get('/api/settlements')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(
        (res.body as { periodStart: string; status: string }[]).map((s) => [
          s.periodStart,
          s.status,
        ]),
      ).toEqual([
        ['2025-12-16', 'DRAFT'],
        ['2025-12-01', 'DRAFT'],
      ]);
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
          .post(`/api/settlements/${settlementId}/finalize`)
          .set(auth),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      const [settlement] = await c.settlementRows();
      expect(settlement.status).toBe(SettlementStatus.DRAFT);
    });
  });
});
