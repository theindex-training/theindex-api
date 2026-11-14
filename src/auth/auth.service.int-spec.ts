import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports, decodeVerifiedJwt } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { AuthService } from './auth.service';

const PASSWORD = 'correct-horse-1';
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

/**
 * Service-level part of AUTH-01..05 and AUTH-07. The HTTP layer (passport
 * guards, LoginDto, /auth/me) is still open as [E] in TEST_PLAN.md.
 */
describe('AuthService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: authImports() });

  const auth = (fx: Fixtures) => fx.moduleRef.get(AuthService);

  async function insertAccount(fx: Fixtures, row: Partial<AccountEntity>) {
    return fx.ds.getRepository(AccountEntity).save({
      email: 'admin@example.com',
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      ...row,
    });
  }

  async function provisionTrainee(fx: Fixtures) {
    const trainee = await fx.trainee('Ivan');
    const acc = await fx.moduleRef
      .get(AccountsService)
      .provisionForProfile('trainee', trainee.id, {
        email: 'ivan@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      });
    return { trainee, acc };
  }

  describe('validateUser', () => {
    it('AUTH-01 returns the account for the right email and password', async () => {
      const fx = fixtures();
      const acc = await insertAccount(fx, {});

      const user = await auth(fx).validateUser('admin@example.com', PASSWORD);

      expect(user).toMatchObject({
        id: acc.id,
        email: 'admin@example.com',
        role: AccountRole.ADMIN,
      });
    });

    it('AUTH-03 wrong password and unknown email both -> 401 "Invalid credentials"', async () => {
      const fx = fixtures();
      await insertAccount(fx, {});

      for (const [email, password] of [
        ['admin@example.com', 'wrong-password'],
        ['nobody@example.com', PASSWORD],
      ]) {
        const err = await rejectionOf(auth(fx).validateUser(email, password));
        expect(err).toBeInstanceOf(UnauthorizedException);
        expect(err.message).toBe('Invalid credentials');
      }
    });

    it('AUTH-04 DISABLED account with the right password -> 401 naming the status', async () => {
      const fx = fixtures();
      await insertAccount(fx, { status: AccountStatus.DISABLED });

      const err = await rejectionOf(
        auth(fx).validateUser('admin@example.com', PASSWORD),
      );

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Account is not active (DISABLED)');
    });

    // CHARACTERIZATION: possibly unintended
    it('AUTH-04 status is checked before the password, so a wrong password reveals a disabled account', async () => {
      const fx = fixtures();
      await insertAccount(fx, { status: AccountStatus.DISABLED });

      const err = await rejectionOf(
        auth(fx).validateUser('admin@example.com', 'wrong-password'),
      );

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Account is not active (DISABLED)');
    });

    it('AUTH-05 account with no password hash -> 401 "Account has no password set"', async () => {
      const fx = fixtures();
      await insertAccount(fx, { passwordHash: null });

      const err = await rejectionOf(
        auth(fx).validateUser('admin@example.com', PASSWORD),
      );

      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Account has no password set');
    });

    it('AUTH-07 email lookup ignores case and surrounding spaces', async () => {
      const fx = fixtures();
      const acc = await insertAccount(fx, {});

      for (const email of [
        'Admin@example.com',
        ' admin@example.com',
        'admin@example.com ',
      ]) {
        const user = await auth(fx).validateUser(email, PASSWORD);
        expect(user.id).toBe(acc.id);
      }
    });
  });

  describe('login', () => {
    it('AUTH-01 returns { accessToken, account } with exactly the sanitized account keys', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);
      const user = await auth(fx).validateUser('ivan@example.com', PASSWORD);

      const res = await auth(fx).login(user);

      expect(Object.keys(res).sort()).toEqual(['accessToken', 'account']);
      expect(typeof res.accessToken).toBe('string');
      expect(Object.keys(res.account).sort()).toEqual(
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
      expect(res.account).toMatchObject({
        id: acc.id,
        email: 'ivan@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        hasUpdatedInitialPassword: false,
        trainerProfileId: null,
        traineeProfileId: trainee.id,
      });
      expect(res.account).not.toHaveProperty('passwordHash');
    });

    it('AUTH-02 JWT has exactly the contract claims, signed with JWT_SECRET, valid for 7 days', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);
      const user = await auth(fx).validateUser('ivan@example.com', PASSWORD);

      const { accessToken } = await auth(fx).login(user);
      const { header, payload } = decodeVerifiedJwt(accessToken);

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
        sub: acc.id,
        email: 'ivan@example.com',
        role: AccountRole.TRAINEE,
        trainerProfileId: null,
        traineeProfileId: trainee.id,
      });
      expect((payload.exp as number) - (payload.iat as number)).toBe(
        SEVEN_DAYS_S,
      );
    });

    it('AUTH-02 profile id claims are null (not missing) when the account has no profile', async () => {
      const fx = fixtures();
      const admin = await insertAccount(fx, {});

      // A bare object without profile fields, as `login` accepts a partial account.
      const { accessToken } = await auth(fx).login({
        id: admin.id,
        email: admin.email,
        role: admin.role,
      });
      const { payload } = decodeVerifiedJwt(accessToken);

      expect(payload).toMatchObject({
        sub: admin.id,
        role: AccountRole.ADMIN,
        trainerProfileId: null,
        traineeProfileId: null,
      });
      expect(payload).not.toHaveProperty('passwordHash');
    });
  });
});
