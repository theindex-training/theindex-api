import { randomUUID } from 'crypto';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authImports, decodeVerifiedJwt } from '../../test/int/auth-setup';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AuthService } from '../auth/auth.service';
import { GymSubscriptionEntity } from '../gym-subscriptions/gym-subscription.entity';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { TraineeProfileEntity } from './trainee-profile.entity';
import { TraineeProfilesModule } from './trainee-profiles.module';
import { TraineeProfilesService } from './trainee-profiles.service';

const { PAID, UNPAID } = AttendancePaymentStatus;
const PASSWORD = 'trainee-pass-1';

describe('TraineeProfilesService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [...authImports(), TraineeProfilesModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(TraineeProfilesService);
  const traineeRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TraineeProfileEntity).findOneByOrFail({ id });
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

  describe('list', () => {
    it('TRN-02 active filter and ordering by name ASC, nickname ASC (nulls last)', async () => {
      const fx = fixtures();
      const bob = await fx.trainee('Bob');
      const anaZ = await fx.trainee('Ana', { nickname: 'Zed' });
      const anaNull = await fx.trainee('Ana');
      const anaA = await fx.trainee('Ana', { nickname: 'Al' });
      const cid = await fx.trainee('Cid', { isActive: false });

      const ids = (rows: TraineeProfileEntity[]) => rows.map((t) => t.id);
      expect(ids(await svc(fx).list({}))).toEqual([
        anaA.id,
        anaZ.id,
        anaNull.id,
        bob.id,
        cid.id,
      ]);
      expect(ids(await svc(fx).list({ active: true }))).toEqual([
        anaA.id,
        anaZ.id,
        anaNull.id,
        bob.id,
      ]);
      expect(ids(await svc(fx).list({ active: false }))).toEqual([cid.id]);
    });

    // CHARACTERIZATION: possibly unintended
    it('TRN-01 any non-blank search fails with a non-HTTP error (500); blank search is ignored', async () => {
      const fx = fixtures();
      const ana = await fx.trainee('Ana', { phone: '0888123456' });
      const off = await fx.trainee('Off', { isActive: false });

      for (const search of ['Ana', '0888', 'zzz']) {
        const err = await rejectionOf(svc(fx).list({ search }));
        // Not an HttpException, so Nest answers 500.
        expect(err).not.toBeInstanceOf(HttpException);
        expect(err.message).toContain('firstName');
      }

      const blank = await svc(fx).list({ search: '   ' });
      expect(blank.map((t) => t.id)).toEqual([ana.id, off.id]);
      const blankActive = await svc(fx).list({ search: '', active: true });
      expect(blankActive.map((t) => t.id)).toEqual([ana.id]);
    });
  });

  describe('create', () => {
    it('TRN-03 trims name/nickname/phone, defaults to active, optional fields null', async () => {
      const fx = fixtures();
      const gs = await fx.gymSubscription('MultiSport');

      const full = await svc(fx).create({
        name: '  Ana Ivanova ',
        nickname: ' Ani ',
        phone: ' 0888 123 ',
        gymSubscriptionId: gs.id,
      });
      const bare = await svc(fx).create({ name: 'Bob' });

      expect(await traineeRow(fx, full.id)).toMatchObject({
        name: 'Ana Ivanova',
        nickname: 'Ani',
        phone: '0888 123',
        gymSubscriptionId: gs.id,
        accountId: null,
        isActive: true,
      });
      expect(await traineeRow(fx, bare.id)).toMatchObject({
        name: 'Bob',
        nickname: null,
        phone: null,
        gymSubscriptionId: null,
        accountId: null,
        isActive: true,
      });
    });

    it('TRN-03 inactive or missing gym subscription -> 400, nothing stored', async () => {
      const fx = fixtures();
      const inactive = await fx.gymSubscription('Old');
      await fx.ds
        .getRepository(GymSubscriptionEntity)
        .update({ id: inactive.id }, { isActive: false });

      await expectBadRequest(
        svc(fx).create({ name: 'Ana', gymSubscriptionId: inactive.id }),
        'Gym subscription not found or inactive',
      );
      await expectBadRequest(
        svc(fx).create({ name: 'Ana', gymSubscriptionId: randomUUID() }),
        'Gym subscription not found or inactive',
      );
      expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(0);
    });

    it('TRN-03 an accountId already linked to another trainee -> 400', async () => {
      const fx = fixtures();
      const account = await insertAccount(fx, AccountRole.TRAINEE);
      await svc(fx).create({ name: 'First', accountId: account.id });

      await expectBadRequest(
        svc(fx).create({ name: 'Second', accountId: account.id }),
        'This account is already linked to another trainee',
      );
      expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(1);
    });

    // CHARACTERIZATION: possibly unintended
    it('TRN-03 accepts a TRAINER account id and never links the account back', async () => {
      const fx = fixtures();
      const trainerAccount = await insertAccount(fx, AccountRole.TRAINER);
      const traineeAccount = await insertAccount(fx, AccountRole.TRAINEE);

      const a = await svc(fx).create({
        name: 'Ana',
        accountId: trainerAccount.id,
      });
      const b = await svc(fx).create({
        name: 'Bob',
        accountId: traineeAccount.id,
      });

      expect((await traineeRow(fx, a.id)).accountId).toBe(trainerAccount.id);
      expect((await traineeRow(fx, b.id)).accountId).toBe(traineeAccount.id);
      // The account side stays unlinked, so its JWT has traineeProfileId: null.
      expect(
        (await accountRow(fx, trainerAccount.id)).traineeProfileId,
      ).toBeNull();
      expect(
        (await accountRow(fx, traineeAccount.id)).traineeProfileId,
      ).toBeNull();
    });

    // CHARACTERIZATION: possibly unintended
    it('TRN-03 an unknown accountId fails on the DB foreign key (non-HTTP error, 500)', async () => {
      const fx = fixtures();

      const err = await rejectionOf(
        svc(fx).create({ name: 'Ana', accountId: randomUUID() }),
      );

      expect(err).not.toBeInstanceOf(HttpException);
      expect(err.message).toMatch(/foreign key/i);
      expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(0);
    });
  });

  describe('update', () => {
    it('TRN-05 partial update; nickname/phone null clear; strings trimmed', async () => {
      const fx = fixtures();
      const t = await fx.trainee('Ana', { nickname: 'Ani', phone: '0888' });

      await svc(fx).update(t.id, { name: ' Ana I. ' });
      expect(await traineeRow(fx, t.id)).toMatchObject({
        name: 'Ana I.',
        nickname: 'Ani',
        phone: '0888',
        isActive: true,
      });

      await svc(fx).update(t.id, {
        name: 'Ana I.',
        nickname: ' Nini ',
        phone: ' 0999 ',
        isActive: false,
      });
      expect(await traineeRow(fx, t.id)).toMatchObject({
        nickname: 'Nini',
        phone: '0999',
        isActive: false,
      });

      await svc(fx).update(t.id, {
        name: 'Ana I.',
        nickname: null,
        phone: null,
      });
      expect(await traineeRow(fx, t.id)).toMatchObject({
        nickname: null,
        phone: null,
      });
    });

    it('TRN-05 gymSubscriptionId: null clears it; a new one must be active', async () => {
      const fx = fixtures();
      const gs = await fx.gymSubscription('MultiSport');
      const other = await fx.gymSubscription('Other');
      const t = await fx.trainee('Ana', { gymSubscriptionId: gs.id });
      await fx.ds
        .getRepository(GymSubscriptionEntity)
        .update({ id: other.id }, { isActive: false });

      await expectBadRequest(
        svc(fx).update(t.id, { name: 'Ana', gymSubscriptionId: other.id }),
        'Gym subscription not found or inactive',
      );
      expect((await traineeRow(fx, t.id)).gymSubscriptionId).toBe(gs.id);

      await svc(fx).update(t.id, { name: 'Ana', gymSubscriptionId: null });
      expect((await traineeRow(fx, t.id)).gymSubscriptionId).toBeNull();

      await svc(fx).update(t.id, { name: 'Ana', gymSubscriptionId: gs.id });
      expect((await traineeRow(fx, t.id)).gymSubscriptionId).toBe(gs.id);
    });

    it('TRN-05 accountId: conflict -> 400, own id OK, null unlinks the profile side only', async () => {
      const fx = fixtures();
      const accA = await insertAccount(fx, AccountRole.TRAINEE);
      const accB = await insertAccount(fx, AccountRole.TRAINEE);
      const a = await fx.trainee('Ana', { accountId: accA.id });
      await fx.ds
        .getRepository(AccountEntity)
        .update({ id: accA.id }, { traineeProfileId: a.id });
      const b = await fx.trainee('Bob', { accountId: accB.id });

      await expectBadRequest(
        svc(fx).update(b.id, { name: 'Bob', accountId: accA.id }),
        'This account is already linked to another trainee',
      );
      expect((await traineeRow(fx, b.id)).accountId).toBe(accB.id);

      await svc(fx).update(a.id, { name: 'Ana', accountId: accA.id });
      expect((await traineeRow(fx, a.id)).accountId).toBe(accA.id);

      await svc(fx).update(a.id, { name: 'Ana', accountId: null });
      expect((await traineeRow(fx, a.id)).accountId).toBeNull();
      expect((await accountRow(fx, accA.id)).traineeProfileId).toBe(a.id);

      // Once unlinked, another profile can take the account.
      await svc(fx).update(b.id, { name: 'Bob', accountId: accA.id });
      expect((await traineeRow(fx, b.id)).accountId).toBe(accA.id);
    });

    it('TRN-05 unknown id -> 404 Trainee not found', async () => {
      const fx = fixtures();
      const id = randomUUID();

      for (const call of [
        () => svc(fx).getById(id),
        () => svc(fx).update(id, { name: 'X' }),
        () => svc(fx).deactivate(id),
        () => svc(fx).overview(id),
        () => svc(fx).trainingInsights(id),
      ]) {
        const err = await rejectionOf(call());
        expect(err).toBeInstanceOf(NotFoundException);
        expect(err.message).toBe('Trainee not found');
      }
    });
  });

  describe('deactivate', () => {
    it('TRN-06 deactivate keeps the row and blocks new attendance and subscriptions', async () => {
      const fx = fixtures();
      const [t, trainer, loc] = await Promise.all([
        fx.trainee('Ana'),
        fx.trainer('Coach'),
        fx.location(),
      ]);
      const plan = await fx.punchPlan(5, 5000);
      await fx.attend(t.id, trainer.id, loc.id, '2025-12-01T10:00:00Z');

      const result = await svc(fx).deactivate(t.id);

      expect(result).toMatchObject({ id: t.id, isActive: false });
      expect((await traineeRow(fx, t.id)).isActive).toBe(false);
      expect(await fx.attendanceRows()).toHaveLength(1);

      await expectBadRequest(
        fx.attend(t.id, trainer.id, loc.id, '2025-12-02T10:00:00Z'),
        'Trainee not found or inactive',
      );
      await expectBadRequest(
        fx.buy(t.id, plan.id),
        'Trainee not found or inactive',
      );
      expect(await fx.attendanceRows()).toHaveLength(1);
      expect(await fx.subscriptionRows()).toHaveLength(0);
    });

    // CHARACTERIZATION: possibly unintended
    it("TRN-06 the deactivated trainee's linked account can still log in with its profile claim", async () => {
      const fx = fixtures();
      const t = await fx.trainee('Ana');
      const account = await insertAccount(fx, AccountRole.TRAINEE, {
        traineeProfileId: t.id,
      });
      await svc(fx).update(t.id, { name: 'Ana', accountId: account.id });

      await svc(fx).deactivate(t.id);

      const auth = fx.moduleRef.get(AuthService);
      const acc = await auth.validateUser(account.email!, PASSWORD);
      const { accessToken } = await auth.login(acc);
      expect(decodeVerifiedJwt(accessToken).payload).toMatchObject({
        sub: account.id,
        role: AccountRole.TRAINEE,
        traineeProfileId: t.id,
      });
    });
  });

  describe('overview', () => {
    it('TRN-07 active subscriptions: ACTIVE PUNCH with credits or ACTIVE TIME with endsAt > now, startsAt ASC', async () => {
      const fx = fixtures();
      freezeTime('2025-12-15T12:00:00.000Z');
      const t = await fx.trainee('Ana');
      const other = await fx.trainee('Bob');
      const punchPlan = await fx.punchPlan(10, 10000);
      const timePlan = await fx.timePlan(30, 9000);
      const base = { traineeId: t.id };

      const punchActive = await fx.insertSubscription({
        ...base,
        planId: punchPlan.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-05T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 3,
      });
      // Not started yet, but counts as active.
      const timeFuture = await fx.insertSubscription({
        ...base,
        planId: timePlan.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-12-20T00:00:00Z'),
        endsAt: new Date('2026-01-19T00:00:00Z'),
      });
      const timeRunning = await fx.insertSubscription({
        ...base,
        planId: timePlan.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        endsAt: new Date('2025-12-31T00:00:00Z'),
      });
      // Excluded: no credits, wrong status, ended exactly now, other trainee.
      await fx.insertSubscription({
        ...base,
        planId: punchPlan.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-02T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 0,
      });
      await fx.insertSubscription({
        ...base,
        planId: punchPlan.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-03T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 5,
        status: SubscriptionStatus.CANCELLED,
      });
      await fx.insertSubscription({
        ...base,
        planId: timePlan.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-15T12:00:00Z'),
        endsAt: new Date('2025-12-15T12:00:00.000Z'),
      });
      await fx.insertSubscription({
        traineeId: other.id,
        planId: punchPlan.id,
        type: PlanType.PUNCH,
        startsAt: new Date('2025-12-01T00:00:00Z'),
        initialCredits: 10,
        remainingCredits: 10,
      });

      const view = await svc(fx).overview(t.id);

      expect(view.trainee).toMatchObject({ id: t.id, name: 'Ana' });
      expect(view.subscriptions.active.map((s) => s.id)).toEqual([
        timeRunning.id,
        punchActive.id,
        timeFuture.id,
      ]);
      expect(view.subscriptions.recent).toHaveLength(6);
      expect(view.subscriptions.recent.every((s) => s.traineeId === t.id)).toBe(
        true,
      );
    });

    it('TRN-07 recent subscriptions: at most 10, startsAt DESC', async () => {
      const fx = fixtures();
      const t = await fx.trainee('Ana');
      const plan = await fx.punchPlan(1, 100);
      const subs: string[] = [];
      for (let day = 1; day <= 12; day++) {
        const s = await fx.insertSubscription({
          traineeId: t.id,
          planId: plan.id,
          type: PlanType.PUNCH,
          startsAt: new Date(Date.UTC(2025, 11, day)),
          initialCredits: 1,
          remainingCredits: 0,
          status: SubscriptionStatus.EXHAUSTED,
        });
        subs.push(s.id);
      }

      const view = await svc(fx).overview(t.id);

      expect(view.subscriptions.recent.map((s) => s.id)).toEqual(
        subs.slice(2).reverse(),
      );
      expect(view.subscriptions.active).toEqual([]);
    });

    it('TRN-07 recent attendance: at most 20, trainedAt DESC, trainer + subscription summary', async () => {
      const fx = fixtures();
      const t = await fx.trainee('Ana');
      const other = await fx.trainee('Bob');
      const trainer = await fx.trainer('Coach', { nickname: 'C' });
      const loc = await fx.location();
      const plan = await fx.timePlan(30, 9000);
      const sub = await fx.insertSubscription({
        traineeId: t.id,
        planId: plan.id,
        type: PlanType.TIME,
        startsAt: new Date('2025-11-01T00:00:00Z'),
        endsAt: new Date('2025-12-01T00:00:00Z'),
      });

      const rows: string[] = [];
      for (let day = 1; day <= 22; day++) {
        const paid = day % 2 === 0;
        const a = await fx.insertAttendance({
          traineeId: t.id,
          trainerId: trainer.id,
          locationId: loc.id,
          trainedAt: new Date(Date.UTC(2025, 10, day, 10)),
          paymentStatus: paid ? PAID : UNPAID,
          subscriptionId: paid ? sub.id : null,
        });
        rows.push(a.id);
      }
      await fx.insertAttendance({
        traineeId: other.id,
        trainerId: trainer.id,
        locationId: loc.id,
        trainedAt: new Date('2025-11-30T10:00:00Z'),
      });

      const view = await svc(fx).overview(t.id);

      const recent = view.attendance.recent;
      expect(recent.map((a) => a.id)).toEqual(rows.slice(2).reverse());
      expect(recent[0]).toEqual({
        id: rows[21],
        trainedAt: '2025-11-22T10:00:00.000Z',
        paymentStatus: PAID,
        trainer: { id: trainer.id, name: 'Coach', nickname: 'C' },
        subscription: { id: sub.id, type: PlanType.TIME },
      });
      expect(recent[1]).toEqual({
        id: rows[20],
        trainedAt: '2025-11-21T10:00:00.000Z',
        paymentStatus: UNPAID,
        trainer: { id: trainer.id, name: 'Coach', nickname: 'C' },
        subscription: null,
      });
    });
  });

  describe('trainingInsights', () => {
    it('TRN-08 partners need same trainer + location + exact trainedAt; tops ordered by count then name', async () => {
      const fx = fixtures();
      const [ana, bob, cid, dan, eve] = await Promise.all([
        fx.trainee('Ana'),
        fx.trainee('Bob'),
        fx.trainee('Cid'),
        fx.trainee('Dan'),
        fx.trainee('Eve'),
      ]);
      const [zed, amy] = await Promise.all([
        fx.trainer('Zed'),
        fx.trainer('Amy'),
      ]);
      const [north, south] = await Promise.all([
        fx.location('North'),
        fx.location('South'),
      ]);
      const at = (
        traineeId: string,
        trainerId: string,
        locationId: string,
        trainedAt: string,
      ) =>
        fx.insertAttendance({
          traineeId,
          trainerId,
          locationId,
          trainedAt: new Date(trainedAt),
        });

      // Tue 2025-12-02 00:30 Sofia (Mon 22:30 UTC).
      const s1 = '2025-12-01T22:30:00.000Z';
      // Tue 2025-12-09 18:15 Sofia.
      const s2 = '2025-12-09T16:15:00.000Z';
      // Thu 2025-12-11 18:45 Sofia.
      const s3 = '2025-12-11T16:45:00.000Z';

      await at(ana.id, zed.id, north.id, s1);
      await at(ana.id, zed.id, north.id, s2);
      await at(ana.id, amy.id, south.id, s3);

      await at(bob.id, zed.id, north.id, s1);
      await at(bob.id, zed.id, north.id, s2);
      await at(cid.id, zed.id, north.id, s2);
      await at(cid.id, amy.id, south.id, s3);
      // Not partners: other trainer, other location, 1 s off.
      await at(dan.id, amy.id, north.id, s1);
      await at(dan.id, zed.id, south.id, s2);
      await at(eve.id, zed.id, north.id, '2025-12-01T22:30:01.000Z');

      const insights = await svc(fx).trainingInsights(ana.id);

      expect(insights.traineeId).toBe(ana.id);
      expect(insights.totalAttendances).toBe(3);
      expect(insights.topTrainingPartners).toEqual([
        { traineeId: bob.id, traineeName: 'Bob', trainingsTogether: 2 },
        { traineeId: cid.id, traineeName: 'Cid', trainingsTogether: 2 },
      ]);
      expect(insights.topTrainers).toEqual([
        { trainerId: zed.id, trainerName: 'Zed', trainingsCount: 2 },
        { trainerId: amy.id, trainerName: 'Amy', trainingsCount: 1 },
      ]);
      expect(insights.topGyms).toEqual([
        { gymId: north.id, gymName: 'North', trainingsCount: 2 },
        { gymId: south.id, gymName: 'South', trainingsCount: 1 },
      ]);
      expect(
        insights.topWeekdays.map(({ weekdayNumber, trainingsCount }) => ({
          weekdayNumber,
          trainingsCount,
        })),
      ).toEqual([
        { weekdayNumber: 2, trainingsCount: 2 },
        { weekdayNumber: 4, trainingsCount: 1 },
      ]);
      // Day names come from the DB locale (lc_time).
      expect(insights.topWeekdays[0].weekday).toMatch(/^tue/i);
      // Sofia hours: 00:30, 18:15 and 18:45.
      expect(insights.topTimeSlots).toEqual([
        { timeSlot: '18:00-18:59', trainingsCount: 2 },
        { timeSlot: '00:00-00:59', trainingsCount: 1 },
      ]);
    });

    it('TRN-08 ties order by name / weekday / slot ascending; no attendance gives zeros', async () => {
      const fx = fixtures();
      const [ana, bob, cid] = await Promise.all([
        fx.trainee('Ana'),
        fx.trainee('Bob'),
        fx.trainee('Cid'),
      ]);
      const [zed, amy] = await Promise.all([
        fx.trainer('Zed'),
        fx.trainer('Amy'),
      ]);
      const loc = await fx.location('Main');
      const at = (traineeId: string, trainerId: string, trainedAt: string) =>
        fx.insertAttendance({
          traineeId,
          trainerId,
          locationId: loc.id,
          trainedAt: new Date(trainedAt),
        });

      // Wed 09:00 Sofia with Zed (Cid joins), Mon 07:00 Sofia with Amy (Bob joins).
      await at(ana.id, zed.id, '2025-12-03T07:00:00.000Z');
      await at(cid.id, zed.id, '2025-12-03T07:00:00.000Z');
      await at(ana.id, amy.id, '2025-12-01T05:00:00.000Z');
      await at(bob.id, amy.id, '2025-12-01T05:00:00.000Z');

      const insights = await svc(fx).trainingInsights(ana.id);

      expect(insights.topTrainingPartners.map((p) => p.traineeName)).toEqual([
        'Bob',
        'Cid',
      ]);
      expect(insights.topTrainers.map((p) => p.trainerName)).toEqual([
        'Amy',
        'Zed',
      ]);
      expect(insights.topWeekdays.map((w) => w.weekdayNumber)).toEqual([1, 3]);
      expect(insights.topTimeSlots.map((s) => s.timeSlot)).toEqual([
        '07:00-07:59',
        '09:00-09:59',
      ]);

      const dan = await fx.trainee('Dan');
      const empty = await svc(fx).trainingInsights(dan.id);
      expect(empty).toMatchObject({
        totalAttendances: 0,
        topTrainingPartners: [],
        topTrainers: [],
        topGyms: [],
        topWeekdays: [],
        topTimeSlots: [],
      });
    });
  });
});
