import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AccountEntity } from '../../src/accounts/account.entity';
import { AccountRole } from '../../src/common/enums/account-role.enum';
import { AccountStatus } from '../../src/common/enums/account-status.enum';
import { decodeVerifiedJwt } from '../int/auth-setup';
import {
  E2E_ADMIN,
  E2E_JWT_SECRET,
  jwtPayload,
  messageOf,
  setupE2eSuite,
} from './e2e-app';

type LoginBody = {
  accessToken: string;
  account: Record<string, unknown>;
};

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

/**
 * Login and JWT over HTTP: passport guards, LoginDto, `/auth/me`
 * (AUTH-01..09). `validateUser`/`login` themselves are covered in
 * `src/auth/auth.service.int-spec.ts`; the route x role matrix is in
 * `role-matrix.e2e-spec.ts` (AUTH-11).
 */
describe('Auth (e2e)', () => {
  const ctx = setupE2eSuite();

  const login = (body: object) =>
    ctx().http().post('/api/auth/login').send(body);

  /** Inserts an account directly, for states the API can't produce. */
  async function insertAccount(row: Partial<AccountEntity>) {
    return ctx()
      .ds.getRepository(AccountEntity)
      .save({
        email: 'direct@e2e.test',
        role: AccountRole.TRAINER,
        status: AccountStatus.ACTIVE,
        passwordHash: await bcrypt.hash('direct-pass-1', 4),
        ...row,
      });
  }

  describe('login', () => {
    it('AUTH-01 success -> 201 { accessToken, account } with exactly the sanitized account keys', async () => {
      const c = ctx();
      const trainee = await c.trainee('Ivan');
      await c.provisionAndLogin('trainee', trainee.id, 'ivan@e2e.test');

      const res = await login({
        email: 'ivan@e2e.test',
        password: 'password-123',
      }).expect(201);
      const body = res.body as LoginBody;

      expect(Object.keys(body).sort()).toEqual(['accessToken', 'account']);
      expect(Object.keys(body.account).sort()).toEqual(
        [
          'id',
          'email',
          'role',
          'status',
          'hasUpdatedInitialPassword',
          'trainerProfileId',
          'traineeProfileId',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(body.account).toMatchObject({
        email: 'ivan@e2e.test',
        role: 'TRAINEE',
        status: 'ACTIVE',
        hasUpdatedInitialPassword: false,
        trainerProfileId: null,
        traineeProfileId: trainee.id,
      });
      expect(res.text).not.toContain('passwordHash');
    });

    it('AUTH-02 JWT has exactly the contract claims, null profile ids, signed with JWT_SECRET, 7 days', async () => {
      const c = ctx();
      const trainer = await c.trainer();
      const trainerToken = await c.provisionAndLogin('trainer', trainer.id);
      const res = await login(E2E_ADMIN).expect(201);
      const { accessToken, account } = res.body as LoginBody;

      const { header, payload } = decodeVerifiedJwt(
        accessToken,
        E2E_JWT_SECRET,
      );
      expect(header.alg).toBe('HS256');
      expect(Object.keys(payload).sort()).toEqual(
        [
          'sub',
          'email',
          'role',
          'trainerProfileId',
          'traineeProfileId',
          'iat',
          'exp',
        ].sort(),
      );
      expect(payload).toMatchObject({
        sub: account.id,
        email: E2E_ADMIN.email,
        role: 'ADMIN',
        trainerProfileId: null,
        traineeProfileId: null,
      });
      expect((payload.exp as number) - (payload.iat as number)).toBe(
        SEVEN_DAYS_S,
      );

      expect(jwtPayload(trainerToken)).toMatchObject({
        role: 'TRAINER',
        trainerProfileId: trainer.id,
        traineeProfileId: null,
      });
    });

    it('AUTH-03 wrong password and unknown email both -> 401 "Invalid credentials"', async () => {
      for (const body of [
        { email: E2E_ADMIN.email, password: 'wrong-password' },
        { email: 'nobody@e2e.test', password: E2E_ADMIN.password },
      ]) {
        const res = await login(body).expect(401);
        expect(messageOf(res.body)).toBe('Invalid credentials');
        expect(res.body).not.toHaveProperty('accessToken');
      }
    });

    it('AUTH-04 DISABLED account -> 401 "Account is not active (DISABLED)"', async () => {
      await insertAccount({ status: AccountStatus.DISABLED });

      const res = await login({
        email: 'direct@e2e.test',
        password: 'direct-pass-1',
      }).expect(401);

      expect(messageOf(res.body)).toBe('Account is not active (DISABLED)');
    });

    // CHARACTERIZATION: possibly unintended
    it('AUTH-04 a wrong password on a DISABLED account also reveals the status', async () => {
      await insertAccount({ status: AccountStatus.DISABLED });

      const res = await login({
        email: 'direct@e2e.test',
        password: 'wrong-password',
      }).expect(401);

      expect(messageOf(res.body)).toBe('Account is not active (DISABLED)');
    });

    it('AUTH-05 account with no password hash -> 401 "Account has no password set"', async () => {
      await insertAccount({ passwordHash: null });

      const res = await login({
        email: 'direct@e2e.test',
        password: 'anything-1',
      }).expect(401);

      expect(messageOf(res.body)).toBe('Account has no password set');
    });

    it.each([
      ['missing email', { password: E2E_ADMIN.password }],
      ['missing password', { email: E2E_ADMIN.email }],
      ['empty body', {}],
    ])(
      'AUTH-06 %s -> 401 from passport-local (guard runs before the DTO)',
      async (_label, body) => {
        const res = await login(body).expect(401);
        expect(messageOf(res.body)).toBe('Unauthorized');
      },
    );

    it('AUTH-06 valid credentials + an unknown body field -> 400 from the DTO', async () => {
      const res = await login({ ...E2E_ADMIN, rememberMe: true }).expect(400);

      expect(messageOf(res.body)).toEqual([
        'property rememberMe should not exist',
      ]);
    });

    it('AUTH-06 unknown body field with wrong credentials -> 401 (auth first)', async () => {
      const res = await login({
        email: E2E_ADMIN.email,
        password: 'wrong-password',
        rememberMe: true,
      }).expect(401);

      expect(messageOf(res.body)).toBe('Invalid credentials');
    });

    // CHARACTERIZATION: possibly unintended
    it('AUTH-06 valid credentials with a password shorter than 3 chars -> 400 (MinLength runs after auth)', async () => {
      await insertAccount({ passwordHash: await bcrypt.hash('ab', 4) });

      const ok = await login({ email: 'direct@e2e.test', password: 'ab' });
      const wrong = await login({ email: 'direct@e2e.test', password: 'xy' });

      expect(ok.status).toBe(400);
      expect(messageOf(ok.body)).toEqual([
        'password must be longer than or equal to 3 characters',
      ]);
      // A wrong short password fails in the guard, before the DTO.
      expect(wrong.status).toBe(401);
      expect(messageOf(wrong.body)).toBe('Invalid credentials');
    });

    it('AUTH-07 email lookup is exact: case-sensitive and not trimmed', async () => {
      for (const email of [
        E2E_ADMIN.email.toUpperCase(),
        ` ${E2E_ADMIN.email}`,
        `${E2E_ADMIN.email} `,
      ]) {
        const res = await login({
          email,
          password: E2E_ADMIN.password,
        }).expect(401);
        expect(messageOf(res.body)).toBe('Invalid credentials');
      }
      await login(E2E_ADMIN).expect(201);
    });
  });

  describe('/auth/me and token checks', () => {
    it('AUTH-08 GET /auth/me returns the JWT payload as-is, incl. iat and exp', async () => {
      const c = ctx();
      const token = await c.loginAsAdmin();

      const res = await c
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual(jwtPayload(token));
      expect(res.body).toHaveProperty('iat');
      expect(res.body).toHaveProperty('exp');
    });

    it('AUTH-08 no token, a bad signature, an expired token or a non-Bearer header -> 401', async () => {
      const c = ctx();
      const jwt = c.app.get(JwtService);
      const claims = {
        sub: '00000000-0000-4000-8000-000000000000',
        email: 'x@e2e.test',
        role: 'ADMIN',
        trainerProfileId: null,
        traineeProfileId: null,
      };
      const badSignature = jwt.sign(claims, { secret: 'some-other-secret' });
      const expired = jwt.sign(claims, { expiresIn: -60 });
      const valid = jwt.sign(claims);

      await c.http().get('/api/auth/me').expect(401);
      for (const header of [
        `Bearer ${badSignature}`,
        `Bearer ${expired}`,
        `Bearer not-a-jwt`,
        valid, // without the "Bearer " scheme
      ]) {
        await c
          .http()
          .get('/api/auth/me')
          .set('Authorization', header)
          .expect(401);
      }
      // Control: the same claims, properly signed, are accepted.
      await c
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${valid}`)
        .expect(200);
    });

    // CHARACTERIZATION: possibly unintended
    it('AUTH-09 a token stays valid after its account is DISABLED or deleted (no DB check)', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee('Ivan');
      const token = await c.provisionAndLogin('trainee', trainee.id);
      const accountId = String(jwtPayload(token).sub);

      // Disable through the real route (soft delete).
      await c
        .http()
        .delete(`/api/accounts/${accountId}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      const stored = await c.ds
        .getRepository(AccountEntity)
        .findOneByOrFail({ id: accountId });
      expect(stored.status).toBe(AccountStatus.DISABLED);
      expect(stored.traineeProfileId).toBeNull();

      // The old token still works, with the profile claim it was issued with.
      await c
        .http()
        .get(`/api/trainees/${trainee.id}/subscriptions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await c
        .http()
        .get('/api/trainees/me/training-insights')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Even with the account row gone.
      await c.ds.getRepository(AccountEntity).delete({ id: accountId });
      const me = await c
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(me.body).toMatchObject({
        sub: accountId,
        role: 'TRAINEE',
        traineeProfileId: trainee.id,
      });
    });
  });
});
