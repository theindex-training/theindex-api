import { TraineeProfileEntity } from '../../src/trainee-profiles/trainee-profile.entity';
import { messageOf, setupE2eSuite } from './e2e-app';

type TraineeBody = { id: string; name: string; isActive: boolean };

/**
 * Trainee profiles over HTTP: the broken search (TRN-01), PATCH requiring
 * `name` (TRN-04), what a deactivated trainee can still do (TRN-06) and
 * access (TRN-09, TRN-10). Service rules are covered in
 * `src/trainee-profiles/trainee-profiles.service.int-spec.ts`.
 */
describe('Trainee profiles (e2e)', () => {
  const ctx = setupE2eSuite();

  const traineeRepo = () => ctx().ds.getRepository(TraineeProfileEntity);

  describe('TRN-01 search', () => {
    // CHARACTERIZATION: possibly unintended
    it.each(['Ivan', '0888', 'x'])(
      'TRN-01 GET /trainees?search=%s -> 500 (the where uses columns that do not exist)',
      async (search) => {
        const c = ctx();
        await c.trainee('Ivan', { phone: '0888' });

        const res = await c
          .http()
          .get(`/api/trainees?search=${search}`)
          .set('Authorization', `Bearer ${await c.loginAsAdmin()}`);

        expect(res.status).toBe(500);
      },
    );

    it('TRN-01 a whitespace-only search is ignored and returns the normal list', async () => {
      const c = ctx();
      await c.trainee('Ivan');
      await c.trainee('Ana');

      const res = await c
        .http()
        .get('/api/trainees?search=%20%20')
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .expect(200);

      expect((res.body as TraineeBody[]).map((t) => t.name)).toEqual([
        'Ana',
        'Ivan',
      ]);
    });
  });

  describe('TRN-04 PATCH requires name', () => {
    // CHARACTERIZATION: possibly unintended
    it('TRN-04 PATCH { isActive: false } without name -> 400; the trainee stays active', async () => {
      const c = ctx();
      const trainee = await c.trainee('Ivan');

      const res = await c
        .http()
        .patch(`/api/trainees/${trainee.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ isActive: false })
        .expect(400);

      expect(messageOf(res.body)).toEqual([
        'name must be longer than or equal to 2 characters',
        'name must be a string',
      ]);
      expect(
        (await traineeRepo().findOneByOrFail({ id: trainee.id })).isActive,
      ).toBe(true);
    });

    it('TRN-04 control: the same PATCH with name -> 200 and applied', async () => {
      const c = ctx();
      const trainee = await c.trainee('Ivan');

      await c
        .http()
        .patch(`/api/trainees/${trainee.id}`)
        .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
        .send({ name: 'Ivan', isActive: false })
        .expect(200);

      expect(
        (await traineeRepo().findOneByOrFail({ id: trainee.id })).isActive,
      ).toBe(false);
    });
  });

  describe('TRN-06 deactivated trainee', () => {
    // CHARACTERIZATION: possibly unintended
    it('TRN-06 after DELETE the linked account still logs in and reads its own data; no new attendance or subscriptions', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee('Ivan');
      const trainer = await c.trainer();
      const location = await c.location();
      const plan = await c.punchPlan(5, 1000);
      await c.provisionAndLogin('trainee', trainee.id, 'ivan@e2e.test');

      const deleted = await c
        .http()
        .delete(`/api/trainees/${trainee.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .expect(200);
      expect(deleted.body).toMatchObject({ id: trainee.id, isActive: false });

      // A fresh login after deactivation still works...
      const token = await c.loginAs('ivan@e2e.test', 'password-123');
      for (const path of [
        `/api/attendance/trainees/${trainee.id}`,
        `/api/trainees/${trainee.id}/subscriptions`,
        '/api/trainees/me/training-insights',
      ]) {
        await c
          .http()
          .get(path)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }

      // ...but staff can't add attendance or sell a subscription to them.
      const att = await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: trainee.id,
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(400);
      const sub = await c
        .http()
        .post(`/api/trainees/${trainee.id}/subscriptions`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ planId: plan.id })
        .expect(400);
      expect(messageOf(att.body)).toBe('Trainee not found or inactive');
      expect(messageOf(sub.body)).toBe('Trainee not found or inactive');
      expect(await c.attendanceRows()).toHaveLength(0);
      expect(await c.subscriptionRows()).toHaveLength(0);
    });
  });

  describe('TRN-09 /trainees/me/training-insights', () => {
    it('TRN-09 TRAINEE gets their own insights', async () => {
      const c = ctx();
      const admin = await c.loginAsAdmin();
      const trainee = await c.trainee('Ivan');
      const trainer = await c.trainer();
      const location = await c.location();
      await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: trainee.id,
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(201);
      const token = await c.provisionAndLogin('trainee', trainee.id);

      const res = await c
        .http()
        .get('/api/trainees/me/training-insights')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        traineeId: trainee.id,
        totalAttendances: 1,
      });
    });

    it.each(['ADMIN', 'TRAINER'] as const)(
      'TRN-09 %s -> 403 "Forbidden resource" (handler roles override class roles)',
      async (role) => {
        const c = ctx();
        const token =
          role === 'ADMIN'
            ? await c.loginAsAdmin()
            : await c.provisionAndLogin('trainer', (await c.trainer()).id);

        const res = await c
          .http()
          .get('/api/trainees/me/training-insights')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expect(messageOf(res.body)).toBe('Forbidden resource');
      },
    );

    it('TRN-09 TRAINEE token without traineeProfileId -> 403 "Trainee profile is not linked to account"', async () => {
      const c = ctx();
      const token = c.signToken({ role: 'TRAINEE', traineeProfileId: null });

      const res = await c
        .http()
        .get('/api/trainees/me/training-insights')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'Trainee profile is not linked to account',
      );
    });
  });

  describe('TRN-10 access to the other /trainees routes', () => {
    it('TRN-10 TRAINEE -> 403 on list, create, get, patch, delete and overview, even for their own id', async () => {
      const c = ctx();
      const trainee = await c.trainee('Ivan');
      const token = await c.provisionAndLogin('trainee', trainee.id);
      const auth = { Authorization: `Bearer ${token}` };

      const responses = [
        await c.http().get('/api/trainees').set(auth),
        await c.http().post('/api/trainees').set(auth).send({ name: 'New' }),
        await c.http().get(`/api/trainees/${trainee.id}`).set(auth),
        await c
          .http()
          .patch(`/api/trainees/${trainee.id}`)
          .set(auth)
          .send({ name: 'Renamed' }),
        await c.http().delete(`/api/trainees/${trainee.id}`).set(auth),
        await c.http().get(`/api/trainees/${trainee.id}/overview`).set(auth),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      expect(await traineeRepo().find()).toEqual([
        expect.objectContaining({
          id: trainee.id,
          name: 'Ivan',
          isActive: true,
        }),
      ]);
    });

    it('TRN-10 TRAINER has full CRUD (create, list, get, patch, overview, delete)', async () => {
      const c = ctx();
      const token = await c.provisionAndLogin(
        'trainer',
        (await c.trainer()).id,
      );
      const auth = { Authorization: `Bearer ${token}` };

      const created = await c
        .http()
        .post('/api/trainees')
        .set(auth)
        .send({ name: ' Maria ', phone: ' 0899 ' })
        .expect(201);
      const id = (created.body as TraineeBody).id;
      expect(created.body).toMatchObject({ name: 'Maria', phone: '0899' });

      const list = await c.http().get('/api/trainees').set(auth).expect(200);
      expect((list.body as TraineeBody[]).map((t) => t.id)).toEqual([id]);
      await c.http().get(`/api/trainees/${id}`).set(auth).expect(200);
      await c
        .http()
        .patch(`/api/trainees/${id}`)
        .set(auth)
        .send({ name: 'Maria P' })
        .expect(200);
      const overview = await c
        .http()
        .get(`/api/trainees/${id}/overview`)
        .set(auth)
        .expect(200);
      expect(overview.body).toMatchObject({ trainee: { id, name: 'Maria P' } });
      await c.http().delete(`/api/trainees/${id}`).set(auth).expect(200);

      expect(await traineeRepo().findOneByOrFail({ id })).toMatchObject({
        name: 'Maria P',
        isActive: false,
      });
    });
  });
});
