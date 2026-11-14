import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports, decodeVerifiedJwt } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { AuthService, NOT_LINKED_MESSAGE } from '../auth/auth.service';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { TrainerProfileEntity } from './trainer-profile.entity';
import { TrainerProfilesModule } from './trainer-profiles.module';
import { TrainerProfilesService } from './trainer-profiles.service';

const PASSWORD = 'trainer-pass-1';

describe('TrainerProfilesService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [...authImports(), TrainerProfilesModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(TrainerProfilesService);
  const trainerRepo = (fx: Fixtures) =>
    fx.ds.getRepository(TrainerProfileEntity);
  const trainerRow = (fx: Fixtures, id: string) =>
    trainerRepo(fx).findOneByOrFail({ id });
  const accountRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(AccountEntity).findOneByOrFail({ id });

  async function insertAccount(
    fx: Fixtures,
    role: AccountRole,
    extra: Partial<AccountEntity> = {},
  ) {
    return fx.ds.getRepository(AccountEntity).save({
      email: `${randomUUID()}@example.com`,
      role,
      status: AccountStatus.ACTIVE,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      hasUpdatedInitialPassword: true,
      trainerProfileId: null,
      traineeProfileId: null,
      ...extra,
    });
  }

  async function expectBadRequest(promise: Promise<unknown>, message: string) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(message);
  }

  async function expectNotFound(promise: Promise<unknown>, message: string) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe(message);
  }

  describe('create', () => {
    it('TRP-01 trims name and nickname; active by default; no account', async () => {
      const fx = fixtures();

      const trainer = await svc(fx).create({
        name: '  Velcho  ',
        nickname: '  V  ',
      });

      const expected = {
        name: 'Velcho',
        nickname: 'V',
        accountId: null,
        isActive: true,
      };
      expect(trainer).toMatchObject(expected);
      expect(await trainerRow(fx, trainer.id)).toMatchObject(expected);
    });

    it('TRP-01 nickname omitted -> null; explicit isActive: false is stored', async () => {
      const fx = fixtures();

      const trainer = await svc(fx).create({ name: 'Ivo', isActive: false });

      expect(await trainerRow(fx, trainer.id)).toMatchObject({
        name: 'Ivo',
        nickname: null,
        isActive: false,
      });
    });

    it('TRP-01 an accountId already linked to another trainer -> 400, nothing stored', async () => {
      const fx = fixtures();
      const account = await insertAccount(fx, AccountRole.TRAINER);
      const first = await svc(fx).create({
        name: 'First',
        accountId: account.id,
      });

      await expectBadRequest(
        svc(fx).create({ name: 'Second', accountId: account.id }),
        'This account is already linked to another trainer',
      );

      const rows = await trainerRepo(fx).find();
      expect(rows.map((r) => r.id)).toEqual([first.id]);
      expect(rows[0].accountId).toBe(account.id);
    });

    // CHARACTERIZATION: possibly unintended
    it('TRP-01 accepts any account id (even a TRAINEE account) and never links the account back', async () => {
      const fx = fixtures();
      const traineeAccount = await insertAccount(fx, AccountRole.TRAINEE);
      const trainerAccount = await insertAccount(fx, AccountRole.TRAINER);

      const a = await svc(fx).create({
        name: 'Ana',
        accountId: traineeAccount.id,
      });
      const b = await svc(fx).create({
        name: 'Bob',
        accountId: trainerAccount.id,
      });

      expect((await trainerRow(fx, a.id)).accountId).toBe(traineeAccount.id);
      expect((await trainerRow(fx, b.id)).accountId).toBe(trainerAccount.id);
      // The account side stays unlinked, so the JWT carries no trainer claim.
      expect(
        (await accountRow(fx, traineeAccount.id)).trainerProfileId,
      ).toBeNull();
      expect(
        (await accountRow(fx, trainerAccount.id)).trainerProfileId,
      ).toBeNull();

      // Only the account side counts as a link, so that account can't log in.
      const err = await rejectionOf(
        fx.moduleRef
          .get(AuthService)
          .validateUser(trainerAccount.email!, PASSWORD),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe(NOT_LINKED_MESSAGE);
    });

    // CHARACTERIZATION: possibly unintended
    it('TRP-01 an unknown accountId fails on the DB foreign key (non-HTTP error, 500)', async () => {
      const fx = fixtures();

      const err = await rejectionOf(
        svc(fx).create({ name: 'Ana', accountId: randomUUID() }),
      );

      expect(err).not.toBeInstanceOf(HttpException);
      expect(err.message).toMatch(/foreign key/i);
      expect(await trainerRepo(fx).count()).toBe(0);
    });
  });

  describe('update', () => {
    it('TRP-01 partial update: only sent fields change, strings trimmed, nickname null clears', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Velcho', { nickname: 'V' });

      await svc(fx).update(t.id, { name: '  Velcho P.  ' });
      expect(await trainerRow(fx, t.id)).toMatchObject({
        name: 'Velcho P.',
        nickname: 'V',
        isActive: true,
        accountId: null,
      });

      await svc(fx).update(t.id, {
        name: 'Velcho P.',
        nickname: '  Vel  ',
        isActive: false,
      });
      expect(await trainerRow(fx, t.id)).toMatchObject({
        nickname: 'Vel',
        isActive: false,
      });

      const returned = await svc(fx).update(t.id, {
        name: 'Velcho P.',
        nickname: null,
      });
      expect(returned.nickname).toBeNull();
      expect(await trainerRow(fx, t.id)).toMatchObject({
        name: 'Velcho P.',
        nickname: null,
        isActive: false,
      });
    });

    it("TRP-01 accountId: link, keep own link, reject another trainer's account, null unlinks", async () => {
      const fx = fixtures();
      const accA = await insertAccount(fx, AccountRole.TRAINER);
      const accB = await insertAccount(fx, AccountRole.TRAINER);
      const t = await fx.trainer('Ana');
      const other = await fx.trainer('Bob', { accountId: accB.id });

      await svc(fx).update(t.id, { name: 'Ana', accountId: accA.id });
      expect((await trainerRow(fx, t.id)).accountId).toBe(accA.id);

      // Re-sending its own account is not a conflict.
      await svc(fx).update(t.id, { name: 'Ana P.', accountId: accA.id });
      expect(await trainerRow(fx, t.id)).toMatchObject({
        name: 'Ana P.',
        accountId: accA.id,
      });

      await expectBadRequest(
        svc(fx).update(t.id, { name: 'Changed', accountId: accB.id }),
        'This account is already linked to another trainer',
      );
      // Nothing from the rejected update is persisted.
      expect(await trainerRow(fx, t.id)).toMatchObject({
        name: 'Ana P.',
        accountId: accA.id,
      });
      expect((await trainerRow(fx, other.id)).accountId).toBe(accB.id);

      await svc(fx).update(t.id, { name: 'Ana P.', accountId: null });
      expect((await trainerRow(fx, t.id)).accountId).toBeNull();
    });

    it('TRP-01 omitting accountId leaves the link untouched (stored and returned)', async () => {
      const fx = fixtures();
      const acc = await insertAccount(fx, AccountRole.TRAINER);
      const t = await fx.trainer('Ana', { accountId: acc.id });

      const returned = await svc(fx).update(t.id, {
        name: 'Ana',
        isActive: false,
      });

      // The PATCH response body is the returned entity.
      expect(returned).toMatchObject({ accountId: acc.id, isActive: false });
      expect((await trainerRow(fx, t.id)).accountId).toBe(acc.id);
    });

    // CHARACTERIZATION: possibly unintended
    it('TRP-01 unlinking with accountId: null leaves the account pointing at the trainer (JWT keeps the claim)', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana');
      const account = await fx.moduleRef
        .get(AccountsService)
        .provisionForProfile('trainer', t.id, {
          email: 'ana@example.com',
          role: AccountRole.TRAINER,
          status: AccountStatus.ACTIVE,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        });
      expect((await trainerRow(fx, t.id)).accountId).toBe(account.id);

      await svc(fx).update(t.id, { name: 'Ana', accountId: null });

      expect((await trainerRow(fx, t.id)).accountId).toBeNull();
      expect((await accountRow(fx, account.id)).trainerProfileId).toBe(t.id);

      const auth = fx.moduleRef.get(AuthService);
      const { accessToken } = await auth.login(
        await auth.validateUser('ana@example.com', PASSWORD),
      );
      expect(decodeVerifiedJwt(accessToken).payload).toMatchObject({
        sub: account.id,
        trainerProfileId: t.id,
      });
    });

    it('TRP-05 unknown id -> 404 Trainer not found', async () => {
      const fx = fixtures();

      await expectNotFound(
        svc(fx).update(randomUUID(), { name: 'X' }),
        'Trainer not found',
      );
      expect(await trainerRepo(fx).count()).toBe(0);
    });
  });

  describe('deactivate', () => {
    it('TRP-03 sets isActive false and keeps the row and its account link', async () => {
      const fx = fixtures();
      const acc = await insertAccount(fx, AccountRole.TRAINER);
      const t = await fx.trainer('Ana', { nickname: 'A', accountId: acc.id });

      const returned = await svc(fx).deactivate(t.id);

      expect(returned.isActive).toBe(false);
      expect(await trainerRow(fx, t.id)).toMatchObject({
        name: 'Ana',
        nickname: 'A',
        accountId: acc.id,
        isActive: false,
      });
    });

    it('TRP-03 a deactivated trainer cannot record attendance (400) and cannot be provisioned (404)', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana');
      const trainee = await fx.trainee('Tom');
      const loc = await fx.location();

      await svc(fx).deactivate(t.id);

      await expectBadRequest(
        fx.attend(trainee.id, t.id, loc.id, '2025-12-10T09:00:00Z'),
        'Trainer not found or inactive',
      );
      expect(await fx.attendanceRows()).toHaveLength(0);

      await expectNotFound(
        fx.moduleRef.get(AccountsService).provisionForProfile('trainer', t.id, {
          email: 'ana@example.com',
          role: AccountRole.TRAINER,
          status: AccountStatus.ACTIVE,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        }),
        'Trainer profile not found or inactive',
      );
      expect(await fx.ds.getRepository(AccountEntity).count()).toBe(0);
      expect((await trainerRow(fx, t.id)).accountId).toBeNull();
    });

    it('TRP-03 attendance recorded before deactivation is unchanged', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana');
      const trainee = await fx.trainee('Tom');
      const loc = await fx.location();
      const { attendance } = await fx.attend(
        trainee.id,
        t.id,
        loc.id,
        '2025-12-10T09:00:00Z',
      );

      await svc(fx).deactivate(t.id);

      expect(await fx.att(attendance.id)).toMatchObject({
        trainerId: t.id,
        traineeId: trainee.id,
      });
    });

    // CHARACTERIZATION: possibly unintended
    it("TRP-03 the deactivated trainer's account can still log in with its TRAINER role and profile claim", async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana');
      const account = await fx.moduleRef
        .get(AccountsService)
        .provisionForProfile('trainer', t.id, {
          email: 'ana@example.com',
          role: AccountRole.TRAINER,
          status: AccountStatus.ACTIVE,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        });

      await svc(fx).deactivate(t.id);

      expect((await accountRow(fx, account.id)).status).toBe(
        AccountStatus.ACTIVE,
      );
      const auth = fx.moduleRef.get(AuthService);
      const { accessToken } = await auth.login(
        await auth.validateUser('ana@example.com', PASSWORD),
      );
      expect(decodeVerifiedJwt(accessToken).payload).toMatchObject({
        sub: account.id,
        role: AccountRole.TRAINER,
        trainerProfileId: t.id,
      });
    });

    it('TRP-03 deactivating twice is a no-op; unknown id -> 404', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana');

      await svc(fx).deactivate(t.id);
      await svc(fx).deactivate(t.id);
      expect((await trainerRow(fx, t.id)).isActive).toBe(false);

      await expectNotFound(
        svc(fx).deactivate(randomUUID()),
        'Trainer not found',
      );
    });
  });

  describe('list / getById', () => {
    it('TRP-05 ordered by name ASC; active filter true/false/undefined', async () => {
      const fx = fixtures();
      const cid = await fx.trainer('Cid');
      const ana = await fx.trainer('Ana');
      const bob = await fx.trainer('Bob', { isActive: false });

      const ids = (rows: TrainerProfileEntity[]) => rows.map((r) => r.id);
      expect(ids(await svc(fx).list())).toEqual([ana.id, bob.id, cid.id]);
      expect(ids(await svc(fx).list(true))).toEqual([ana.id, cid.id]);
      expect(ids(await svc(fx).list(false))).toEqual([bob.id]);
    });

    it('TRP-05 getById returns inactive trainers too; unknown id -> 404 Trainer not found', async () => {
      const fx = fixtures();
      const t = await fx.trainer('Ana', { isActive: false });

      expect(await svc(fx).getById(t.id)).toMatchObject({
        id: t.id,
        name: 'Ana',
        isActive: false,
      });
      await expectNotFound(svc(fx).getById(randomUUID()), 'Trainer not found');
    });
  });
});
