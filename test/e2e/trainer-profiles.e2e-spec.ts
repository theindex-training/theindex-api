import { TrainerProfileEntity } from '../../src/trainer-profiles/trainer-profile.entity';
import { messageOf, setupE2eSuite } from './e2e-app';

type TrainerBody = { id: string; name: string; isActive: boolean };

/**
 * Trainer profiles over HTTP: PATCH requiring `name` (TRP-02) and access
 * (TRP-04). Service rules are covered in
 * `src/trainer-profiles/trainer-profiles.service.int-spec.ts`.
 */
describe('Trainer profiles (e2e)', () => {
  const ctx = setupE2eSuite();

  const trainerRepo = () => ctx().ds.getRepository(TrainerProfileEntity);

  describe('TRP-02 PATCH requires name', () => {
    // CHARACTERIZATION: possibly unintended
    it('TRP-02 PATCH { nickname } without name -> 400; nothing changes', async () => {
      const c = ctx();
      const trainer = await c.trainer('Velcho');

      const res = await c
        .http()
        .patch(`/api/trainers/${trainer.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ nickname: 'V' })
        .expect(400);

      expect(messageOf(res.body)).toEqual([
        'name must be longer than or equal to 2 characters',
        'name must be a string',
      ]);
      expect(
        (await trainerRepo().findOneByOrFail({ id: trainer.id })).nickname,
      ).toBeNull();
    });

    it('TRP-02 control: the same PATCH with name -> 200 and applied', async () => {
      const c = ctx();
      const trainer = await c.trainer('Velcho');

      await c
        .http()
        .patch(`/api/trainers/${trainer.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ name: 'Velcho', nickname: 'V' })
        .expect(200);

      expect(
        (await trainerRepo().findOneByOrFail({ id: trainer.id })).nickname,
      ).toBe('V');
    });
  });

  describe('TRP-04 access', () => {
    it.each(['TRAINER', 'TRAINEE'] as const)(
      'TRP-04 %s can list and get trainers (no class-level @Roles)',
      async (role) => {
        const c = ctx();
        const trainer = await c.trainer('Velcho');
        const token =
          role === 'TRAINER'
            ? await c.provisionAndLogin('trainer', trainer.id)
            : await c.provisionAndLogin('trainee', (await c.trainee()).id);

        const list = await c
          .http()
          .get('/api/trainers')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect((list.body as TrainerBody[]).map((t) => t.id)).toEqual([
          trainer.id,
        ]);
        const one = await c
          .http()
          .get(`/api/trainers/${trainer.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(one.body).toMatchObject({ id: trainer.id, name: 'Velcho' });
      },
    );

    it.each(['TRAINER', 'TRAINEE'] as const)(
      'TRP-04 %s -> 403 on create, update and delete; nothing changes',
      async (role) => {
        const c = ctx();
        const trainer = await c.trainer('Velcho');
        const token =
          role === 'TRAINER'
            ? await c.provisionAndLogin('trainer', trainer.id)
            : await c.provisionAndLogin('trainee', (await c.trainee()).id);
        const auth = { Authorization: `Bearer ${token}` };

        const responses = [
          await c.http().post('/api/trainers').set(auth).send({ name: 'New' }),
          await c
            .http()
            .patch(`/api/trainers/${trainer.id}`)
            .set(auth)
            .send({ name: 'Renamed' }),
          await c.http().delete(`/api/trainers/${trainer.id}`).set(auth),
        ];

        for (const res of responses) {
          expect(res.status).toBe(403);
          expect(messageOf(res.body)).toBe('Forbidden resource');
        }
        expect(await trainerRepo().find()).toEqual([
          expect.objectContaining({
            id: trainer.id,
            name: 'Velcho',
            isActive: true,
          }),
        ]);
      },
    );

    it('TRP-04 ADMIN can create, update and deactivate trainers', async () => {
      const c = ctx();
      const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };

      const created = await c
        .http()
        .post('/api/trainers')
        .set(auth)
        .send({ name: ' Krasi ' })
        .expect(201);
      const id = (created.body as TrainerBody).id;
      await c
        .http()
        .patch(`/api/trainers/${id}`)
        .set(auth)
        .send({ name: 'Krasimir' })
        .expect(200);
      await c.http().delete(`/api/trainers/${id}`).set(auth).expect(200);

      expect(await trainerRepo().findOneByOrFail({ id })).toMatchObject({
        name: 'Krasimir',
        isActive: false,
      });
    });

    it('TRP-04 anonymous -> 401 on list and get', async () => {
      const c = ctx();
      const trainer = await c.trainer();

      await c.http().get('/api/trainers').expect(401);
      await c.http().get(`/api/trainers/${trainer.id}`).expect(401);
    });
  });
});
