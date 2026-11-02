import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TraineeProfilesModule } from '../trainee-profiles/trainee-profiles.module';
import { TraineeProfilesService } from '../trainee-profiles/trainee-profiles.service';
import { ListGymSubscriptionsQueryDto } from './dto/list-gym-subscriptions.query.dto';
import { GymSubscriptionEntity } from './gym-subscription.entity';
import { GymSubscriptionsModule } from './gym-subscriptions.module';
import { GymSubscriptionsService } from './gym-subscriptions.service';

const INACTIVE_ERROR = 'Gym subscription not found or inactive';

describe('GymSubscriptionsService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [GymSubscriptionsModule, TraineeProfilesModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(GymSubscriptionsService);
  const trainees = (fx: Fixtures) => fx.moduleRef.get(TraineeProfilesService);
  const repo = (fx: Fixtures) => fx.ds.getRepository(GymSubscriptionEntity);
  const row = (fx: Fixtures, id: string) => repo(fx).findOneByOrFail({ id });
  const traineeRow = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(TraineeProfileEntity).findOneByOrFail({ id });
  const ids = (rows: GymSubscriptionEntity[]) => rows.map((r) => r.id);

  async function expectNotFound(promise: Promise<unknown>) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Gym subscription not found');
  }

  async function expectBadRequest(promise: Promise<unknown>, message: string) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(message);
  }

  describe('create / update', () => {
    it('GL-01 create trims the name and is active', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({ name: '  MultiSport  ' });

      expect(created).toMatchObject({ name: 'MultiSport', isActive: true });
      expect(await row(fx, created.id)).toMatchObject({
        name: 'MultiSport',
        isActive: true,
      });
    });

    it('GS-02 update trims the name; omitted name leaves it; never reactivates', async () => {
      const fx = fixtures();
      const gs = await svc(fx).create({ name: 'MultiSport' });
      await svc(fx).deactivate(gs.id);

      await svc(fx).update(gs.id, { name: '  Club card  ' });
      expect(await row(fx, gs.id)).toMatchObject({
        name: 'Club card',
        isActive: false,
      });

      await svc(fx).update(gs.id, {});
      expect(await row(fx, gs.id)).toMatchObject({
        name: 'Club card',
        isActive: false,
      });
    });

    it('GS-02 get/update/deactivate unknown id -> 404 Gym subscription not found', async () => {
      const fx = fixtures();

      await expectNotFound(svc(fx).get(randomUUID()));
      await expectNotFound(svc(fx).update(randomUUID(), { name: 'X' }));
      await expectNotFound(svc(fx).deactivate(randomUUID()));
      expect(await repo(fx).count()).toBe(0);
    });
  });

  describe('list / get', () => {
    it("GL-02 hides inactive unless includeInactive === 'true'; ordered by name ASC", async () => {
      const fx = fixtures();
      const zed = await svc(fx).create({ name: 'Zed' });
      const ann = await svc(fx).create({ name: 'Ann' });
      const max = await svc(fx).create({ name: 'Max' });
      await svc(fx).deactivate(max.id);

      expect(ids(await svc(fx).list({}))).toEqual([ann.id, zed.id]);
      expect(ids(await svc(fx).list({ includeInactive: 'false' }))).toEqual([
        ann.id,
        zed.id,
      ]);
      expect(ids(await svc(fx).list({ includeInactive: 'true' }))).toEqual([
        ann.id,
        max.id,
        zed.id,
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it("GL-02 includeInactive '1' passes query validation but still hides inactive ones", async () => {
      const fx = fixtures();
      const active = await svc(fx).create({ name: 'Active' });
      const inactive = await svc(fx).create({ name: 'Inactive' });
      await svc(fx).deactivate(inactive.id);

      const errors = await validate(
        plainToInstance(ListGymSubscriptionsQueryDto, { includeInactive: '1' }),
      );
      expect(errors).toHaveLength(0);

      expect(ids(await svc(fx).list({ includeInactive: '1' }))).toEqual([
        active.id,
      ]);
    });

    it('GS-02 get returns an inactive gym subscription', async () => {
      const fx = fixtures();
      const gs = await svc(fx).create({ name: 'Old' });
      await svc(fx).deactivate(gs.id);

      expect(await svc(fx).get(gs.id)).toMatchObject({
        id: gs.id,
        name: 'Old',
        isActive: false,
      });
    });
  });

  describe('deactivate', () => {
    it('GS-01 a deactivated gym subscription cannot be newly assigned to a trainee', async () => {
      const fx = fixtures();
      const gs = await svc(fx).create({ name: 'MultiSport' });
      const t = await fx.trainee('Ana');

      const returned = await svc(fx).deactivate(gs.id);
      expect(returned.isActive).toBe(false);
      expect((await row(fx, gs.id)).isActive).toBe(false);

      await expectBadRequest(
        trainees(fx).create({ name: 'Bob', gymSubscriptionId: gs.id }),
        INACTIVE_ERROR,
      );
      await expectBadRequest(
        trainees(fx).update(t.id, { name: 'Ana', gymSubscriptionId: gs.id }),
        INACTIVE_ERROR,
      );

      const rows = await fx.ds.getRepository(TraineeProfileEntity).find();
      expect(rows.map((r) => r.id)).toEqual([t.id]);
      expect(rows[0].gymSubscriptionId).toBeNull();
    });

    it('GS-01 trainees who already have it keep it, edits that omit it keep it, and new attendance snapshots it', async () => {
      const fx = fixtures();
      const gs = await svc(fx).create({ name: 'MultiSport' });
      const t = await trainees(fx).create({
        name: 'Ana',
        gymSubscriptionId: gs.id,
      });
      const trainer = await fx.trainer();
      const loc = await fx.location();

      await svc(fx).deactivate(gs.id);

      expect((await traineeRow(fx, t.id)).gymSubscriptionId).toBe(gs.id);

      await trainees(fx).update(t.id, { name: 'Ana P.' });
      expect(await traineeRow(fx, t.id)).toMatchObject({
        name: 'Ana P.',
        gymSubscriptionId: gs.id,
      });

      const { attendance } = await fx.attend(
        t.id,
        trainer.id,
        loc.id,
        '2025-12-10T09:00:00Z',
      );
      expect((await fx.att(attendance.id)).gymSubscriptionId).toBe(gs.id);
    });

    // CHARACTERIZATION: possibly unintended
    it("GS-01 re-sending the trainee's own (now inactive) gym subscription in an update -> 400", async () => {
      const fx = fixtures();
      const gs = await svc(fx).create({ name: 'MultiSport' });
      const t = await trainees(fx).create({
        name: 'Ana',
        gymSubscriptionId: gs.id,
      });
      await svc(fx).deactivate(gs.id);

      await expectBadRequest(
        trainees(fx).update(t.id, {
          name: 'Ana P.',
          gymSubscriptionId: gs.id,
        }),
        INACTIVE_ERROR,
      );

      // The whole edit is rejected, not just the gym subscription part.
      expect(await traineeRow(fx, t.id)).toMatchObject({
        name: 'Ana',
        gymSubscriptionId: gs.id,
      });
    });
  });
});
