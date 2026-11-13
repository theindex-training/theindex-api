import { NOT_LINKED_MESSAGE } from '../../src/auth/auth.service';
import { jwtPayload, messageOf, setupE2eSuite } from './e2e-app';

const PASSWORD = 'my-own-pass-1';

function registerBody(extra: object = {}) {
  return {
    email: 'ivan@e2e.test',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    name: 'Ivan Petrov',
    phone: '0888 123 456',
    acceptTerms: true,
    ...extra,
  };
}

/**
 * ACC-20..25 over HTTP: register, the 403 login, the admin connecting the account, the trainee's
 * "My details" (never the nickname) and deleting an unconnected account. The rules are in
 * `src/accounts/account-registration.int-spec.ts`.
 */
describe('Self-registration (e2e)', () => {
  const ctx = setupE2eSuite();

  it('ACC-20 register needs the consent, a phone and a name; unknown fields are 400', async () => {
    const c = ctx();

    const noConsent = await c
      .http()
      .post('/api/auth/register')
      .send(registerBody({ acceptTerms: false }))
      .expect(400);
    expect(messageOf(noConsent.body)).toEqual([
      'You must agree to the use of your personal data and to receiving emails',
    ]);

    const bare = {
      email: 'ivan@e2e.test',
      password: PASSWORD,
      confirmPassword: PASSWORD,
    };
    const missing = await c
      .http()
      .post('/api/auth/register')
      .send({ ...bare, nickname: 'Vanko' })
      .expect(400);
    expect(messageOf(missing.body)).toEqual(
      expect.arrayContaining([
        'property nickname should not exist',
        'name must be longer than or equal to 2 characters',
        'phone must be a phone number: 6 to 15 digits, optionally starting with +',
        'You must agree to the use of your personal data and to receiving emails',
      ]),
    );
  });

  it('ACC-20..25 register, wait, get connected by an admin, then log in and edit my details', async () => {
    const c = ctx();
    const gym = await c.location('Center');

    const options = await c
      .http()
      .get('/api/auth/register/options')
      .expect(200);
    expect(options.body).toEqual({
      gyms: [{ id: gym.id, name: 'Center' }],
      gymSubscriptions: [],
    });

    const registered = await c
      .http()
      .post('/api/auth/register')
      .send(registerBody({ preferredGymId: gym.id, instagram: '@ivan' }))
      .expect(201);
    const accountId = (registered.body as { id: string }).id;
    expect(registered.body).not.toHaveProperty('accessToken');

    const refused = await c
      .http()
      .post('/api/auth/login')
      .send({ email: 'ivan@e2e.test', password: PASSWORD })
      .expect(403);
    expect(messageOf(refused.body)).toBe(NOT_LINKED_MESSAGE);

    const admin = await c.loginAsAdmin();
    const list = await c
      .http()
      .get('/api/accounts')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect((list.body as object[])[0]).toMatchObject({
      id: accountId,
      registration: {
        name: 'Ivan Petrov',
        preferredGym: { id: gym.id, name: 'Center' },
        instagram: '@ivan',
      },
      profile: null,
    });
    expect(list.text).not.toContain('passwordHash');

    const linked = await c
      .http()
      .post(`/api/accounts/${accountId}/link`)
      .set('Authorization', `Bearer ${admin}`)
      .send({
        profileType: 'trainee',
        name: 'Ivan Petrov',
        nickname: 'Vanko',
        phone: '0888 123 456',
        homeGymId: gym.id,
        instagram: '@ivan',
      })
      .expect(200);
    expect(linked.body).toMatchObject({
      id: accountId,
      profile: { type: 'trainee', name: 'Ivan Petrov', nickname: 'Vanko' },
    });

    const token = await c.loginAs('ivan@e2e.test', PASSWORD);
    expect(jwtPayload(token)).toMatchObject({
      role: 'TRAINEE',
      traineeProfileId: (linked.body as { profile: { id: string } }).profile.id,
    });

    const mine = await c
      .http()
      .get('/api/my-profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body).toMatchObject({
      profileType: 'trainee',
      email: 'ivan@e2e.test',
      name: 'Ivan Petrov',
      homeGymId: gym.id,
      instagram: '@ivan',
    });
    expect(mine.text).not.toContain('Vanko');
    expect(mine.text).not.toContain('nickname');

    // The nickname and the name aren't theirs to change.
    const forbidden = await c
      .http()
      .patch('/api/my-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: 'Me', name: 'Other' })
      .expect(400);
    expect(messageOf(forbidden.body)).toEqual(
      expect.arrayContaining([
        'property nickname should not exist',
        'property name should not exist',
      ]),
    );

    // The phone can be changed but never cleared.
    await c
      .http()
      .patch('/api/my-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: null })
      .expect(400);
    const changed = await c
      .http()
      .patch('/api/my-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+359 88 999 0000', tiktok: '@ivan.trains' })
      .expect(200);
    expect(changed.body).toMatchObject({
      phone: '+359 88 999 0000',
      tiktok: '@ivan.trains',
    });
    expect(changed.text).not.toContain('Vanko');

    // Connected: no longer listed by default, and not deletable for good.
    await c
      .http()
      .get('/api/accounts')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200)
      .expect([]);
    await c
      .http()
      .delete(`/api/accounts/${accountId}/permanent`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(409);
  });

  it('ACC-24 an admin deletes an unconnected account for good', async () => {
    const c = ctx();
    const res = await c
      .http()
      .post('/api/auth/register')
      .send(registerBody())
      .expect(201);
    const id = (res.body as { id: string }).id;
    const admin = await c.loginAsAdmin();

    await c
      .http()
      .delete(`/api/accounts/${id}/permanent`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200)
      .expect({ id, deleted: true });
    await c
      .http()
      .get(`/api/accounts/${id}/details`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(404);
    await c
      .http()
      .post('/api/auth/login')
      .send({ email: 'ivan@e2e.test', password: PASSWORD })
      .expect(401);
  });
});
