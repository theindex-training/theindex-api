import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { authImports, decodeVerifiedJwt } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AuthService, NOT_LINKED_MESSAGE } from '../auth/auth.service';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { MyProfileModule } from '../my-profile/my-profile.module';
import { MyProfileService } from '../my-profile/my-profile.service';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { AccountAdminService } from './account-admin.service';
import { AccountRegistrationService } from './account-registration.service';
import { AccountEntity } from './account.entity';
import { RegisterDto } from './dto/register.dto';

const PASSWORD = 'my-own-pass-1';

function registerDto(over: Partial<RegisterDto> = {}): RegisterDto {
  return {
    email: 'ivan@example.com',
    password: PASSWORD,
    confirmPassword: PASSWORD,
    name: 'Ivan Petrov',
    phone: '0888 123 456',
    acceptTerms: true,
    ...over,
  };
}

/**
 * ACC-20..25: self-registration, the login rule for unconnected accounts, the admin's Accounts
 * page (list, connect, delete) and "My details".
 */
describe('Self-registration and connecting accounts (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [...authImports(), MyProfileModule],
  });

  const registration = (fx: Fixtures) =>
    fx.moduleRef.get(AccountRegistrationService);
  const admin = (fx: Fixtures) => fx.moduleRef.get(AccountAdminService);
  const auth = (fx: Fixtures) => fx.moduleRef.get(AuthService);
  const myProfile = (fx: Fixtures) => fx.moduleRef.get(MyProfileService);
  const accountRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(AccountEntity).findOneByOrFail({ id });
  const traineeRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TraineeProfileEntity).findOneByOrFail({ id });
  const trainerRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TrainerProfileEntity).findOneByOrFail({ id });

  async function login(fx: Fixtures, email: string, password = PASSWORD) {
    const { accessToken } = await auth(fx).login(
      await auth(fx).validateUser(email, password),
    );
    return decodeVerifiedJwt(accessToken).payload;
  }

  describe('ACC-20 register', () => {
    it('stores the account unconnected, with the registration as entered and the consent time', async () => {
      const fx = fixtures();
      const gym = await fx.location('Center');
      const card = await fx.gymSubscription('MultiSport');
      const before = Date.now();

      const res = await registration(fx).register(
        registerDto({
          email: '  Ivan@Example.COM ',
          name: '  Ivan Petrov ',
          phone: ' +359  88 123 4567 ',
          gymSubscriptionId: card.id,
          preferredGymId: gym.id,
          instagram: ' @ivan ',
          facebook: '',
        }),
      );

      expect(res).toMatchObject({
        email: 'ivan@example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        hasUpdatedInitialPassword: true,
        traineeProfileId: null,
        trainerProfileId: null,
      });
      expect(res).not.toHaveProperty('passwordHash');

      const row = await accountRow(fx, res.id);
      expect(row.registration).toEqual({
        name: 'Ivan Petrov',
        phone: '+359 88 123 4567',
        gymSubscriptionId: card.id,
        preferredGymId: gym.id,
        instagram: '@ivan',
        facebook: null,
        tiktok: null,
      });
      expect(row.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.passwordHash).not.toBe(PASSWORD);
      // No profile is created until an admin connects the account.
      expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(0);
    });

    it('refuses an email any account already has, in any case', async () => {
      const fx = fixtures();
      await fx.ds.getRepository(AccountEntity).save({
        email: 'Taken@Example.com',
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
        passwordHash: null,
      });

      const err = await rejectionOf(
        registration(fx).register(registerDto({ email: 'taken@example.COM' })),
      );

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe('Email is already used by another account');
      expect(await fx.ds.getRepository(AccountEntity).count()).toBe(1);
    });

    it('refuses passwords that differ, and inactive or unknown gyms and gym subscriptions', async () => {
      const fx = fixtures();
      const closedGym = await fx.location('Old', { isActive: false });
      const oldCard = await fx.ds
        .getRepository(GymSubscriptionEntity)
        .save({ name: 'Old card', isActive: false });

      const cases: [Partial<RegisterDto>, string][] = [
        [{ confirmPassword: 'other-pass-1' }, 'Passwords do not match'],
        [{ preferredGymId: closedGym.id }, 'Gym is inactive'],
        [{ preferredGymId: randomUUID() }, 'Unknown gym'],
        [
          { gymSubscriptionId: oldCard.id },
          'Gym subscription not found or inactive',
        ],
      ];
      for (const [over, message] of cases) {
        const err = await rejectionOf(
          registration(fx).register(registerDto(over)),
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toBe(message);
      }
      expect(await fx.ds.getRepository(AccountEntity).count()).toBe(0);
    });

    it('options lists the active gyms and gym subscriptions by name', async () => {
      const fx = fixtures();
      const b = await fx.location('B gym');
      const a = await fx.location('A gym');
      await fx.location('Closed', { isActive: false });
      const card = await fx.gymSubscription('MultiSport');

      expect(await registration(fx).options()).toEqual({
        gyms: [
          { id: a.id, name: 'A gym' },
          { id: b.id, name: 'B gym' },
        ],
        gymSubscriptions: [{ id: card.id, name: 'MultiSport' }],
      });
    });
  });

  describe('ACC-21 login', () => {
    it('refuses an unconnected account with 403 after the right password, 401 with a wrong one', async () => {
      const fx = fixtures();
      await registration(fx).register(registerDto());

      const ok = await rejectionOf(
        auth(fx).validateUser('ivan@example.com', PASSWORD),
      );
      expect(ok).toBeInstanceOf(ForbiddenException);
      expect(ok.message).toBe(NOT_LINKED_MESSAGE);

      const wrong = await rejectionOf(
        auth(fx).validateUser('ivan@example.com', 'wrong-pass-1'),
      );
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(wrong.message).toBe('Invalid credentials');
    });

    it('logs in with the typed case once connected (the email is stored lowercased)', async () => {
      const fx = fixtures();
      const acc = await registration(fx).register(
        registerDto({ email: 'Ivan@Example.com' }),
      );
      await admin(fx).link(acc.id, { profileType: 'trainee', name: 'Ivan' });

      const payload = await login(fx, 'Ivan@Example.com');
      expect(payload).toMatchObject({
        sub: acc.id,
        email: 'ivan@example.com',
      });
    });
  });

  describe('ACC-22 list and details', () => {
    async function seed(fx: Fixtures) {
      const gym = await fx.location('Center');
      const waiting = await registration(fx).register(
        registerDto({
          email: 'waiting@example.com',
          name: 'Maria Ivanova',
          phone: '0899 555 111',
          preferredGymId: gym.id,
        }),
      );
      const connected = await registration(fx).register(
        registerDto({ email: 'connected@example.com', name: 'Georgi' }),
      );
      await admin(fx).link(connected.id, {
        profileType: 'trainee',
        name: 'Georgi Dimitrov',
        nickname: 'Gosho',
      });
      return { gym, waiting, connected };
    }

    it('unlinked (the default) lists the accounts waiting, never admins; linked and all the rest', async () => {
      const fx = fixtures();
      await fx.ds.getRepository(AccountEntity).save({
        email: 'admin',
        role: AccountRole.ADMIN,
        status: AccountStatus.ACTIVE,
        passwordHash: null,
      });
      const { gym, waiting, connected } = await seed(fx);

      const unlinked = await admin(fx).list({});
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]).toMatchObject({
        id: waiting.id,
        email: 'waiting@example.com',
        profile: null,
        registration: {
          name: 'Maria Ivanova',
          phone: '0899 555 111',
          preferredGym: { id: gym.id, name: 'Center' },
          gymSubscription: null,
        },
      });
      expect(unlinked[0]).not.toHaveProperty('passwordHash');

      const linked = await admin(fx).list({ link: 'linked' });
      expect(linked.map((a) => a.id)).toEqual([connected.id]);
      expect(linked[0].profile).toMatchObject({
        type: 'trainee',
        name: 'Georgi Dimitrov',
        nickname: 'Gosho',
        isActive: true,
      });

      const all = await admin(fx).list({ link: 'all' });
      expect(all).toHaveLength(3);
      // Newest first.
      expect(all[0].email).toBe('connected@example.com');
    });

    it('search matches the email, registered name and phone, and the profile name', async () => {
      const fx = fixtures();
      const { waiting, connected } = await seed(fx);
      const ids = async (search: string) =>
        (await admin(fx).list({ link: 'all', search })).map((a) => a.id);

      expect(await ids('WAITING@')).toEqual([waiting.id]);
      expect(await ids('maria')).toEqual([waiting.id]);
      expect(await ids('555')).toEqual([waiting.id]);
      expect(await ids('Dimitrov')).toEqual([connected.id]);
      expect(await ids('%')).toEqual([]);
    });

    it('details gives one account; 404 for an unknown one', async () => {
      const fx = fixtures();
      const { waiting } = await seed(fx);

      expect(await admin(fx).details(waiting.id)).toMatchObject({
        id: waiting.id,
        registration: { name: 'Maria Ivanova' },
      });
      const err = await rejectionOf(admin(fx).details(randomUUID()));
      expect(err).toBeInstanceOf(NotFoundException);
    });
  });

  describe('ACC-23 link', () => {
    it('creates a new trainee with what the admin decided; the account logs in with its claim', async () => {
      const fx = fixtures();
      const gym = await fx.location('Center');
      const card = await fx.gymSubscription('MultiSport');
      const acc = await registration(fx).register(registerDto());

      const view = await admin(fx).link(acc.id, {
        profileType: 'trainee',
        name: ' Ivan P. ',
        nickname: 'Vanko',
        phone: '0888 000 111',
        gymSubscriptionId: card.id,
        homeGymId: gym.id,
        instagram: '@ivan.p',
      });

      const row = await accountRow(fx, acc.id);
      expect(row.role).toBe(AccountRole.TRAINEE);
      const trainee = await traineeRow(fx, row.traineeProfileId!);
      expect(trainee).toMatchObject({
        name: 'Ivan P.',
        nickname: 'Vanko',
        phone: '0888 000 111',
        gymSubscriptionId: card.id,
        preferredGymId: gym.id,
        instagram: '@ivan.p',
        facebook: null,
        tiktok: null,
        isActive: true,
        accountId: acc.id,
      });
      expect(view.profile).toMatchObject({ type: 'trainee', id: trainee.id });

      expect(await login(fx, 'ivan@example.com')).toMatchObject({
        role: AccountRole.TRAINEE,
        traineeProfileId: trainee.id,
        trainerProfileId: null,
      });
    });

    it('connects an existing trainee, changing only the fields sent', async () => {
      const fx = fixtures();
      const card = await fx.gymSubscription('MultiSport');
      const trainee = await fx.trainee('Ivan', {
        nickname: 'Vanko',
        phone: '0888 1',
        gymSubscriptionId: card.id,
      });
      const acc = await registration(fx).register(registerDto());

      await admin(fx).link(acc.id, {
        profileType: 'trainee',
        profileId: trainee.id,
        name: 'Ivan Petrov',
        phone: '0888 123 456',
      });

      expect(await traineeRow(fx, trainee.id)).toMatchObject({
        name: 'Ivan Petrov',
        nickname: 'Vanko',
        phone: '0888 123 456',
        gymSubscriptionId: card.id,
        accountId: acc.id,
      });
      expect((await accountRow(fx, acc.id)).traineeProfileId).toBe(trainee.id);
    });

    it('connects a trainer: the account becomes TRAINER with the trainer claim', async () => {
      const fx = fixtures();
      const gym = await fx.location('Center');
      const trainer = await fx.trainer('Petar');
      const acc = await registration(fx).register(registerDto());

      await admin(fx).link(acc.id, {
        profileType: 'trainer',
        profileId: trainer.id,
        name: 'Petar Georgiev',
        phone: '0877 222 333',
        homeGymId: gym.id,
        tiktok: '@petar',
      });

      expect(await trainerRow(fx, trainer.id)).toMatchObject({
        name: 'Petar Georgiev',
        phone: '0877 222 333',
        primaryGymId: gym.id,
        tiktok: '@petar',
        accountId: acc.id,
      });
      expect(await login(fx, 'ivan@example.com')).toMatchObject({
        role: AccountRole.TRAINER,
        trainerProfileId: trainer.id,
        traineeProfileId: null,
      });
    });

    it('refuses what it must, changing nothing', async () => {
      const fx = fixtures();
      const card = await fx.gymSubscription('MultiSport');
      const inactive = await fx.trainee('Gone', { isActive: false });
      const taken = await fx.trainee('Taken');
      const other = await registration(fx).register(
        registerDto({ email: 'other@example.com' }),
      );
      await admin(fx).link(other.id, {
        profileType: 'trainee',
        profileId: taken.id,
        name: 'Taken',
      });
      const acc = await registration(fx).register(registerDto());
      const adminAcc = await fx.ds.getRepository(AccountEntity).save({
        email: 'admin',
        role: AccountRole.ADMIN,
        status: AccountStatus.ACTIVE,
        passwordHash: null,
      });

      const cases: [
        string,
        Parameters<AccountAdminService['link']>[1],
        unknown,
        string,
      ][] = [
        [
          acc.id,
          { profileType: 'trainee', profileId: inactive.id, name: 'X' },
          BadRequestException,
          'Trainee profile is inactive',
        ],
        [
          acc.id,
          { profileType: 'trainee', profileId: taken.id, name: 'X' },
          ConflictException,
          'This trainee already has an account',
        ],
        [
          acc.id,
          { profileType: 'trainee', profileId: randomUUID(), name: 'X' },
          NotFoundException,
          'Trainee not found',
        ],
        [
          acc.id,
          { profileType: 'trainer', name: 'X', gymSubscriptionId: card.id },
          BadRequestException,
          'Trainers have no gym subscription',
        ],
        [
          other.id,
          { profileType: 'trainee', name: 'X' },
          ConflictException,
          'Account is already connected to a profile',
        ],
        [
          adminAcc.id,
          { profileType: 'trainee', name: 'X' },
          BadRequestException,
          'Admin accounts cannot be connected to a profile',
        ],
        [
          randomUUID(),
          { profileType: 'trainee', name: 'X' },
          NotFoundException,
          'Account not found',
        ],
      ];
      for (const [id, dto, type, message] of cases) {
        const err = await rejectionOf(admin(fx).link(id, dto));
        expect(err).toBeInstanceOf(type);
        expect(err.message).toBe(message);
      }

      expect((await accountRow(fx, acc.id)).traineeProfileId).toBeNull();
      expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(2);
      expect(await fx.ds.getRepository(TrainerProfileEntity).count()).toBe(0);
    });
  });

  describe('ACC-24 delete permanently', () => {
    it('removes an unconnected account', async () => {
      const fx = fixtures();
      const acc = await registration(fx).register(registerDto());

      expect(await admin(fx).deletePermanently(acc.id)).toEqual({
        id: acc.id,
        deleted: true,
      });
      expect(await fx.ds.getRepository(AccountEntity).count()).toBe(0);
      // The email is free again.
      await registration(fx).register(registerDto());
    });

    it('refuses a connected account (on either side) and an admin account', async () => {
      const fx = fixtures();
      const connected = await registration(fx).register(registerDto());
      await admin(fx).link(connected.id, { profileType: 'trainee', name: 'I' });
      const profileSide = await registration(fx).register(
        registerDto({ email: 'side@example.com' }),
      );
      await fx.trainee('Side', { accountId: profileSide.id });
      const adminAcc = await fx.ds.getRepository(AccountEntity).save({
        email: 'admin',
        role: AccountRole.ADMIN,
        status: AccountStatus.ACTIVE,
        passwordHash: null,
      });

      for (const id of [connected.id, profileSide.id, adminAcc.id]) {
        const err = await rejectionOf(admin(fx).deletePermanently(id));
        expect(err).toBeInstanceOf(ConflictException);
      }
      expect(await fx.ds.getRepository(AccountEntity).count()).toBe(3);
      const unknown = await rejectionOf(
        admin(fx).deletePermanently(randomUUID()),
      );
      expect(unknown).toBeInstanceOf(NotFoundException);
    });
  });

  describe('ACC-25 my profile', () => {
    it('a trainee reads and changes their own details, never the nickname', async () => {
      const fx = fixtures();
      const gym = await fx.location('Center');
      const card = await fx.gymSubscription('MultiSport');
      const acc = await registration(fx).register(registerDto());
      await admin(fx).link(acc.id, {
        profileType: 'trainee',
        name: 'Ivan Petrov',
        nickname: 'Vanko',
        phone: '0888 123 456',
      });

      const before = await myProfile(fx).get(acc.id);
      expect(before).toEqual({
        profileType: 'trainee',
        email: 'ivan@example.com',
        name: 'Ivan Petrov',
        phone: '0888 123 456',
        gymSubscriptionId: null,
        homeGymId: null,
        instagram: null,
        facebook: null,
        tiktok: null,
        consentAt: (await accountRow(fx, acc.id)).consentAt,
      });
      expect(before.consentAt).toBeInstanceOf(Date);
      expect(JSON.stringify(before)).not.toContain('Vanko');

      const after = await myProfile(fx).update(acc.id, {
        phone: ' 0899  000 111 ',
        gymSubscriptionId: card.id,
        homeGymId: gym.id,
        facebook: 'https://facebook.com/ivan',
      });
      expect(after).toMatchObject({
        phone: '0899 000 111',
        gymSubscriptionId: card.id,
        homeGymId: gym.id,
        facebook: 'https://facebook.com/ivan',
      });
      expect(after).not.toHaveProperty('nickname');

      const trainee = await traineeRow(
        fx,
        (await accountRow(fx, acc.id)).traineeProfileId!,
      );
      expect(trainee).toMatchObject({
        phone: '0899 000 111',
        gymSubscriptionId: card.id,
        preferredGymId: gym.id,
        facebook: 'https://facebook.com/ivan',
        nickname: 'Vanko',
        name: 'Ivan Petrov',
      });

      // Clearing optional fields.
      expect(
        await myProfile(fx).update(acc.id, {
          gymSubscriptionId: null,
          homeGymId: null,
          facebook: '',
        }),
      ).toMatchObject({
        gymSubscriptionId: null,
        homeGymId: null,
        facebook: null,
      });
    });

    it('a trainer changes their primary gym; a gym subscription is refused', async () => {
      const fx = fixtures();
      const gym = await fx.location('Center');
      const card = await fx.gymSubscription('MultiSport');
      const acc = await registration(fx).register(registerDto());
      await admin(fx).link(acc.id, { profileType: 'trainer', name: 'Petar' });

      expect(
        await myProfile(fx).update(acc.id, { homeGymId: gym.id }),
      ).toMatchObject({
        profileType: 'trainer',
        homeGymId: gym.id,
        gymSubscriptionId: null,
      });

      const err = await rejectionOf(
        myProfile(fx).update(acc.id, { gymSubscriptionId: card.id }),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Trainers have no gym subscription');
    });

    it('an account without a profile gets 403', async () => {
      const fx = fixtures();
      const acc = await registration(fx).register(registerDto());

      const err = await rejectionOf(myProfile(fx).get(acc.id));
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe('Your account is not connected to a profile');
    });
  });
});
