import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AuthService } from '../auth/auth.service';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountEntity } from './account.entity';
import { AccountsService } from './accounts.service';
import { CreateProvisionedAccountDto } from './dto/create-provisioned-account.dto';

const PASSWORD = 'initial-pass-1';
const NEW_PASSWORD = 'brand-new-pass-2';

function provisionDto(
  over: Partial<CreateProvisionedAccountDto> = {},
): CreateProvisionedAccountDto {
  return {
    email: 'user@example.com',
    role: AccountRole.TRAINER,
    status: AccountStatus.ACTIVE,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...over,
  };
}

describe('AccountsService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: authImports() });

  const svc = (fx: Fixtures) => fx.moduleRef.get(AccountsService);
  const auth = (fx: Fixtures) => fx.moduleRef.get(AuthService);
  const accountRepo = (fx: Fixtures) => fx.ds.getRepository(AccountEntity);
  const accountRow = (fx: Fixtures, id: string) =>
    accountRepo(fx).findOneByOrFail({ id });
  const trainerRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TrainerProfileEntity).findOneByOrFail({ id });
  const traineeRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TraineeProfileEntity).findOneByOrFail({ id });

  /** Direct insert for states provisioning can't create (ADMIN, no hash). */
  async function insertAccount(
    fx: Fixtures,
    row: Partial<AccountEntity> & { password?: string | null },
  ) {
    const { password = PASSWORD, ...rest } = row;
    return accountRepo(fx).save({
      email: `${randomUUID()}@example.com`,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      passwordHash: password === null ? null : await bcrypt.hash(password, 4),
      ...rest,
    });
  }

  async function provisionTrainee(
    fx: Fixtures,
    over: Partial<CreateProvisionedAccountDto> = {},
  ) {
    const trainee = await fx.trainee('Ivan', { phone: '0000' });
    const acc = await svc(fx).provisionForProfile(
      'trainee',
      trainee.id,
      provisionDto({
        email: 'trainee@example.com',
        role: AccountRole.TRAINEE,
        ...over,
      }),
    );
    return { trainee, acc };
  }

  async function provisionTrainer(
    fx: Fixtures,
    over: Partial<CreateProvisionedAccountDto> = {},
  ) {
    const trainer = await fx.trainer('Coach');
    const acc = await svc(fx).provisionForProfile(
      'trainer',
      trainer.id,
      provisionDto({ email: 'coach@example.com', ...over }),
    );
    return { trainer, acc };
  }

  // ---------------------------------------------------------------------
  describe('provisionForProfile', () => {
    it('ACC-01 trainer: TRAINER account with hashed password, DTO status, linked on both sides', async () => {
      const fx = fixtures();
      const trainer = await fx.trainer('Coach');

      const acc = await svc(fx).provisionForProfile(
        'trainer',
        trainer.id,
        provisionDto({ email: '  coach@example.com  ' }),
      );

      const stored = await accountRow(fx, acc.id);
      expect(stored).toMatchObject({
        email: 'coach@example.com',
        role: AccountRole.TRAINER,
        status: AccountStatus.ACTIVE,
        hasUpdatedInitialPassword: false,
        trainerProfileId: trainer.id,
        traineeProfileId: null,
      });
      expect(stored.passwordHash).not.toBe(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, stored.passwordHash!)).toBe(true);
      expect((await trainerRow(fx, trainer.id)).accountId).toBe(acc.id);

      // status comes from the DTO
      const other = await fx.trainer('Other');
      const disabled = await svc(fx).provisionForProfile(
        'trainer',
        other.id,
        provisionDto({
          email: 'other@example.com',
          status: AccountStatus.DISABLED,
        }),
      );
      expect((await accountRow(fx, disabled.id)).status).toBe(
        AccountStatus.DISABLED,
      );
    });

    it('ACC-02 trainee: TRAINEE account with hashed password, linked on both sides', async () => {
      const fx = fixtures();

      const { trainee, acc } = await provisionTrainee(fx);

      const stored = await accountRow(fx, acc.id);
      expect(stored).toMatchObject({
        email: 'trainee@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        hasUpdatedInitialPassword: false,
        trainerProfileId: null,
        traineeProfileId: trainee.id,
      });
      expect(await bcrypt.compare(PASSWORD, stored.passwordHash!)).toBe(true);
      expect((await traineeRow(fx, trainee.id)).accountId).toBe(acc.id);
    });

    it('ACC-03 validation order: passwords, profile/role match, ADMIN, then email, then profile type', async () => {
      const fx = fixtures();
      const trainer = await fx.trainer('Coach');
      const trainee = await fx.trainee('Ivan');
      const taken = await insertAccount(fx, { email: 'taken@example.com' });
      const bogus = 'bogus' as unknown as 'trainer';

      // 1. password mismatch wins over everything else
      let err = await rejectionOf(
        svc(fx).provisionForProfile(
          bogus,
          trainer.id,
          provisionDto({
            role: AccountRole.ADMIN,
            email: 'taken@example.com',
            confirmPassword: 'something-else',
          }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Passwords do not match');

      // 2. profile type must match the role (so trainer + ADMIN is a 400, not the 403)
      for (const role of [AccountRole.ADMIN, AccountRole.TRAINEE]) {
        err = await rejectionOf(
          svc(fx).provisionForProfile(
            'trainer',
            trainer.id,
            provisionDto({ role }),
          ),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(
          'Trainer profile must be provisioned with TRAINER role',
        );
      }
      for (const role of [AccountRole.ADMIN, AccountRole.TRAINER]) {
        err = await rejectionOf(
          svc(fx).provisionForProfile(
            'trainee',
            trainee.id,
            provisionDto({ role }),
          ),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(
          'Trainee profile must be provisioned with TRAINEE role',
        );
      }

      // 3. unknown profile type + ADMIN -> 403
      err = await rejectionOf(
        svc(fx).provisionForProfile(
          bogus,
          trainer.id,
          provisionDto({ role: AccountRole.ADMIN }),
        ),
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe('This endpoint cannot create ADMIN accounts');

      // 4. unknown profile type + TRAINER/TRAINEE: email is checked first ...
      err = await rejectionOf(
        svc(fx).provisionForProfile(
          bogus,
          trainer.id,
          provisionDto({
            role: AccountRole.TRAINEE,
            email: 'taken@example.com',
          }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Email is already used by another account');

      // ... then the profile type
      err = await rejectionOf(
        svc(fx).provisionForProfile(
          bogus,
          trainer.id,
          provisionDto({
            role: AccountRole.TRAINER,
            email: 'free@example.com',
          }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Invalid profile type');

      const rows = await accountRepo(fx).find();
      expect(rows.map((r) => r.id)).toEqual([taken.id]);
      expect((await trainerRow(fx, trainer.id)).accountId).toBeNull();
      expect((await traineeRow(fx, trainee.id)).accountId).toBeNull();
    });

    it('ACC-04 email in use (even by a DISABLED account) -> 400, nothing created or linked', async () => {
      const fx = fixtures();
      const trainer = await fx.trainer('Coach');
      const trainee = await fx.trainee('Ivan');
      await insertAccount(fx, {
        email: 'old@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.DISABLED,
      });

      for (const [type, id, role] of [
        ['trainer', trainer.id, AccountRole.TRAINER],
        ['trainee', trainee.id, AccountRole.TRAINEE],
      ] as const) {
        const err = await rejectionOf(
          svc(fx).provisionForProfile(
            type,
            id,
            provisionDto({ email: ' old@example.com ', role }),
          ),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe('Email is already used by another account');
      }

      expect(await accountRepo(fx).count()).toBe(1);
      expect((await trainerRow(fx, trainer.id)).accountId).toBeNull();
      expect((await traineeRow(fx, trainee.id)).accountId).toBeNull();
    });

    it('ACC-04 missing or inactive profile -> 404, nothing created', async () => {
      const fx = fixtures();
      const inactiveTrainer = await fx.trainer('Gone', { isActive: false });
      const inactiveTrainee = await fx.trainee('Gone', { isActive: false });

      const cases = [
        ['trainer', randomUUID(), 'Trainer profile not found or inactive'],
        [
          'trainer',
          inactiveTrainer.id,
          'Trainer profile not found or inactive',
        ],
        ['trainee', randomUUID(), 'Trainee profile not found or inactive'],
        [
          'trainee',
          inactiveTrainee.id,
          'Trainee profile not found or inactive',
        ],
      ] as const;

      for (const [type, id, message] of cases) {
        const err = await rejectionOf(
          svc(fx).provisionForProfile(
            type,
            id,
            provisionDto({
              role:
                type === 'trainer' ? AccountRole.TRAINER : AccountRole.TRAINEE,
            }),
          ),
        );
        expect(err).toBeInstanceOf(NotFoundException);
        expect(err.message).toBe(message);
      }

      expect(await accountRepo(fx).count()).toBe(0);
      expect((await trainerRow(fx, inactiveTrainer.id)).accountId).toBeNull();
      expect((await traineeRow(fx, inactiveTrainee.id)).accountId).toBeNull();
    });

    it('ACC-04 profile already linked -> 400, existing link kept, no second account', async () => {
      const fx = fixtures();
      const { trainer, acc: trainerAcc } = await provisionTrainer(fx);
      const { trainee, acc: traineeAcc } = await provisionTrainee(fx);

      let err = await rejectionOf(
        svc(fx).provisionForProfile(
          'trainer',
          trainer.id,
          provisionDto({ email: 'second-coach@example.com' }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Trainer already has an account');

      err = await rejectionOf(
        svc(fx).provisionForProfile(
          'trainee',
          trainee.id,
          provisionDto({
            email: 'second-trainee@example.com',
            role: AccountRole.TRAINEE,
          }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Trainee already has an account');

      expect(await accountRepo(fx).count()).toBe(2);
      expect((await trainerRow(fx, trainer.id)).accountId).toBe(trainerAcc.id);
      expect((await traineeRow(fx, trainee.id)).accountId).toBe(traineeAcc.id);
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-04 profile unlinked on the profile side only -> 400 with a misleading "email" message', async () => {
      const fx = fixtures();
      const { trainer, acc } = await provisionTrainer(fx);
      // What PATCH /trainers/:id { accountId: null } does (TRP-01): the
      // profile forgets the account, the account still points at the profile.
      await fx.ds
        .getRepository(TrainerProfileEntity)
        .update({ id: trainer.id }, { accountId: null });

      const err = await rejectionOf(
        svc(fx).provisionForProfile(
          'trainer',
          trainer.id,
          provisionDto({ email: 'fresh@example.com' }),
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(
        'Cannot create account (email may already exist)',
      );
      expect(await accountRepo(fx).count()).toBe(1);
      expect((await accountRow(fx, acc.id)).trainerProfileId).toBe(trainer.id);
      expect((await trainerRow(fx, trainer.id)).accountId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  describe('update', () => {
    it('ACC-06 email change is trimmed and unique; keeping your own email is OK', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainer(fx);
      await insertAccount(fx, { email: 'admin@example.com' });

      const own = await svc(fx).update(acc.id, { email: 'coach@example.com' });
      expect(own.email).toBe('coach@example.com');

      const err = await rejectionOf(
        svc(fx).update(acc.id, { email: 'admin@example.com' }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Email is already used by another account');
      expect((await accountRow(fx, acc.id)).email).toBe('coach@example.com');

      await svc(fx).update(acc.id, { email: '  new@example.com ' });
      expect((await accountRow(fx, acc.id)).email).toBe('new@example.com');
    });

    it('ACC-06 password needs a matching confirmPassword and marks the initial password as updated', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainer(fx);
      const before = await accountRow(fx, acc.id);

      for (const confirmPassword of [undefined, 'different-pass-9']) {
        const err = await rejectionOf(
          svc(fx).update(acc.id, { password: NEW_PASSWORD, confirmPassword }),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe('Passwords do not match');
      }
      expect(await accountRow(fx, acc.id)).toMatchObject({
        passwordHash: before.passwordHash,
        hasUpdatedInitialPassword: false,
      });

      await svc(fx).update(acc.id, {
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });

      const after = await accountRow(fx, acc.id);
      expect(after.hasUpdatedInitialPassword).toBe(true);
      expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash!)).toBe(
        true,
      );
      expect(await bcrypt.compare(PASSWORD, after.passwordHash!)).toBe(false);
    });

    it('ACC-06 a rejected email leaves a password sent in the same request unsaved', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainer(fx);
      await insertAccount(fx, { email: 'admin@example.com' });
      const before = await accountRow(fx, acc.id);

      await rejectionOf(
        svc(fx).update(acc.id, {
          email: 'admin@example.com',
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        }),
      );

      expect(await accountRow(fx, acc.id)).toMatchObject({
        email: before.email,
        passwordHash: before.passwordHash,
        hasUpdatedInitialPassword: false,
      });
    });

    it('ACC-06 status change; empty body leaves the account unchanged; unknown id -> 404', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainer(fx);
      const before = await accountRow(fx, acc.id);

      await svc(fx).update(acc.id, {});
      expect(await accountRow(fx, acc.id)).toMatchObject({
        email: before.email,
        passwordHash: before.passwordHash,
        status: AccountStatus.ACTIVE,
        hasUpdatedInitialPassword: false,
        trainerProfileId: before.trainerProfileId,
      });

      await svc(fx).update(acc.id, { status: AccountStatus.DISABLED });
      expect((await accountRow(fx, acc.id)).status).toBe(
        AccountStatus.DISABLED,
      );

      const err = await rejectionOf(svc(fx).update(randomUUID(), {}));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Account not found');
    });
  });

  // ---------------------------------------------------------------------
  describe('delete', () => {
    it('ACC-07 is a soft disable that unlinks both sides and keeps the row and email', async () => {
      const fx = fixtures();
      const { trainee, acc: traineeAcc } = await provisionTrainee(fx);
      const { trainer, acc: trainerAcc } = await provisionTrainer(fx);

      const returned = await svc(fx).delete(traineeAcc.id);
      expect(returned).toMatchObject({
        id: traineeAcc.id,
        email: 'trainee@example.com',
        status: AccountStatus.DISABLED,
        trainerProfileId: null,
        traineeProfileId: null,
      });
      expect(await accountRow(fx, traineeAcc.id)).toMatchObject({
        email: 'trainee@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.DISABLED,
        traineeProfileId: null,
      });
      expect((await traineeRow(fx, trainee.id)).accountId).toBeNull();

      await svc(fx).delete(trainerAcc.id);
      expect(await accountRow(fx, trainerAcc.id)).toMatchObject({
        status: AccountStatus.DISABLED,
        trainerProfileId: null,
      });
      expect((await trainerRow(fx, trainer.id)).accountId).toBeNull();
      expect(await accountRepo(fx).count()).toBe(2);

      // the disabled account can no longer log in
      const err = await rejectionOf(
        auth(fx).validateUser('trainee@example.com', PASSWORD),
      );
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Account is not active (DISABLED)');
    });

    it('ACC-07 unknown id -> 404', async () => {
      const fx = fixtures();
      const err = await rejectionOf(svc(fx).delete(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Account not found');
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-07 a deleted account keeps its email, so the email can never be provisioned again', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);
      await svc(fx).delete(acc.id);

      // the profile is free again, but the email is not
      const err = await rejectionOf(
        svc(fx).provisionForProfile(
          'trainee',
          trainee.id,
          provisionDto({
            email: 'trainee@example.com',
            role: AccountRole.TRAINEE,
          }),
        ),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Email is already used by another account');

      // a different email works for the same profile
      const again = await svc(fx).provisionForProfile(
        'trainee',
        trainee.id,
        provisionDto({
          email: 'trainee2@example.com',
          role: AccountRole.TRAINEE,
        }),
      );
      expect((await traineeRow(fx, trainee.id)).accountId).toBe(again.id);
    });
  });

  // ---------------------------------------------------------------------
  describe('changePassword', () => {
    it('ACC-08 self change: confirm mismatch is checked first, then currentPassword', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainee(fx);
      const self = { id: acc.id };
      const before = await accountRow(fx, acc.id);

      const cases: [
        Parameters<AccountsService['changePassword']>[2],
        string,
      ][] = [
        [
          // mismatch wins even though currentPassword and phone are missing
          { newPassword: NEW_PASSWORD, confirmPassword: 'different-pass-9' },
          'Passwords do not match',
        ],
        [
          {
            newPassword: NEW_PASSWORD,
            confirmPassword: NEW_PASSWORD,
            phone: '0888',
          },
          'Current password is required',
        ],
        [
          {
            currentPassword: 'wrong-password-1',
            newPassword: NEW_PASSWORD,
            confirmPassword: NEW_PASSWORD,
            phone: '0888',
          },
          'Current password is invalid',
        ],
      ];

      for (const [dto, message] of cases) {
        const err = await rejectionOf(
          svc(fx).changePassword(self, acc.id, dto),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(message);
      }

      expect(await accountRow(fx, acc.id)).toMatchObject({
        passwordHash: before.passwordHash,
        hasUpdatedInitialPassword: false,
      });
    });

    it('ACC-08 self change on an account with no password hash -> 400; unknown target -> 404', async () => {
      const fx = fixtures();
      const noHash = await insertAccount(fx, { password: null });

      let err = await rejectionOf(
        svc(fx).changePassword({ id: noHash.id }, noHash.id, {
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
          phone: '0888',
        }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Account has no password set');
      expect((await accountRow(fx, noHash.id)).passwordHash).toBeNull();

      const missing = randomUUID();
      err = await rejectionOf(
        svc(fx).changePassword({ id: missing }, missing, {
          newPassword: NEW_PASSWORD,
          confirmPassword: 'different-pass-9',
        }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Account not found');
    });

    it('ACC-09 first change requires a non-blank phone; afterwards phone is optional', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainee(fx);
      const self = { id: acc.id };
      const base = {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      };

      for (const phone of [undefined, null, '', '   ']) {
        const err = await rejectionOf(
          svc(fx).changePassword(self, acc.id, { ...base, phone }),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(
          'Phone is required when changing password for the first time',
        );
      }
      expect((await accountRow(fx, acc.id)).hasUpdatedInitialPassword).toBe(
        false,
      );

      await svc(fx).changePassword(self, acc.id, { ...base, phone: '0888' });

      // second change, no phone
      const res = await svc(fx).changePassword(self, acc.id, {
        currentPassword: NEW_PASSWORD,
        newPassword: 'third-pass-333',
        confirmPassword: 'third-pass-333',
      });
      expect(res).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });
      await expect(
        auth(fx).validateUser('trainee@example.com', 'third-pass-333'),
      ).resolves.toMatchObject({ id: acc.id });
    });

    it('ACC-10 effects: response, new password logs in, old does not, trainee phone trimmed', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);

      const res = await svc(fx).changePassword({ id: acc.id }, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '  0888 123 456  ',
      });

      expect(res).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });
      expect((await accountRow(fx, acc.id)).hasUpdatedInitialPassword).toBe(
        true,
      );
      await expect(
        auth(fx).validateUser('trainee@example.com', NEW_PASSWORD),
      ).resolves.toMatchObject({ id: acc.id });
      const err = await rejectionOf(
        auth(fx).validateUser('trainee@example.com', PASSWORD),
      );
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('Invalid credentials');
      expect((await traineeRow(fx, trainee.id)).phone).toBe('0888 123 456');
    });

    it('ACC-10 after the first change: omitted phone keeps it, null clears it', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);
      const self = { id: acc.id };
      await svc(fx).changePassword(self, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '0888',
      });

      await svc(fx).changePassword(self, acc.id, {
        currentPassword: NEW_PASSWORD,
        newPassword: PASSWORD,
        confirmPassword: PASSWORD,
      });
      expect((await traineeRow(fx, trainee.id)).phone).toBe('0888');

      await svc(fx).changePassword(self, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: null,
      });
      expect((await traineeRow(fx, trainee.id)).phone).toBeNull();
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-10 after the first change a whitespace-only phone is stored as an empty string, not null', async () => {
      const fx = fixtures();
      const { trainee, acc } = await provisionTrainee(fx);
      const self = { id: acc.id };
      await svc(fx).changePassword(self, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '0888',
      });

      await svc(fx).changePassword(self, acc.id, {
        currentPassword: NEW_PASSWORD,
        newPassword: PASSWORD,
        confirmPassword: PASSWORD,
        phone: '   ',
      });

      expect((await traineeRow(fx, trainee.id)).phone).toBe('');
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-10 trainer and ADMIN accounts must send a phone the first time, but it is not stored anywhere', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainer(fx);
      const trainee = await fx.trainee('Bystander', { phone: '1111' });
      // Same state BootstrapService seeds: hasUpdatedInitialPassword defaults to false.
      const admin = await insertAccount(fx, { email: 'admin@example.com' });
      const noPhone = {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      };

      for (const id of [acc.id, admin.id]) {
        const err = await rejectionOf(
          svc(fx).changePassword({ id }, id, noPhone),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(
          'Phone is required when changing password for the first time',
        );
      }

      const res = await svc(fx).changePassword({ id: acc.id }, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '0888',
      });

      expect(res).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });
      expect((await traineeRow(fx, trainee.id)).phone).toBe('1111');
      await expect(
        auth(fx).validateUser('coach@example.com', NEW_PASSWORD),
      ).resolves.toMatchObject({ id: acc.id });
    });

    it('ACC-11 change by someone else needs no current password (a wrong one is ignored)', async () => {
      const fx = fixtures();
      const admin = await insertAccount(fx, { email: 'admin@example.com' });
      const { acc } = await provisionTrainee(fx);

      await svc(fx).changePassword({ id: admin.id }, acc.id, {
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '0888',
      });

      await expect(
        auth(fx).validateUser('trainee@example.com', NEW_PASSWORD),
      ).resolves.toMatchObject({ id: acc.id });
      // the requester's own password is untouched
      await expect(
        auth(fx).validateUser('admin@example.com', PASSWORD),
      ).resolves.toMatchObject({ id: admin.id });
    });

    // CHARACTERIZATION: possibly unintended
    it('ACC-11 an admin reset still requires a phone and marks the initial password as updated', async () => {
      const fx = fixtures();
      const admin = await insertAccount(fx, { email: 'admin@example.com' });
      const { acc } = await provisionTrainee(fx);
      const dto = { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };

      const err = await rejectionOf(
        svc(fx).changePassword({ id: admin.id }, acc.id, dto),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(
        'Phone is required when changing password for the first time',
      );

      const res = await svc(fx).changePassword({ id: admin.id }, acc.id, {
        ...dto,
        phone: '0888',
      });
      expect(res).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });
      expect(await svc(fx).hasUpdatedInitialPassword(acc.id)).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });
    });
  });

  // ---------------------------------------------------------------------
  describe('hasUpdatedInitialPassword', () => {
    it('ACC-12 reports the flag before and after the first change; unknown id -> 404', async () => {
      const fx = fixtures();
      const { acc } = await provisionTrainee(fx);

      expect(await svc(fx).hasUpdatedInitialPassword(acc.id)).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: false,
      });

      await svc(fx).changePassword({ id: acc.id }, acc.id, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        phone: '0888',
      });

      expect(await svc(fx).hasUpdatedInitialPassword(acc.id)).toEqual({
        accountId: acc.id,
        hasUpdatedInitialPassword: true,
      });

      const err = await rejectionOf(
        svc(fx).hasUpdatedInitialPassword(randomUUID()),
      );
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).toBe('Account not found');
    });
  });
});
