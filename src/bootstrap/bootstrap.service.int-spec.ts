import { randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AuthService } from '../auth/auth.service';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { BootstrapModule } from './bootstrap.module';
import { BootstrapService } from './bootstrap.service';

const SEED_EMAIL = 'admin@theindex.test';
const SEED_PASSWORD = 'seed-admin-pass';

/**
 * BootstrapService reads SEED_ADMIN_EMAIL/PASSWORD through ConfigService,
 * which falls back to process.env (the test ConfigModule ignores .env files).
 * The module is compiled without lifecycle hooks, so each test sets the env
 * and then calls the public onModuleInit() itself, as Nest does on boot.
 */
describe('BootstrapService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [...authImports(), BootstrapModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(BootstrapService);
  const accountRepo = (fx: Fixtures) => fx.ds.getRepository(AccountEntity);

  function setSeedEnv(email: string | undefined, password: string | undefined) {
    if (email === undefined) delete process.env.SEED_ADMIN_EMAIL;
    else process.env.SEED_ADMIN_EMAIL = email;
    if (password === undefined) delete process.env.SEED_ADMIN_PASSWORD;
    else process.env.SEED_ADMIN_PASSWORD = password;
  }

  async function insertAccount(fx: Fixtures, row: Partial<AccountEntity>) {
    return accountRepo(fx).save({
      email: `${randomUUID()}@example.com`,
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash('existing-pass', 4),
      hasUpdatedInitialPassword: true,
      trainerProfileId: null,
      traineeProfileId: null,
      ...row,
    });
  }

  afterEach(() => {
    setSeedEnv(undefined, undefined);
  });

  it('BOOT-01 creates exactly one ACTIVE ADMIN with the seed email whose password verifies', async () => {
    const fx = fixtures();
    setSeedEnv(SEED_EMAIL, SEED_PASSWORD);

    await svc(fx).onModuleInit();

    const rows = await accountRepo(fx).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: SEED_EMAIL,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      trainerProfileId: null,
      traineeProfileId: null,
      // Entity default: the seeded admin has not changed its initial password.
      hasUpdatedInitialPassword: false,
    });
    expect(rows[0].passwordHash).not.toBe(SEED_PASSWORD);
    expect(await bcrypt.compare(SEED_PASSWORD, rows[0].passwordHash!)).toBe(
      true,
    );

    // The seeded admin can log in through the real auth path.
    const auth = fx.moduleRef.get(AuthService);
    const acc = await auth.validateUser(SEED_EMAIL, SEED_PASSWORD);
    expect(acc).toMatchObject({ id: rows[0].id, role: AccountRole.ADMIN });
    const err = await rejectionOf(auth.validateUser(SEED_EMAIL, 'wrong'));
    expect(err).toBeInstanceOf(UnauthorizedException);
  });

  it('BOOT-01 running again (next boot) does not create a second admin', async () => {
    const fx = fixtures();
    setSeedEnv(SEED_EMAIL, SEED_PASSWORD);

    await svc(fx).onModuleInit();
    const [first] = await accountRepo(fx).find();
    await svc(fx).onModuleInit();

    const rows = await accountRepo(fx).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.id,
      passwordHash: first.passwordHash,
    });
  });

  it('BOOT-02 email already exists (any role/status): nothing changes, password not reset', async () => {
    const fx = fixtures();
    const existing = await insertAccount(fx, {
      email: SEED_EMAIL,
      role: AccountRole.TRAINEE,
      status: AccountStatus.DISABLED,
    });
    setSeedEnv(SEED_EMAIL, SEED_PASSWORD);

    await svc(fx).onModuleInit();

    const rows = await accountRepo(fx).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: existing.id,
      email: SEED_EMAIL,
      role: AccountRole.TRAINEE,
      status: AccountStatus.DISABLED,
      passwordHash: existing.passwordHash,
      hasUpdatedInitialPassword: true,
    });
    expect(await bcrypt.compare(SEED_PASSWORD, rows[0].passwordHash!)).toBe(
      false,
    );
  });

  it('BOOT-02 an existing ADMIN whose password was changed keeps it', async () => {
    const fx = fixtures();
    const existing = await insertAccount(fx, {
      email: SEED_EMAIL,
      role: AccountRole.ADMIN,
    });
    setSeedEnv(SEED_EMAIL, SEED_PASSWORD);

    await svc(fx).onModuleInit();

    const auth = fx.moduleRef.get(AuthService);
    await expect(
      auth.validateUser(SEED_EMAIL, 'existing-pass'),
    ).resolves.toMatchObject({ id: existing.id });
    const err = await rejectionOf(auth.validateUser(SEED_EMAIL, SEED_PASSWORD));
    expect(err).toBeInstanceOf(UnauthorizedException);
  });

  it('BOOT-02 the email match is exact: a different-case account does not stop the seed', async () => {
    const fx = fixtures();
    const other = await insertAccount(fx, {
      email: SEED_EMAIL.toUpperCase(),
      role: AccountRole.ADMIN,
    });
    setSeedEnv(SEED_EMAIL, SEED_PASSWORD);

    await svc(fx).onModuleInit();

    const rows = await accountRepo(fx).find({ order: { createdAt: 'ASC' } });
    expect(rows).toHaveLength(2);
    const seeded = rows.find((r) => r.id !== other.id)!;
    expect(seeded).toMatchObject({
      email: SEED_EMAIL,
      role: AccountRole.ADMIN,
    });
  });

  it.each([
    ['email missing', undefined, SEED_PASSWORD],
    ['password missing', SEED_EMAIL, undefined],
    ['both missing', undefined, undefined],
    ['email empty', '', SEED_PASSWORD],
    ['password empty', SEED_EMAIL, ''],
  ])('BOOT-02 %s -> nothing created', async (_label, email, password) => {
    const fx = fixtures();
    setSeedEnv(email, password);

    await svc(fx).onModuleInit();

    expect(await accountRepo(fx).count()).toBe(0);
  });
});
