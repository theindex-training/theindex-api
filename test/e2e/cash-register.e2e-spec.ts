import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Cash register over HTTP: ADMIN-only access (CR-10), the DTO rules that
 * encode business rules (CR-11) and the transactions' paging query (CR-13).
 * Balance/idempotency rules and the pages themselves (CR-12) are covered in
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
        total: number;
        transactions: unknown[];
      };
      expect(body.balanceCents).toBe(3500);
      expect(body.total).toBe(2);
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
  describe('CR-13 paging query', () => {
    it('CR-13 offset and limit from the query string page the transactions', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      for (const amount of [100, 200, 300]) {
        await seedBalance(admin, amount);
      }

      const res = await c
        .http()
        .get('/api/cash-register?offset=1&limit=1')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      const body = res.body as {
        balanceCents: number;
        total: number;
        limit: number;
        offset: number;
        transactions: { amountCents: number }[];
      };
      expect(body).toMatchObject({
        balanceCents: 600,
        total: 3,
        limit: 1,
        offset: 1,
      });
      expect(body.transactions.map((t) => t.amountCents)).toEqual([200]);
    });

    it.each([
      ['limit 0', 'limit=0'],
      ['limit over 500', 'limit=501'],
      ['negative offset', 'offset=-1'],
      ['non-integer limit', 'limit=2.5'],
      ['non-numeric offset', 'offset=abc'],
      ['unknown parameter', 'page=2'],
    ])('CR-13 %s -> 400', async (_label, query) => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .get(`/api/cash-register?${query}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(400);

      expect(Array.isArray(messageOf(res.body))).toBe(true);
    });

    it('CR-13 limit 500 is accepted', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .get('/api/cash-register?limit=500')
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect((res.body as { limit: number }).limit).toBe(500);
    });
  });
});
