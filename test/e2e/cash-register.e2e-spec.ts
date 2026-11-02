import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Cash register over HTTP: ADMIN-only access (CR-10) and the DTO rules that
 * encode business rules (CR-11). Balance/idempotency rules are covered in
 * `cash-register.service.int-spec.ts`.
 */
describe('Cash register (e2e)', () => {
  const ctx = setupE2eSuite();

  async function seedBalance(admin: string, amountCents: number) {
    await ctx()
      .http()
      .post('/api/cash-register/transactions/manual')
      .set('Authorization', `Bearer ${admin}`)
      .send({ direction: 'IN', amountCents })
      .expect(201);
  }

  describe('CR-10 ADMIN only', () => {
    it('CR-10 ADMIN can read the state and post manual IN/OUT', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      await seedBalance(admin, 5000);
      const out = await c
        .http()
        .post('/api/cash-register/transactions/manual')
        .set('Authorization', `Bearer ${admin}`)
        .send({ direction: 'OUT', amountCents: 1500, notes: 'Cleaning' })
        .expect(201);
      expect(out.body).toMatchObject({
        amountCents: -1500,
        balanceAfterCents: 3500,
        notes: 'Cleaning',
      });

      const state = await c
        .http()
        .get('/api/cash-register')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      const body = state.body as {
        balanceCents: number;
        transactions: unknown[];
      };
      expect(body.balanceCents).toBe(3500);
      expect(body.transactions).toHaveLength(2);
    });

    it.each(['TRAINER', 'TRAINEE'] as const)(
      'CR-10 %s -> 403 "Forbidden resource" on GET and on manual transactions; balance unchanged',
      async (role) => {
        const c = ctx();
        const admin = await c.loginAsAdmin();
        await seedBalance(admin, 5000);
        const token =
          role === 'TRAINER'
            ? await c.provisionAndLogin('trainer', (await c.trainer()).id)
            : await c.provisionAndLogin('trainee', (await c.trainee()).id);

        const get = await c
          .http()
          .get('/api/cash-register')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        const postIn = await c
          .http()
          .post('/api/cash-register/transactions/manual')
          .set('Authorization', `Bearer ${token}`)
          .send({ direction: 'IN', amountCents: 100 })
          .expect(403);
        const postOut = await c
          .http()
          .post('/api/cash-register/transactions/manual')
          .set('Authorization', `Bearer ${token}`)
          .send({ direction: 'OUT', amountCents: 5000 })
          .expect(403);

        for (const res of [get, postIn, postOut]) {
          expect(messageOf(res.body)).toBe('Forbidden resource');
        }
        expect(await c.balance()).toBe(5000);
        expect(await c.cashTxs()).toHaveLength(1);
      },
    );

    it('CR-10 anonymous -> 401 on both routes', async () => {
      const c = ctx();

      await c.http().get('/api/cash-register').expect(401);
      await c
        .http()
        .post('/api/cash-register/transactions/manual')
        .send({ direction: 'IN', amountCents: 100 })
        .expect(401);
      expect(await c.cashTxs()).toHaveLength(0);
    });
  });

  describe('CR-11 DTO', () => {
    it.each([
      ['direction not IN|OUT', { direction: 'in', amountCents: 100 }],
      ['missing direction', { amountCents: 100 }],
      ['amountCents 0', { direction: 'IN', amountCents: 0 }],
      ['negative amountCents', { direction: 'IN', amountCents: -100 }],
      ['non-integer amountCents', { direction: 'IN', amountCents: 10.5 }],
      ['string amountCents', { direction: 'IN', amountCents: '100' }],
      ['empty notes', { direction: 'IN', amountCents: 100, notes: '' }],
      ['unknown field', { direction: 'IN', amountCents: 100, source: 'x' }],
    ])('CR-11 %s -> 400, no tx and no balance change', async (_label, body) => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      await seedBalance(admin, 5000);

      const res = await c
        .http()
        .post('/api/cash-register/transactions/manual')
        .set('Authorization', `Bearer ${admin}`)
        .send(body)
        .expect(400);

      expect(Array.isArray(messageOf(res.body))).toBe(true);
      expect(await c.balance()).toBe(5000);
      expect(await c.cashTxs()).toHaveLength(1);
    });

    it('CR-11 amountCents 1 and notes omitted are accepted (stored notes null)', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .post('/api/cash-register/transactions/manual')
        .set('Authorization', `Bearer ${admin}`)
        .send({ direction: 'IN', amountCents: 1 })
        .expect(201);

      expect(res.body).toMatchObject({ amountCents: 1, notes: null });
      expect(await c.balance()).toBe(1);
    });

    it('CR-11 overdraw over HTTP -> 400 "Cash register balance cannot be negative" (service rule, not DTO)', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      await seedBalance(admin, 5000);

      const res = await c
        .http()
        .post('/api/cash-register/transactions/manual')
        .set('Authorization', `Bearer ${admin}`)
        .send({ direction: 'OUT', amountCents: 5001 })
        .expect(400);

      expect(messageOf(res.body)).toBe(
        'Cash register balance cannot be negative',
      );
      expect(await c.balance()).toBe(5000);
    });
  });
});
