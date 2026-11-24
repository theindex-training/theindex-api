import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports, decodeVerifiedJwt } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import {
  FakeGoogle,
  TEST_GOOGLE_CLIENT_ID,
} from '../../test/int/google-id-token';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import {
  AuthService,
  GOOGLE_EMAIL_NOT_ACCEPTED,
  GOOGLE_NO_ACCOUNT,
  NOT_LINKED_MESSAGE,
} from './auth.service';

const PASSWORD = 'correct-horse-1';

/**
 * "Sign in with Google" (`AuthService.loginWithGoogle`): a shortcut into the existing account
 * with the Google account's email, never a new account. Google itself is faked at its boundary
 * (its signing keys); the token checks are google-auth-library's, as in production.
 */
describe('AuthService.loginWithGoogle (integration)', () => {
  const google = new FakeGoogle();
  process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;
  const fixtures = setupIntegrationSuite({
    extraImports: authImports(),
    overrides: [google.signingKeys],
  });

  const auth = (fx: Fixtures) => fx.moduleRef.get(AuthService);
  const accountCount = (fx: Fixtures) =>
    fx.ds.getRepository(AccountEntity).count();

  /** A trainee's account that is connected and set up: it signs in to the dashboard. */
  async function traineeAccount(
    fx: Fixtures,
    email: string,
    row: Partial<AccountEntity> = {},
  ) {
    const trainee = await fx.trainee('Ivan');
    const acc = await fx.ds.getRepository(AccountEntity).save({
      email,
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      hasUpdatedInitialPassword: true,
      consentAt: new Date('2026-11-01T10:00:00Z'),
      traineeProfileId: trainee.id,
      ...row,
    });
    return { trainee, acc };
  }

  const gmail = (email: string, extra: Record<string, unknown> = {}) =>
    google.idToken({ email, email_verified: true, ...extra });

  function errorOf(err: Error) {
    return (err as HttpException).getResponse();
  }

  it('signs in to the account with the Gmail address, with the same token a password login gives', async () => {
    const fx = fixtures();
    const { trainee, acc } = await traineeAccount(fx, 'ivan.petrov@gmail.com');

    const res = await auth(fx).loginWithGoogle(gmail('ivan.petrov@gmail.com'));
    const byPassword = await auth(fx).login(
      await auth(fx).validateUser('ivan.petrov@gmail.com', PASSWORD),
    );

    expect(res.account).toEqual(byPassword.account);
    const { payload } = decodeVerifiedJwt(res.accessToken);
    const { payload: passwordPayload } = decodeVerifiedJwt(
      byPassword.accessToken,
    );
    expect(payload).toEqual({
      ...passwordPayload,
      iat: payload.iat,
      exp: payload.exp,
    });
    expect(payload).toMatchObject({
      sub: acc.id,
      email: 'ivan.petrov@gmail.com',
      role: AccountRole.TRAINEE,
      traineeProfileId: trainee.id,
      setupRequired: false,
    });
  });

  it('finds the account whatever the case of the email, as the password login does', async () => {
    const fx = fixtures();
    const { acc } = await traineeAccount(fx, 'ivan.petrov@gmail.com');

    const res = await auth(fx).loginWithGoogle(gmail('Ivan.Petrov@gmail.com'));

    expect(decodeVerifiedJwt(res.accessToken).payload.sub).toBe(acc.id);
  });

  it('stores nothing: the account is unchanged and its password still works', async () => {
    const fx = fixtures();
    const { acc } = await traineeAccount(fx, 'ivan@gmail.com');

    await auth(fx).loginWithGoogle(gmail('ivan@gmail.com'));

    const after = await fx.ds
      .getRepository(AccountEntity)
      .findOneByOrFail({ id: acc.id });
    expect(after).toEqual(acc);
    await expect(
      auth(fx).validateUser('ivan@gmail.com', PASSWORD),
    ).resolves.toMatchObject({ id: acc.id });
  });

  it('signs a Google Workspace account in by its email', async () => {
    const fx = fixtures();
    const trainer = await fx.trainer('Maria');
    const acc = await fx.ds.getRepository(AccountEntity).save({
      email: 'maria@example-gym.bg',
      role: AccountRole.TRAINER,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      hasUpdatedInitialPassword: true,
      consentAt: new Date('2026-11-01T10:00:00Z'),
      trainerProfileId: trainer.id,
    });

    const res = await auth(fx).loginWithGoogle(
      gmail('maria@example-gym.bg', { hd: 'example-gym.bg' }),
    );

    expect(decodeVerifiedJwt(res.accessToken).payload).toMatchObject({
      sub: acc.id,
      role: AccountRole.TRAINER,
      trainerProfileId: trainer.id,
    });
  });

  it('signs an admin in (admins need no profile)', async () => {
    const fx = fixtures();
    const admin = await fx.ds.getRepository(AccountEntity).save({
      email: 'owner@gmail.com',
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    });

    const res = await auth(fx).loginWithGoogle(gmail('owner@gmail.com'));

    expect(decodeVerifiedJwt(res.accessToken).payload).toMatchObject({
      sub: admin.id,
      role: AccountRole.ADMIN,
      setupRequired: false,
    });
  });

  it('keeps the first-login setup ahead for an account an admin created', async () => {
    const fx = fixtures();
    await traineeAccount(fx, 'ivan@gmail.com', {
      hasUpdatedInitialPassword: false,
      consentAt: null,
    });

    const res = await auth(fx).loginWithGoogle(gmail('ivan@gmail.com'));

    expect(decodeVerifiedJwt(res.accessToken).payload.setupRequired).toBe(true);
  });

  it('never creates an account: an address no account has -> 401 GOOGLE_NO_ACCOUNT', async () => {
    const fx = fixtures();
    // Gmail ignores dots, but the lookup doesn't guess: this is another address to it.
    await traineeAccount(fx, 'ivan.petrov@gmail.com');
    const before = await accountCount(fx);

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(gmail('ivanpetrov@gmail.com')),
    );

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(errorOf(err)).toEqual({
      statusCode: 401,
      message: 'No account uses this Google address',
      error: GOOGLE_NO_ACCOUNT,
    });
    expect(await accountCount(fx)).toBe(before);
  });

  it('refuses a personal Google account with a non-Gmail address, even when an account has it', async () => {
    const fx = fixtures();
    await traineeAccount(fx, 'ivan@yahoo.com');

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(gmail('ivan@yahoo.com')),
    );

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(errorOf(err)).toEqual({
      statusCode: 401,
      message:
        'Only Gmail addresses and Google Workspace accounts can sign in with Google',
      error: GOOGLE_EMAIL_NOT_ACCEPTED,
    });
  });

  it('refuses an email Google has not verified', async () => {
    const fx = fixtures();
    await traineeAccount(fx, 'ivan@gmail.com');

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(
        google.idToken({ email: 'ivan@gmail.com', email_verified: false }),
      ),
    );

    expect(errorOf(err)).toMatchObject({ error: GOOGLE_EMAIL_NOT_ACCEPTED });
  });

  it("refuses an account no admin has connected yet with the password login's 403", async () => {
    const fx = fixtures();
    await fx.ds.getRepository(AccountEntity).save({
      email: 'new@gmail.com',
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      hasUpdatedInitialPassword: true,
      consentAt: new Date('2026-11-01T10:00:00Z'),
    });

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(gmail('new@gmail.com')),
    );

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.message).toBe(NOT_LINKED_MESSAGE);
  });

  it('refuses a disabled account as the password login does', async () => {
    const fx = fixtures();
    await traineeAccount(fx, 'ivan@gmail.com', {
      status: AccountStatus.DISABLED,
    });

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(gmail('ivan@gmail.com')),
    );

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(err.message).toBe('Account is not active (DISABLED)');
  });

  it('refuses a token Google did not sign before looking at any account', async () => {
    const fx = fixtures();
    await traineeAccount(fx, 'ivan@gmail.com');

    const err = await rejectionOf(
      auth(fx).loginWithGoogle(
        google.idToken(
          { email: 'ivan@gmail.com', email_verified: true },
          { signWith: FakeGoogle.strangerKey() },
        ),
      ),
    );

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(errorOf(err)).toMatchObject({ error: 'GOOGLE_TOKEN_INVALID' });
  });
});
