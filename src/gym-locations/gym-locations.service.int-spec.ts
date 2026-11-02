import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { ListGymLocationsQueryDto } from './dto/list-gym-locations.query.dto';
import { UpdateGymLocationDto } from './dto/update-gym-location.dto';
import { GymLocationEntity } from './gym-location.entity';
import { GymLocationsModule } from './gym-locations.module';
import { GymLocationsService } from './gym-locations.service';

describe('GymLocationsService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [GymLocationsModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(GymLocationsService);
  const repo = (fx: Fixtures) => fx.ds.getRepository(GymLocationEntity);
  const row = (fx: Fixtures, id: string) => repo(fx).findOneByOrFail({ id });
  const ids = (rows: GymLocationEntity[]) => rows.map((r) => r.id);

  async function expectNotFound(promise: Promise<unknown>) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Location not found');
  }

  describe('create', () => {
    it('GL-01 active by default; address and notes default to null; name is NOT trimmed', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({ name: '  West Gym  ' });

      const expected = {
        name: '  West Gym  ',
        address: null,
        notes: null,
        isActive: true,
      };
      expect(created).toMatchObject(expected);
      expect(await row(fx, created.id)).toMatchObject(expected);
    });

    it('GL-01 address and notes are stored as sent (not trimmed)', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        name: 'West Gym',
        address: ' Plovdiv ',
        notes: 'Main hall',
      });

      expect(await row(fx, created.id)).toMatchObject({
        address: ' Plovdiv ',
        notes: 'Main hall',
        isActive: true,
      });
    });
  });

  describe('list', () => {
    it("GL-02 hides inactive unless includeInactive === 'true'; ordered by name ASC", async () => {
      const fx = fixtures();
      const cee = await svc(fx).create({ name: 'Cee' });
      const ay = await svc(fx).create({ name: 'Ay' });
      const bee = await svc(fx).create({ name: 'Bee' });
      await svc(fx).deactivate(bee.id);

      expect(ids(await svc(fx).list({}))).toEqual([ay.id, cee.id]);
      expect(ids(await svc(fx).list({ includeInactive: 'false' }))).toEqual([
        ay.id,
        cee.id,
      ]);
      expect(ids(await svc(fx).list({ includeInactive: 'true' }))).toEqual([
        ay.id,
        bee.id,
        cee.id,
      ]);
    });

    // CHARACTERIZATION: possibly unintended
    it("GL-02 includeInactive '1' passes query validation but still hides inactive locations", async () => {
      const fx = fixtures();
      const active = await svc(fx).create({ name: 'Active' });
      const inactive = await svc(fx).create({ name: 'Inactive' });
      await svc(fx).deactivate(inactive.id);

      // The DTO (IsBooleanString) accepts '1' and '0', so HTTP would not 400.
      const errors = await validate(
        plainToInstance(ListGymLocationsQueryDto, { includeInactive: '1' }),
      );
      expect(errors).toHaveLength(0);

      expect(ids(await svc(fx).list({ includeInactive: '1' }))).toEqual([
        active.id,
      ]);
    });
  });

  describe('get / update', () => {
    it('GS-02 get returns inactive locations too; unknown id -> 404 Location not found', async () => {
      const fx = fixtures();
      const loc = await svc(fx).create({ name: 'Old' });
      await svc(fx).deactivate(loc.id);

      expect(await svc(fx).get(loc.id)).toMatchObject({
        id: loc.id,
        isActive: false,
      });
      await expectNotFound(svc(fx).get(randomUUID()));
    });

    it('GL-01 update: partial, name not trimmed, other fields kept', async () => {
      const fx = fixtures();
      const loc = await svc(fx).create({
        name: 'West',
        address: 'Plovdiv',
        notes: 'Hall',
      });

      await svc(fx).update(loc.id, { name: ' West 2 ' });
      expect(await row(fx, loc.id)).toMatchObject({
        name: ' West 2 ',
        address: 'Plovdiv',
        notes: 'Hall',
        isActive: true,
      });

      await svc(fx).update(loc.id, { notes: 'Upstairs' });
      expect(await row(fx, loc.id)).toMatchObject({
        name: ' West 2 ',
        address: 'Plovdiv',
        notes: 'Upstairs',
      });
    });

    it('GL-01 update: address/notes null clears them (the DTO lets null through)', async () => {
      const fx = fixtures();
      const loc = await svc(fx).create({
        name: 'West',
        address: 'Plovdiv',
        notes: 'Hall',
      });
      const body = { address: null, notes: null };
      // @IsOptional() skips validation for null, so this body is valid over HTTP.
      expect(
        await validate(plainToInstance(UpdateGymLocationDto, body)),
      ).toHaveLength(0);

      await svc(fx).update(loc.id, body as unknown as UpdateGymLocationDto);

      expect(await row(fx, loc.id)).toMatchObject({
        name: 'West',
        address: null,
        notes: null,
      });
    });

    it('GL-03 update never reactivates: an inactive location stays inactive', async () => {
      const fx = fixtures();
      const loc = await svc(fx).create({ name: 'Old' });
      await svc(fx).deactivate(loc.id);

      const updated = await svc(fx).update(loc.id, { name: 'Renamed' });

      expect(updated.isActive).toBe(false);
      expect(await row(fx, loc.id)).toMatchObject({
        name: 'Renamed',
        isActive: false,
      });
    });

    it('GS-02 update unknown id -> 404, nothing created', async () => {
      const fx = fixtures();

      await expectNotFound(svc(fx).update(randomUUID(), { name: 'X' }));
      expect(await repo(fx).count()).toBe(0);
    });
  });

  describe('deactivate', () => {
    it('GL-04 sets isActive false and keeps the row; unknown id -> 404', async () => {
      const fx = fixtures();
      const loc = await svc(fx).create({ name: 'West', address: 'Plovdiv' });

      const returned = await svc(fx).deactivate(loc.id);

      expect(returned.isActive).toBe(false);
      expect(await row(fx, loc.id)).toMatchObject({
        name: 'West',
        address: 'Plovdiv',
        isActive: false,
      });
      await expectNotFound(svc(fx).deactivate(randomUUID()));
    });

    it('GL-04 attendance at a deactivated location -> 400, nothing stored, no credit used', async () => {
      const fx = fixtures();
      const trainer = await fx.trainer();
      const trainee = await fx.trainee();
      const plan = await fx.punchPlan(5, 5000);
      const sub = await fx.buy(trainee.id, plan.id);
      const loc = await svc(fx).create({ name: 'West' });
      await svc(fx).deactivate(loc.id);

      const err = await rejectionOf(
        fx.attend(trainee.id, trainer.id, loc.id, '2025-12-10T09:00:00Z'),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Location not found or inactive');
      expect(await fx.attendanceRows()).toHaveLength(0);
      expect((await fx.sub(sub.id)).remainingCredits).toBe(5);
    });

    it('GL-04 historical attendance at the location is unchanged', async () => {
      const fx = fixtures();
      const trainer = await fx.trainer();
      const trainee = await fx.trainee();
      const plan = await fx.punchPlan(5, 5000);
      const sub = await fx.buy(trainee.id, plan.id);
      const loc = await svc(fx).create({ name: 'West' });
      const { attendance } = await fx.attend(
        trainee.id,
        trainer.id,
        loc.id,
        '2025-12-10T09:00:00Z',
      );

      await svc(fx).deactivate(loc.id);

      expect(await fx.att(attendance.id)).toMatchObject({
        locationId: loc.id,
        paymentStatus: AttendancePaymentStatus.PAID,
        subscriptionId: sub.id,
      });
      expect(await fx.sub(sub.id)).toMatchObject({
        remainingCredits: 4,
        status: SubscriptionStatus.ACTIVE,
      });
    });
  });
});
