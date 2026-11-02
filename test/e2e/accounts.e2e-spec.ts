import * as bcrypt from 'bcrypt';
import { AccountEntity } from '../../src/accounts/account.entity';
import { AccountStatus } from '../../src/common/enums/account-status.enum';
import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';
import { E2E_ADMIN, jwtPayload, messageOf, setupE2eSuite } from './e2e-app';

const SANITIZED_KEYS = [
  'id',
  'email',
  'role',
  'status',
  'hasUpdatedInitialPassword',
  'trainerProfileId',
  'traineeProfileId',
  'createdAt',
  'updatedAt',
].sort();

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

/**
 * Accounts over HTTP: provisioning a DISABLED account (ACC-05), GET shape
 * (ACC-13), TRAINEE self-scoping (ACC-14), the TRAINER escalation (ACC-15),
 * route resolution (ACC-16) and the business-rule DTO checks (ACC-17).
 * The service rules are covered in `src/accounts/accounts.service.int-spec.ts`.
 */
describe('Accounts (e2e)', () => {
  const ctx = setupE2eSuite();

  const accountRepo = () => ctx().ds.getRepository(AccountEntity);

  async function adminSession() {
    const res = await ctx()
      .http()
      .post('/api/auth/login')
      .send(E2E_ADMIN)
      .expect(201);
    const body = res.body as { accessToken: string; account: { id: string } };
    return { token: body.accessToken, id: body.account.id };
  }

  function provisionBody(email: string, extra: object = {}) {
    return {
      email,
      role: 'TRAINER',
      status: 'ACTIVE',
      password: 'password-123',
      confirmPassword: 'password-123',
      ...extra,
    };
  }

  it('ACC-05 an account provisioned with status DISABLED cannot log in', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const trainer = await c.trainer();

    const res = await c
      .http()
      .post(`/api/accounts/trainer/${trainer.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send(provisionBody('off@e2e.test', { status: 'DISABLED' }))
      .expect(201);
    expect(res.body).toMatchObject({ status: 'DISABLED' });

    const login = await c
      .http()
      .post('/api/auth/login')
      .send({ email: 'off@e2e.test', password: 'password-123' })
      .expect(401);
    expect(messageOf(login.body)).toBe('Account is not active (DISABLED)');
  });

  describe('ACC-13 GET /accounts/:id', () => {
    it('ACC-13 returns exactly the sanitized account (no passwordHash)', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee();
      const token = await c.provisionAndLogin(
        'trainee',
        trainee.id,
        'ivan@e2e.test',
      );
      const id = String(jwtPayload(token).sub);

      const res = await c
        .http()
        .get(`/api/accounts/${id}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);

      expect(Object.keys(res.body as object).sort()).toEqual(SANITIZED_KEYS);
      expect(res.body).toMatchObject({
        id,
        email: 'ivan@e2e.test',
        role: 'TRAINEE',
        traineeProfileId: trainee.id,
      });
      expect(res.text).not.toContain('passwordHash');
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-13 an unknown id -> 200 with an empty body, not 404', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      const res = await c
        .http()
        .get(`/api/accounts/${UNKNOWN_ID}`)
        .set('Authorization', `Bearer ${admin}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe('');
    });
  });

  describe('ACC-14 TRAINEE scoping', () => {
    async function seedTrainee() {
      const c = ctx();
      const admin = await adminSession();
      const trainee = await c.trainee();
      const token = await c.provisionAndLogin('trainee', trainee.id);
      return { admin, token, ownId: String(jwtPayload(token).sub), trainee };
    }

    it('ACC-14 TRAINEE can read password-status and change the password of their own account', async () => {
      const c = ctx();
      const { token, ownId, trainee } = await seedTrainee();

      await c
        .http()
        .get(`/api/accounts/${ownId}/password-status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect({ accountId: ownId, hasUpdatedInitialPassword: false });

      await c
        .http()
        .post(`/api/accounts/${ownId}/change-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'password-123',
          newPassword: 'new-password-1',
          confirmPassword: 'new-password-1',
          phone: ' 0888 ',
        })
        .expect(201)
        .expect({ accountId: ownId, hasUpdatedInitialPassword: true });

      const acc = await accountRepo().findOneByOrFail({ id: ownId });
      expect(await bcrypt.compare('new-password-1', acc.passwordHash!)).toBe(
        true,
      );
      const profile = await c.ds
        .getRepository(TraineeProfileEntity)
        .findOneByOrFail({ id: trainee.id });
      expect(profile.phone).toBe('0888');
    });

    it("ACC-14 TRAINEE -> 403 on another account's password endpoints; nothing changes", async () => {
      const c = ctx();
      const { admin, token } = await seedTrainee();
      const before = await accountRepo().findOneByOrFail({ id: admin.id });

      const status = await c
        .http()
        .get(`/api/accounts/${admin.id}/password-status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      const change = await c
        .http()
        .post(`/api/accounts/${admin.id}/change-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          newPassword: 'hijacked-pass',
          confirmPassword: 'hijacked-pass',
          phone: '0888',
        })
        .expect(403);

      const message =
        'TRAINEE can only access their own account password endpoints';
      expect(messageOf(status.body)).toBe(message);
      expect(messageOf(change.body)).toBe(message);
      const after = await accountRepo().findOneByOrFail({ id: admin.id });
      expect(after.passwordHash).toBe(before.passwordHash);
      await c.loginAsAdmin();
    });

    it('ACC-14 TRAINEE -> 403 "Forbidden resource" on PATCH, DELETE, GET and provision, even for their own id', async () => {
      const c = ctx();
      const { token, ownId } = await seedTrainee();
      const trainer = await c.trainer();
      const auth = { Authorization: `Bearer ${token}` };

      const responses = [
        await c
          .http()
          .patch(`/api/accounts/${ownId}`)
          .set(auth)
          .send({ status: 'DISABLED' }),
        await c.http().delete(`/api/accounts/${ownId}`).set(auth),
        await c.http().get(`/api/accounts/${ownId}`).set(auth),
        await c
          .http()
          .post(`/api/accounts/trainer/${trainer.id}`)
          .set(auth)
          .send(provisionBody('sneaky@e2e.test')),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      const own = await accountRepo().findOneByOrFail({ id: ownId });
      expect(own.status).toBe(AccountStatus.ACTIVE);
      expect(await accountRepo().count()).toBe(2); // admin + trainee
    });
  });

  describe('ACC-15 TRAINER can act on any account (security)', () => {
    // CHARACTERIZATION: possibly unintended
    it('ACC-15 TRAINER resets the ADMIN password without the current one and logs in as ADMIN', async () => {
      const c = ctx();
      const admin = await adminSession();
      const trainer = await c.trainer();
      const trainerToken = await c.provisionAndLogin('trainer', trainer.id);

      await c
        .http()
        .post(`/api/accounts/${admin.id}/change-password`)
        .set('Authorization', `Bearer ${trainerToken}`)
        // The seeded admin hasn't changed the initial password, so a phone
        // is required (and discarded, see ACC-10).
        .send({
          newPassword: 'taken-over-1',
          confirmPassword: 'taken-over-1',
          phone: '0888',
        })
        .expect(201)
        .expect({ accountId: admin.id, hasUpdatedInitialPassword: true });

      const takeover = await c
        .http()
        .post('/api/auth/login')
        .send({ email: E2E_ADMIN.email, password: 'taken-over-1' })
        .expect(201);
      expect(
        jwtPayload((takeover.body as { accessToken: string }).accessToken),
      ).toMatchObject({ sub: admin.id, role: 'ADMIN' });
      // The real admin is locked out.
      await c.http().post('/api/auth/login').send(E2E_ADMIN).expect(401);
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-15 TRAINER can PATCH (email/password/status) and DELETE an ADMIN account, and provision accounts', async () => {
      const c = ctx();
      const admin = await adminSession();
      const trainer = await c.trainer();
      const other = await c.trainer('Other');
      const trainerToken = await c.provisionAndLogin('trainer', trainer.id);
      const auth = { Authorization: `Bearer ${trainerToken}` };

      const patched = await c
        .http()
        .patch(`/api/accounts/${admin.id}`)
        .set(auth)
        .send({
          email: 'renamed-admin@e2e.test',
          password: 'patched-pass-1',
          confirmPassword: 'patched-pass-1',
        })
        .expect(200);
      expect(patched.body).toMatchObject({
        id: admin.id,
        role: 'ADMIN',
        email: 'renamed-admin@e2e.test',
      });
      await c
        .http()
        .post('/api/auth/login')
        .send({ email: 'renamed-admin@e2e.test', password: 'patched-pass-1' })
        .expect(201);

      const deleted = await c
        .http()
        .delete(`/api/accounts/${admin.id}`)
        .set(auth)
        .expect(200);
      expect(deleted.body).toMatchObject({ id: admin.id, status: 'DISABLED' });
      await c
        .http()
        .patch(`/api/accounts/${admin.id}`)
        .set(auth)
        .send({ status: 'ACTIVE' })
        .expect(200);

      const provisioned = await c
        .http()
        .post(`/api/accounts/trainer/${other.id}`)
        .set(auth)
        .send(provisionBody('other@e2e.test'))
        .expect(201);
      expect(provisioned.body).toMatchObject({
        role: 'TRAINER',
        trainerProfileId: other.id,
      });
    });
  });

  describe('ACC-16 route resolution', () => {
    it('ACC-16 POST /accounts/trainer/change-password is the change-password route, not provisioning', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();

      // A provisioning body is validated against ChangePasswordDto.
      const res = await c
        .http()
        .post('/api/accounts/trainer/change-password')
        .set('Authorization', `Bearer ${admin}`)
        .send(provisionBody('x@e2e.test'))
        .expect(400);

      expect(messageOf(res.body)).toEqual(
        expect.arrayContaining([
          'property email should not exist',
          'property role should not exist',
          'newPassword must be a string',
        ]),
      );
      expect(await accountRepo().count()).toBe(1);
    });

    it('ACC-16 control: POST /accounts/trainer/:uuid provisions', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainer = await c.trainer();

      await c
        .http()
        .post(`/api/accounts/trainer/${trainer.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send(provisionBody('t@e2e.test'))
        .expect(201);

      const linked = await c.ds
        .getRepository(TrainerProfileEntity)
        .findOneByOrFail({ id: trainer.id });
      expect(linked.accountId).not.toBeNull();
    });

    it('ACC-16 the routes used in tests.md do not exist (404)', async () => {
      const c = ctx();
      const admin = await adminSession();
      const trainer = await c.trainer();

      await c
        .http()
        .post(`/api/accounts/provision/trainer/${trainer.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(provisionBody('t@e2e.test'))
        .expect(404);
      await c
        .http()
        .patch(`/api/accounts/${admin.id}/status`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'DISABLED' })
        .expect(404);

      expect(await accountRepo().count()).toBe(1);
    });
  });

  describe('ACC-17 DTO business rules', () => {
    it.each([
      ['short password', { password: 'short-7', confirmPassword: 'short-7' }],
      ['invalid email', { email: 'not-an-email' }],
      ['unknown role', { role: 'OWNER' }],
      ['unknown status', { status: 'PAUSED' }],
    ])('ACC-17 provision with %s -> 400, no account', async (_label, patch) => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainer = await c.trainer();

      const res = await c
        .http()
        .post(`/api/accounts/trainer/${trainer.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send(provisionBody('t@e2e.test', patch))
        .expect(400);

      expect(Array.isArray(messageOf(res.body))).toBe(true);
      expect(await accountRepo().count()).toBe(1);
    });

    it.each([
      ['short password', { password: 'short-7', confirmPassword: 'short-7' }],
      ['invalid email', { email: 'not-an-email' }],
      ['unknown status', { status: 'PAUSED' }],
    ])('ACC-17 update with %s -> 400, unchanged', async (_label, patch) => {
      const c = ctx();
      const admin = await adminSession();
      const before = await accountRepo().findOneByOrFail({ id: admin.id });

      const res = await c
        .http()
        .patch(`/api/accounts/${admin.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(patch)
        .expect(400);

      expect(Array.isArray(messageOf(res.body))).toBe(true);
      const after = await accountRepo().findOneByOrFail({ id: admin.id });
      expect(after).toMatchObject({
        email: before.email,
        status: before.status,
        passwordHash: before.passwordHash,
      });
    });

    it('ACC-17 change-password with a new password shorter than 8 -> 400, unchanged', async () => {
      const c = ctx();
      const admin = await adminSession();
      const before = await accountRepo().findOneByOrFail({ id: admin.id });

      const res = await c
        .http()
        .post(`/api/accounts/${admin.id}/change-password`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          currentPassword: E2E_ADMIN.password,
          newPassword: 'short-7',
          confirmPassword: 'short-7',
          phone: '0888',
        })
        .expect(400);

      expect(messageOf(res.body)).toEqual([
        'newPassword must be longer than or equal to 8 characters',
        'confirmPassword must be longer than or equal to 8 characters',
      ]);
      const after = await accountRepo().findOneByOrFail({ id: admin.id });
      expect(after.passwordHash).toBe(before.passwordHash);
    });

    it('ACC-17 control: an 8-character password is accepted on provision', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainer = await c.trainer();

      await c
        .http()
        .post(`/api/accounts/trainer/${trainer.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send(
          provisionBody('t@e2e.test', {
            password: 'exactly8',
            confirmPassword: 'exactly8',
          }),
        )
        .expect(201);
      await c.loginAs('t@e2e.test', 'exactly8');
    });
  });
});
