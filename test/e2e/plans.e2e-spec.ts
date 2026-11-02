import { PlanType } from '../../src/common/enums/plan-type.enum';
import { PlanEntity } from '../../src/plans/plan.entity';
import { messageOf, setupE2eSuite } from './e2e-app';

type PlanBody = { id: string; title: string; isActive: boolean };

/**
 * Plans over HTTP: DTO-level create validation (PLN-03), `?active` parsing in
 * the controller (PLN-07) and access (PLN-08). The plan rules are covered in
 * `src/plans/plans.service.int-spec.ts`.
 */
describe('Plans (e2e)', () => {
  const ctx = setupE2eSuite();

  const planRepo = () => ctx().ds.getRepository(PlanEntity);

  function createPlan(token: string, body: object) {
    return ctx()
      .http()
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  describe('PLN-03 create validation', () => {
    it.each([
      [
        'PUNCH without credits',
        { type: 'PUNCH', title: 'P', priceCents: 1000 },
        'Punch plan requires credits',
      ],
      [
        'TIME without durationDays',
        { type: 'TIME', title: 'T', priceCents: 1000 },
        'Time plan requires durationDays',
      ],
    ])(
      'PLN-03 %s -> 400 with the service message (a string)',
      async (_label, body, message) => {
        const c = ctx();
        const res = await createPlan(await c.loginAsAdmin(), body).expect(400);

        expect(messageOf(res.body)).toBe(message);
        expect(await planRepo().count()).toBe(0);
      },
    );

    it.each([
      [
        'credits 0',
        { type: 'PUNCH', title: 'P', priceCents: 1000, credits: 0 },
        'credits must not be less than 1',
      ],
      [
        'durationDays 0',
        { type: 'TIME', title: 'T', priceCents: 1000, durationDays: 0 },
        'durationDays must not be less than 1',
      ],
      [
        'negative priceCents',
        { type: 'PUNCH', title: 'P', priceCents: -1, credits: 5 },
        'priceCents must not be less than 0',
      ],
      [
        'float priceCents',
        { type: 'PUNCH', title: 'P', priceCents: 10.5, credits: 5 },
        'priceCents must be an integer number',
      ],
      [
        'unknown type',
        { type: 'MONTHLY', title: 'P', priceCents: 1000, credits: 5 },
        'type must be one of the following values: PUNCH, TIME',
      ],
      [
        'empty title',
        { type: 'PUNCH', title: '', priceCents: 1000, credits: 5 },
        'title should not be empty',
      ],
    ])(
      'PLN-03 %s -> 400 from the DTO (array message)',
      async (_label, body, message) => {
        const c = ctx();
        const res = await createPlan(await c.loginAsAdmin(), body).expect(400);

        expect(messageOf(res.body)).toEqual([message]);
        expect(await planRepo().count()).toBe(0);
      },
    );

    it('PLN-03 control: priceCents 0 and credits 1 are accepted', async () => {
      const c = ctx();
      const res = await createPlan(await c.loginAsAdmin(), {
        type: 'PUNCH',
        title: 'Trial',
        priceCents: 0,
        credits: 1,
      }).expect(201);

      expect(res.body).toMatchObject({
        type: 'PUNCH',
        priceCents: 0,
        credits: 1,
        durationDays: null,
        isActive: true,
      });
    });

    // CHARACTERIZATION: possibly unintended
    it('PLN-03 a whitespace-only title passes the DTO and is stored as ""', async () => {
      const c = ctx();
      const res = await createPlan(await c.loginAsAdmin(), {
        type: 'PUNCH',
        title: '   ',
        priceCents: 1000,
        credits: 5,
      }).expect(201);

      const stored = await planRepo().findOneByOrFail({
        id: (res.body as PlanBody).id,
      });
      expect(stored.title).toBe('');
    });
  });

  describe('PLN-07 ?active parsing', () => {
    async function seedPlans() {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const make = (title: string, isActive: boolean) =>
        createPlan(admin, {
          type: PlanType.PUNCH,
          title,
          priceCents: 1000,
          credits: 5,
          isActive,
        }).expect(201);
      // Separate requests = separate transactions = distinct createdAt.
      await make('Old active', true);
      await make('Inactive', false);
      await make('New active', true);
      return admin;
    }

    async function titles(token: string, query: string) {
      const res = await ctx()
        .http()
        .get(`/api/plans${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return (res.body as PlanBody[]).map((p) => p.title);
    }

    it('PLN-07 no param -> all, newest first; true -> active only; false -> inactive only', async () => {
      const admin = await seedPlans();

      expect(await titles(admin, '')).toEqual([
        'New active',
        'Inactive',
        'Old active',
      ]);
      expect(await titles(admin, '?active=true')).toEqual([
        'New active',
        'Old active',
      ]);
      expect(await titles(admin, '?active=false')).toEqual(['Inactive']);
    });

    // CHARACTERIZATION: possibly unintended
    it.each(['yes', '1', 'TRUE', ''])(
      'PLN-07 ?active=%s is treated as false (inactive only), not 400',
      async (value) => {
        const admin = await seedPlans();

        expect(await titles(admin, `?active=${value}`)).toEqual(['Inactive']);
      },
    );
  });

  describe('PLN-08 not found and access', () => {
    it('PLN-08 unknown id -> 404 "Plan not found"', async () => {
      const c = ctx();
      const res = await c
        .http()
        .get('/api/plans/7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b')
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .expect(404);

      expect(messageOf(res.body)).toBe('Plan not found');
    });

    it('PLN-08 TRAINEE can list and get plans, incl. inactive ones', async () => {
      const c = ctx();
      const inactive = await planRepo().save({
        type: PlanType.PUNCH,
        title: 'Retired',
        priceCents: 1000,
        credits: 5,
        durationDays: null,
        isActive: false,
      });
      const token = await c.provisionAndLogin(
        'trainee',
        (await c.trainee()).id,
      );

      const list = await c
        .http()
        .get('/api/plans')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((list.body as PlanBody[]).map((p) => p.id)).toEqual([inactive.id]);
      const one = await c
        .http()
        .get(`/api/plans/${inactive.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(one.body).toMatchObject({ id: inactive.id, isActive: false });
    });

    it('PLN-08 TRAINEE -> 403 on create, update and delete; the plan is unchanged', async () => {
      const c = ctx();
      const plan = await c.punchPlan(5, 1000);
      const token = await c.provisionAndLogin(
        'trainee',
        (await c.trainee()).id,
      );
      const auth = { Authorization: `Bearer ${token}` };

      const responses = [
        await c.http().post('/api/plans').set(auth).send({
          type: 'PUNCH',
          title: 'Mine',
          priceCents: 0,
          credits: 99,
        }),
        await c
          .http()
          .patch(`/api/plans/${plan.id}`)
          .set(auth)
          .send({ priceCents: 0 }),
        await c.http().delete(`/api/plans/${plan.id}`).set(auth),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      expect(await planRepo().find()).toEqual([
        expect.objectContaining({
          id: plan.id,
          priceCents: 1000,
          isActive: true,
        }),
      ]);
    });

    it('PLN-08 TRAINER can create, update and deactivate plans', async () => {
      const c = ctx();
      const token = await c.provisionAndLogin(
        'trainer',
        (await c.trainer()).id,
      );
      const auth = { Authorization: `Bearer ${token}` };

      const created = await c
        .http()
        .post('/api/plans')
        .set(auth)
        .send({
          type: 'TIME',
          title: 'Month',
          priceCents: 5000,
          durationDays: 30,
        })
        .expect(201);
      const id = (created.body as PlanBody).id;
      await c
        .http()
        .patch(`/api/plans/${id}`)
        .set(auth)
        .send({ priceCents: 6000 })
        .expect(200);
      await c.http().delete(`/api/plans/${id}`).set(auth).expect(200);

      expect(await planRepo().findOneByOrFail({ id })).toMatchObject({
        priceCents: 6000,
        isActive: false,
      });
    });
  });
});
