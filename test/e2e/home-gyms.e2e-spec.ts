import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Home gyms over HTTP: a trainee's preferredGymId and a trainer's primaryGymId go through the
 * profile endpoints (the global ValidationPipe rejects undeclared fields, so the DTOs must
 * declare them). The rules are covered in `home-gym.int-spec.ts`.
 */
type Profile = { id: string; preferredGymId?: string; primaryGymId?: string };

describe('Home gyms (e2e)', () => {
  const ctx = setupE2eSuite();

  it("sets, keeps and clears a trainee's preferred gym through create and PATCH", async () => {
    const c = ctx();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const center = await c.location('Center');
    const north = await c.location('North');
    const existing = await c.trainee('Ana');

    const patched = await c
      .http()
      .patch(`/api/trainees/${existing.id}`)
      .set(auth)
      .send({ name: 'Ana', preferredGymId: north.id })
      .expect(200);
    expect((patched.body as Profile).preferredGymId).toBe(north.id);

    const created = await c
      .http()
      .post('/api/trainees')
      .set(auth)
      .send({ name: 'Boris', preferredGymId: center.id })
      .expect(201);
    expect((created.body as Profile).preferredGymId).toBe(center.id);

    const cleared = await c
      .http()
      .patch(`/api/trainees/${existing.id}`)
      .set(auth)
      .send({ name: 'Ana', preferredGymId: null })
      .expect(200);
    expect((cleared.body as Profile).preferredGymId).toBeNull();
  });

  it("sets a trainer's primary gym through create and PATCH, and GET returns it", async () => {
    const c = ctx();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const center = await c.location('Center');
    const existing = await c.trainer('Velcho');

    await c
      .http()
      .patch(`/api/trainers/${existing.id}`)
      .set(auth)
      .send({ name: 'Velcho', primaryGymId: center.id })
      .expect(200);
    const read = await c
      .http()
      .get(`/api/trainers/${existing.id}`)
      .set(auth)
      .expect(200);
    expect((read.body as Profile).primaryGymId).toBe(center.id);

    const created = await c
      .http()
      .post('/api/trainers')
      .set(auth)
      .send({ name: 'Vasko', primaryGymId: center.id })
      .expect(201);
    expect((created.body as Profile).primaryGymId).toBe(center.id);
  });

  it('validates the gym', async () => {
    const c = ctx();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const trainee = await c.trainee('Ana');

    expect(
      messageOf(
        (
          await c
            .http()
            .patch(`/api/trainees/${trainee.id}`)
            .set(auth)
            .send({ name: 'Ana', preferredGymId: 'nope' })
            .expect(400)
        ).body,
      ),
    ).toEqual(['preferredGymId must be a UUID']);
    expect(
      messageOf(
        (
          await c
            .http()
            .patch(`/api/trainees/${trainee.id}`)
            .set(auth)
            .send({
              name: 'Ana',
              preferredGymId: '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b',
            })
            .expect(400)
        ).body,
      ),
    ).toBe('Unknown gym');
  });
});
