import { GymLocationEntity } from '../../src/gym-locations/gym-location.entity';
import { GymSubscriptionEntity } from '../../src/gym-subscriptions/gym-subscription.entity';
import { messageOf, setupE2eSuite } from './e2e-app';

type Named = { id: string; name: string };

/**
 * Gym locations and gym subscriptions over HTTP: the `includeInactive` query
 * DTO (GL-02) and the missing reactivation path (GL-03). Both resources share
 * the same controller shape, so each case runs against both. Service rules
 * are covered in the two `*.service.int-spec.ts` files.
 */
describe('Gym locations and gym subscriptions (e2e)', () => {
  const ctx = setupE2eSuite();

  const resources = [
    ['gym-locations', GymLocationEntity],
    ['gym-subscriptions', GymSubscriptionEntity],
  ] as const;

  /** One active and one inactive row, inserted directly. */
  async function seed(entity: (typeof resources)[number][1]) {
    const repo = ctx().ds.getRepository<{
      id: string;
      name: string;
      isActive: boolean;
    }>(entity);
    const active = await repo.save({ name: 'Active', isActive: true });
    const inactive = await repo.save({ name: 'Inactive', isActive: false });
    return { repo, active, inactive };
  }

  describe.each(resources)('%s', (resource, entity) => {
    async function list(query: string) {
      const c = ctx();
      return c
        .http()
        .get(`/api/${resource}${query}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`);
    }

    it.each([
      ['no param', '', ['Active']],
      ['includeInactive=false', '?includeInactive=false', ['Active']],
      ['includeInactive=true', '?includeInactive=true', ['Active', 'Inactive']],
    ])('GL-02 %s -> 200 %j', async (_label, query, expected) => {
      await seed(entity);

      const res = await list(query);

      expect(res.status).toBe(200);
      expect((res.body as Named[]).map((r) => r.name).sort()).toEqual(expected);
    });

    it.each([
      ['a non-boolean string', '?includeInactive=yes'],
      ['an unknown query param', '?active=true'],
    ])('GL-02 %s -> 400 (query DTO)', async (_label, query) => {
      await seed(entity);

      const res = await list(query);

      expect(res.status).toBe(400);
      expect(Array.isArray(messageOf(res.body))).toBe(true);
    });

    // CHARACTERIZATION: possibly unintended
    it('GL-02 includeInactive=1 passes the DTO but is treated as false', async () => {
      await seed(entity);

      const res = await list('?includeInactive=1');

      expect(res.status).toBe(200);
      expect((res.body as Named[]).map((r) => r.name)).toEqual(['Active']);
    });

    // CHARACTERIZATION: possibly unintended
    it('GL-03 there is no way to reactivate: PATCH { isActive: true } -> 400, still inactive', async () => {
      const c = ctx();
      const { repo, inactive } = await seed(entity);

      const res = await c
        .http()
        .patch(`/api/${resource}/${inactive.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ isActive: true })
        .expect(400);

      expect(messageOf(res.body)).toEqual([
        'property isActive should not exist',
      ]);
      expect((await repo.findOneByOrFail({ id: inactive.id })).isActive).toBe(
        false,
      );
    });

    it('GL-03 control: PATCH { name } on an inactive row works and keeps it inactive', async () => {
      const c = ctx();
      const { repo, inactive } = await seed(entity);

      await c
        .http()
        .patch(`/api/${resource}/${inactive.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(await repo.findOneByOrFail({ id: inactive.id })).toMatchObject({
        name: 'Renamed',
        isActive: false,
      });
    });
  });
});
