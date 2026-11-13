import { BadRequestException } from '@nestjs/common';
import { authImports } from '../../test/int/auth-setup';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';
import { TraineeProfilesModule } from '../trainee-profiles/trainee-profiles.module';
import { TraineeProfilesService } from '../trainee-profiles/trainee-profiles.service';
import { TrainerProfileEntity } from '../trainer-profiles/trainer-profile.entity';
import { TrainerProfilesModule } from '../trainer-profiles/trainer-profiles.module';
import { TrainerProfilesService } from '../trainer-profiles/trainer-profiles.service';
import { GymLocationEntity } from './gym-location.entity';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

/** A trainee's preferred gym and a trainer's primary gym: optional, an active gym, clearable. */
describe('home gyms (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [
      ...authImports(),
      TraineeProfilesModule,
      TrainerProfilesModule,
    ],
  });
  const trainees = (fx: Fixtures) => fx.moduleRef.get(TraineeProfilesService);
  const trainers = (fx: Fixtures) => fx.moduleRef.get(TrainerProfilesService);

  it("stores a trainee's preferred gym on create and update, and null clears it", async () => {
    const fx = fixtures();
    const center = await fx.location('Center');
    const north = await fx.location('North');

    const created = await trainees(fx).create({
      name: 'Ana',
      preferredGymId: center.id,
    });
    expect(created.preferredGymId).toBe(center.id);

    await trainees(fx).update(created.id, {
      name: 'Ana',
      preferredGymId: north.id,
    });
    expect(
      (
        await fx.ds
          .getRepository(TraineeProfileEntity)
          .findOneByOrFail({ id: created.id })
      ).preferredGymId,
    ).toBe(north.id);

    // Not sending it keeps it; null clears it.
    await trainees(fx).update(created.id, { name: 'Ana P.' });
    expect((await trainees(fx).getById(created.id)).preferredGymId).toBe(
      north.id,
    );
    await trainees(fx).update(created.id, {
      name: 'Ana',
      preferredGymId: null,
    });
    expect((await trainees(fx).getById(created.id)).preferredGymId).toBeNull();
  });

  it("stores a trainer's primary gym, readable through the profile", async () => {
    const fx = fixtures();
    const center = await fx.location('Center');

    const created = await trainers(fx).create({ name: 'Velcho' });
    expect(created.primaryGymId).toBeNull();

    await trainers(fx).update(created.id, {
      name: 'Velcho',
      primaryGymId: center.id,
    });

    expect((await trainers(fx).getById(created.id)).primaryGymId).toBe(
      center.id,
    );
  });

  it('refuses an unknown or inactive gym (400) and changes nothing', async () => {
    const fx = fixtures();
    const closed = await fx.location('Closed', { isActive: false });
    const trainer = await trainers(fx).create({ name: 'Velcho' });

    const unknown = await rejectionOf(
      trainees(fx).create({ name: 'Ana', preferredGymId: UNKNOWN_ID }),
    );
    const inactive = await rejectionOf(
      trainers(fx).update(trainer.id, {
        name: 'Velcho',
        primaryGymId: closed.id,
      }),
    );

    expect(unknown).toBeInstanceOf(BadRequestException);
    expect(unknown.message).toBe('Unknown gym');
    expect(inactive.message).toBe('Gym is inactive');
    expect(await fx.ds.getRepository(TraineeProfileEntity).count()).toBe(0);
    expect((await trainers(fx).getById(trainer.id)).primaryGymId).toBeNull();
  });

  it('deleting a gym clears it from the profiles', async () => {
    const fx = fixtures();
    const center = await fx.location('Center');
    const ana = await fx.trainee('Ana', { preferredGymId: center.id });
    const velcho = await fx.trainer('Velcho', { primaryGymId: center.id });

    await fx.ds.getRepository(GymLocationEntity).delete({ id: center.id });

    expect(
      (
        await fx.ds
          .getRepository(TraineeProfileEntity)
          .findOneByOrFail({ id: ana.id })
      ).preferredGymId,
    ).toBeNull();
    expect(
      (
        await fx.ds
          .getRepository(TrainerProfileEntity)
          .findOneByOrFail({ id: velcho.id })
      ).primaryGymId,
    ).toBeNull();
  });
});
