import * as bcrypt from 'bcrypt';
import { AccountEntity } from '../../src/accounts/account.entity';
import { AccountRole } from '../../src/common/enums/account-role.enum';
import { AccountStatus } from '../../src/common/enums/account-status.enum';
import { GymSubscriptionEntity } from '../../src/gym-subscriptions/gym-subscription.entity';
import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';
import { jwtPayload, messageOf, setupE2eSuite } from './e2e-app';

const ADMIN_PASSWORD = 'password-123'; // what provisionAndLogin's admin sets

/**
 * The first-login setup of accounts an admin created (`/api/account-setup`): until it is done,
 * every other guarded route answers 403 ACCOUNT_SETUP_REQUIRED.
 */
describe('Account setup (e2e)', () => {
  const ctx = setupE2eSuite();
  const accounts = () => ctx().ds.getRepository(AccountEntity);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function freshTrainee(extra: Partial<TraineeProfileEntity> = {}) {
    const c = ctx();
    const trainee = await c.trainee('Ivan Petrov', {
      nickname: 'Vanko',
      phone: '0888 111 222',
      instagram: '@ivan',
      ...extra,
    });
    const token = await c.provisionAndLogin(
      'trainee',
      trainee.id,
      'Ivan.Petrov@E2E.test',
      { setUp: false },
    );
    return { trainee, token, accountId: String(jwtPayload(token).sub) };
  }

  function form(extra: Record<string, unknown> = {}) {
    return {
      email: 'ivan.petrov@e2e.test',
      name: 'Ivan Petrov',
      password: 'my-own-password',
      confirmPassword: 'my-own-password',
      phone: '0888 111 222',
      acceptTerms: true,
      ...extra,
    };
  }

  it('the login token says setup is required; /auth/me works, everything else is 403 ACCOUNT_SETUP_REQUIRED', async () => {
    const c = ctx();
    const { token } = await freshTrainee();

    expect(jwtPayload(token).setupRequired).toBe(true);
    await c.http().get('/api/auth/me').set(auth(token)).expect(200);

    for (const path of [
      '/api/my-profile',
      '/api/bookings/gyms',
      '/api/plans',
    ]) {
      const res = await c.http().get(path).set(auth(token)).expect(403);
      expect(res.body).toMatchObject({ error: 'ACCOUNT_SETUP_REQUIRED' });
    }
  });

  it('GET /account-setup prefills what the admin entered, never the nickname', async () => {
    const c = ctx();
    const gym = await c.location('Lozenets');
    const { token } = await freshTrainee({ preferredGymId: gym.id });

    const res = await c
      .http()
      .get('/api/account-setup')
      .set(auth(token))
      .expect(200);

    expect(res.body).toEqual({
      profileType: 'trainee',
      setupRequired: true,
      passwordChangeRequired: true,
      email: 'Ivan.Petrov@E2E.test',
      name: 'Ivan Petrov',
      phone: '0888 111 222',
      gymSubscriptionId: null,
      homeGymId: gym.id,
      instagram: '@ivan',
      facebook: null,
      tiktok: null,
    });
    expect(JSON.stringify(res.body)).not.toContain('Vanko');
  });

  it('POST saves the form, answers with a token that no longer requires setup, and unlocks the API', async () => {
    const c = ctx();
    const gym = await c.location('Lozenets');
    const card = await c.ds
      .getRepository(GymSubscriptionEntity)
      .save({ name: 'MultiSport', isActive: true });
    const { trainee, token, accountId } = await freshTrainee();
    const before = Date.now();

    const res = await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(
        form({
          name: '  Ivan G. Petrov ',
          phone: '+359 88 999 000',
          gymSubscriptionId: card.id,
          homeGymId: gym.id,
          instagram: '',
          tiktok: '@ivan.tt',
        }),
      )
      .expect(200);

    const body = res.body as { accessToken: string; account: { id: string } };
    expect(body.account.id).toBe(accountId);
    expect(jwtPayload(body.accessToken)).toMatchObject({
      sub: accountId,
      email: 'ivan.petrov@e2e.test',
      setupRequired: false,
    });

    const acc = await accounts().findOneByOrFail({ id: accountId });
    expect(acc.email).toBe('ivan.petrov@e2e.test');
    expect(acc.hasUpdatedInitialPassword).toBe(true);
    expect(acc.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await bcrypt.compare('my-own-password', acc.passwordHash!)).toBe(
      true,
    );

    const profile = await c.ds
      .getRepository(TraineeProfileEntity)
      .findOneByOrFail({ id: trainee.id });
    expect(profile).toMatchObject({
      name: 'Ivan G. Petrov',
      nickname: 'Vanko',
      phone: '+359 88 999 000',
      gymSubscriptionId: card.id,
      preferredGymId: gym.id,
      instagram: null,
      tiktok: '@ivan.tt',
    });

    // Both the new token and the one from before the setup now get through.
    await c
      .http()
      .get('/api/my-profile')
      .set(auth(body.accessToken))
      .expect(200);
    await c.http().get('/api/my-profile').set(auth(token)).expect(200);

    // The new password logs in; the admin's one no longer does.
    await c.loginAs('ivan.petrov@e2e.test', 'my-own-password');
    await c
      .http()
      .post('/api/auth/login')
      .send({ email: 'ivan.petrov@e2e.test', password: ADMIN_PASSWORD })
      .expect(401);

    // Done once: a second POST is 409.
    const again = await c
      .http()
      .post('/api/account-setup')
      .set(auth(body.accessToken))
      .send(form({ password: undefined, confirmPassword: undefined }))
      .expect(409);
    expect(messageOf(again.body)).toBe('Your account is already set up');
  });

  it.each([
    [
      { password: undefined, confirmPassword: undefined },
      'Choose a new password',
    ],
    [{ confirmPassword: 'something-else' }, 'Passwords do not match'],
    [
      { password: ADMIN_PASSWORD, confirmPassword: ADMIN_PASSWORD },
      'Choose a password different from the one you were given',
    ],
  ])(
    'a missing, mismatched or unchanged new password -> 400 %j, nothing saved',
    async (change, message) => {
      const c = ctx();
      const { token, accountId } = await freshTrainee();
      const before = await accounts().findOneByOrFail({ id: accountId });

      const res = await c
        .http()
        .post('/api/account-setup')
        .set(auth(token))
        .send(form(change))
        .expect(400);

      expect(messageOf(res.body)).toBe(message);
      const after = await accounts().findOneByOrFail({ id: accountId });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.consentAt).toBeNull();
    },
  );

  it('without the consent, or without a phone -> 400', async () => {
    const c = ctx();
    const { token } = await freshTrainee();

    for (const change of [
      { acceptTerms: false },
      { phone: undefined },
      { phone: '12' },
    ]) {
      await c
        .http()
        .post('/api/account-setup')
        .set(auth(token))
        .send(form(change))
        .expect(400);
    }
  });

  it('an email another account has, in any case -> 409, nothing saved', async () => {
    const c = ctx();
    await accounts().save({
      email: 'taken@e2e.test',
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      passwordHash: null,
    });
    const { token, accountId } = await freshTrainee();

    const res = await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form({ email: ' TAKEN@e2e.test ' }))
      .expect(409);

    expect(messageOf(res.body)).toBe(
      'Email is already used by another account',
    );
    expect(
      (await accounts().findOneByOrFail({ id: accountId })).consentAt,
    ).toBeNull();
  });

  it('an account that changed its password but never consented: consent and details only, the password is refused', async () => {
    const c = ctx();
    const { token, accountId } = await freshTrainee();
    await accounts().update(
      { id: accountId },
      { hasUpdatedInitialPassword: true },
    );
    const loginToken = await c.loginAs('Ivan.Petrov@E2E.test', ADMIN_PASSWORD);
    expect(jwtPayload(loginToken).setupRequired).toBe(true);

    const view = await c
      .http()
      .get('/api/account-setup')
      .set(auth(token))
      .expect(200);
    expect(view.body).toMatchObject({
      setupRequired: true,
      passwordChangeRequired: false,
    });

    const refused = await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form())
      .expect(400);
    expect(messageOf(refused.body)).toBe(
      'Your password has already been changed; use Change password to change it again',
    );

    await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form({ password: undefined, confirmPassword: undefined }))
      .expect(200);
    const acc = await accounts().findOneByOrFail({ id: accountId });
    expect(acc.consentAt).not.toBeNull();
    expect(await bcrypt.compare(ADMIN_PASSWORD, acc.passwordHash!)).toBe(true);
  });

  it('a trainer: the primary gym is set, a gym subscription is 400', async () => {
    const c = ctx();
    const gym = await c.location('Center');
    const card = await c.ds
      .getRepository(GymSubscriptionEntity)
      .save({ name: 'MultiSport', isActive: true });
    const trainer = await c.trainer('Maria');
    const token = await c.provisionAndLogin(
      'trainer',
      trainer.id,
      'maria@e2e.test',
      {
        setUp: false,
      },
    );
    expect(jwtPayload(token).setupRequired).toBe(true);
    await c
      .http()
      .get('/api/schedules?gymId=' + gym.id)
      .set(auth(token))
      .expect(403);

    const base = { email: 'maria@e2e.test', name: 'Maria' };
    const refused = await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form({ ...base, gymSubscriptionId: card.id }))
      .expect(400);
    expect(messageOf(refused.body)).toBe('Trainers have no gym subscription');

    await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form({ ...base, homeGymId: gym.id }))
      .expect(200);
    const saved = await c.ds
      .getRepository(TrainerProfileEntity)
      .findOneByOrFail({ id: trainer.id });
    expect(saved).toMatchObject({
      primaryGymId: gym.id,
      phone: '0888 111 222',
    });
  });

  it('a gym subscription that is no longer offered stays when sent unchanged', async () => {
    const c = ctx();
    const old = await c.ds
      .getRepository(GymSubscriptionEntity)
      .save({ name: 'Old card', isActive: false });
    const { trainee, token } = await freshTrainee({
      gymSubscriptionId: old.id,
    });

    await c
      .http()
      .post('/api/account-setup')
      .set(auth(token))
      .send(form({ gymSubscriptionId: old.id }))
      .expect(200);
    const saved = await c.ds
      .getRepository(TraineeProfileEntity)
      .findOneByOrFail({ id: trainee.id });
    expect(saved.gymSubscriptionId).toBe(old.id);
  });

  it('a self-registered account, once connected, never needs the setup', async () => {
    const c = ctx();
    const trainee = await c.trainee('Petya');
    await c
      .http()
      .post('/api/auth/register')
      .send({
        email: 'petya@e2e.test',
        password: 'petya-password',
        confirmPassword: 'petya-password',
        name: 'Petya',
        phone: '0888123456',
        acceptTerms: true,
      })
      .expect(201);
    await accounts().update(
      { email: 'petya@e2e.test' },
      { traineeProfileId: trainee.id },
    );

    const token = await c.loginAs('petya@e2e.test', 'petya-password');
    expect(jwtPayload(token).setupRequired).toBe(false);
    await c.http().get('/api/my-profile').set(auth(token)).expect(200);
  });
});
