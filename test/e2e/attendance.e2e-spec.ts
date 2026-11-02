import { AttendancePaymentStatus } from '../../src/common/enums/attendance-payment-status.enum';
import { messageOf, setupE2eSuite } from './e2e-app';

type AttendanceRow = { id: string; traineeId: string; paymentStatus: string };

/**
 * Attendance write path over HTTP: DTO differences between single and batch
 * create (ATT-13) and TRAINEE access (ATT-31, ATT-32). Payment resolution,
 * credits and delete rules are covered in `attendance.service.int-spec.ts`.
 */
describe('Attendance (e2e)', () => {
  const ctx = setupE2eSuite();

  async function seed() {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const trainer = await c.trainer();
    const location = await c.location();
    const own = await c.trainee('Own');
    const other = await c.trainee('Other');
    return { admin, trainer, location, own, other };
  }

  describe('ATT-13 DTO differences', () => {
    it.each([
      ['empty traineeIds', () => []],
      [
        'more than 200 traineeIds',
        () =>
          Array.from(
            { length: 201 },
            (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          ),
      ],
      // Valid UUID, but version 1: the batch only accepts v4 (`IsUUID('4')`).
      ['a non-v4 UUID', () => ['550e8400-e29b-11d4-a716-446655440000']],
      ['a non-UUID', () => ['abc']],
    ])('ATT-13 batch with %s -> 400 from the DTO', async (_label, ids) => {
      const c = ctx();
      const { admin, trainer, location } = await seed();

      const res = await c
        .http()
        .post('/api/attendance/batch')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          trainerId: trainer.id,
          locationId: location.id,
          traineeIds: ids(),
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(400);

      expect(Array.isArray(messageOf(res.body))).toBe(true);
      expect(await c.attendanceRows()).toHaveLength(0);
    });

    it('ATT-13 batch accepts exactly 200 traineeIds at the DTO level (then fails on missing trainees)', async () => {
      const c = ctx();
      const { admin, trainer, location, own } = await seed();
      const ids = [
        own.id,
        ...Array.from(
          { length: 199 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ),
      ];

      const res = await c
        .http()
        .post('/api/attendance/batch')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          trainerId: trainer.id,
          locationId: location.id,
          traineeIds: ids,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(400);

      // Service-level error, not a DTO array: the 200 ids passed validation.
      expect(messageOf(res.body)).toBe('Some trainees are missing or inactive');
      expect(
        (res.body as { invalidTraineeIds: string[] }).invalidTraineeIds,
      ).toHaveLength(199);
      expect(await c.attendanceRows()).toHaveLength(0);
    });

    it('ATT-13 batch trainedAt is only IsString: garbage -> 400 "Invalid trainedAt" from the service', async () => {
      const c = ctx();
      const { admin, trainer, location, own } = await seed();

      const res = await c
        .http()
        .post('/api/attendance/batch')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          trainerId: trainer.id,
          locationId: location.id,
          traineeIds: [own.id],
          trainedAt: 'yesterday evening',
        })
        .expect(400);

      expect(messageOf(res.body)).toBe('Invalid trainedAt');
      expect(await c.attendanceRows()).toHaveLength(0);
    });

    it('ATT-13 single create trainedAt is IsDateString: garbage -> 400 from the DTO (array message)', async () => {
      const c = ctx();
      const { admin, trainer, location, own } = await seed();

      const res = await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: own.id,
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: 'yesterday evening',
        })
        .expect(400);

      expect(messageOf(res.body)).toEqual([
        'trainedAt must be a valid ISO 8601 date string',
      ]);
      expect(await c.attendanceRows()).toHaveLength(0);
    });

    it('ATT-13 single create accepts a non-v4 UUID traineeId at the DTO level (IsUUID any version)', async () => {
      const c = ctx();
      const { admin, trainer, location } = await seed();

      const res = await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: '550e8400-e29b-11d4-a716-446655440000',
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(400);

      // Reaches the service (unknown trainee), unlike the batch v4 check.
      expect(messageOf(res.body)).toBe('Trainee not found or inactive');
    });

    it('ATT-13 control: a valid batch -> 201 with one PAID/UNPAID result per unique trainee', async () => {
      const c = ctx();
      const { admin, trainer, location, own, other } = await seed();

      const res = await c
        .http()
        .post('/api/attendance/batch')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          trainerId: trainer.id,
          locationId: location.id,
          traineeIds: [own.id, other.id, own.id],
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        trainerId: trainer.id,
        trainedAt: '2025-12-01T10:00:00.000Z',
        count: 2,
      });
      expect(await c.attendanceRows()).toHaveLength(2);
    });
  });

  describe('ATT-31 TRAINEE reads their own trainings', () => {
    async function seedHistory() {
      const c = ctx();
      const s = await seed();
      const plan = await c.punchPlan(1, 1000);
      await c
        .http()
        .post(`/api/trainees/${s.own.id}/subscriptions`)
        .set('Authorization', `Bearer ${s.admin}`)
        .send({ planId: plan.id })
        .expect(201);
      const attend = (traineeId: string, trainedAt: string) =>
        c
          .http()
          .post('/api/attendance')
          .set('Authorization', `Bearer ${s.admin}`)
          .send({
            traineeId,
            trainerId: s.trainer.id,
            locationId: s.location.id,
            trainedAt,
          })
          .expect(201);
      // Own: one PAID (uses the only credit), one UNPAID. Other: one UNPAID.
      await attend(s.own.id, '2025-12-01T10:00:00.000Z');
      await attend(s.own.id, '2025-12-02T10:00:00.000Z');
      await attend(s.other.id, '2025-12-03T10:00:00.000Z');
      const token = await c.provisionAndLogin('trainee', s.own.id);
      return { ...s, token };
    }

    it('ATT-31 TRAINEE gets 200 on their own /trainees/:id, /paid and /unpaid with the right rows', async () => {
      const c = ctx();
      const { own, token } = await seedHistory();
      const get = async (suffix: string) =>
        (
          await c
            .http()
            .get(`/api/attendance/trainees/${own.id}${suffix}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body as AttendanceRow[];

      const all = await get('');
      const paid = await get('/paid');
      const unpaid = await get('/unpaid');

      expect(all).toHaveLength(2);
      expect(all.every((r) => r.traineeId === own.id)).toBe(true);
      expect(paid.map((r) => r.paymentStatus)).toEqual([
        AttendancePaymentStatus.PAID,
      ]);
      expect(unpaid.map((r) => r.paymentStatus)).toEqual([
        AttendancePaymentStatus.UNPAID,
      ]);
    });

    it.each(['', '/paid', '/unpaid'])(
      "ATT-31 TRAINEE on another trainee's /attendance/trainees/:id%s -> 403 with the scope message",
      async (suffix) => {
        const c = ctx();
        const { other, token } = await seedHistory();

        const res = await c
          .http()
          .get(`/api/attendance/trainees/${other.id}${suffix}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expect(messageOf(res.body)).toBe(
          'TRAINEE can only access trainings for their own trainee profile',
        );
      },
    );

    it('ATT-31 TRAINEE token with traineeProfileId null -> 403', async () => {
      const c = ctx();
      const { own } = await seedHistory();
      const token = c.signToken({ role: 'TRAINEE', traineeProfileId: null });

      const res = await c
        .http()
        .get(`/api/attendance/trainees/${own.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(messageOf(res.body)).toBe(
        'TRAINEE can only access trainings for their own trainee profile',
      );
    });

    it("ATT-31 TRAINER can read any trainee's trainings", async () => {
      const c = ctx();
      const { other, trainer } = await seedHistory();
      const token = await c.provisionAndLogin('trainer', trainer.id);

      const res = await c
        .http()
        .get(`/api/attendance/trainees/${other.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  describe('ATT-32 TRAINEE is denied every other attendance route', () => {
    it('ATT-32 TRAINEE -> 403 "Forbidden resource" on create, batch, delete, dates, sessions and both reports; nothing changes', async () => {
      const c = ctx();
      const { admin, trainer, location, own } = await seed();
      const created = await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${admin}`)
        .send({
          traineeId: own.id,
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(201);
      const attendanceId = (created.body as { attendance: { id: string } })
        .attendance.id;
      const token = await c.provisionAndLogin('trainee', own.id);
      const auth = { Authorization: `Bearer ${token}` };
      const body = {
        traineeId: own.id,
        trainerId: trainer.id,
        locationId: location.id,
        trainedAt: '2025-12-02T10:00:00.000Z',
      };

      const responses = [
        await c.http().post('/api/attendance').set(auth).send(body),
        await c
          .http()
          .post('/api/attendance/batch')
          .set(auth)
          .send({
            trainerId: trainer.id,
            locationId: location.id,
            traineeIds: [own.id],
            trainedAt: '2025-12-02T10:00:00.000Z',
          }),
        await c.http().delete(`/api/attendance/${attendanceId}`).set(auth),
        await c
          .http()
          .get('/api/attendance/dates?from=2025-12-01&to=2025-12-31')
          .set(auth),
        await c
          .http()
          .get(
            '/api/attendance/sessions?startDate=2025-12-01&endDate=2025-12-31',
          )
          .set(auth),
        await c
          .http()
          .get('/api/attendance/reports/inactive-trainees?skipDays=7')
          .set(auth),
        await c
          .http()
          .get('/api/attendance/reports/without-active-subscription')
          .set(auth),
      ];

      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(messageOf(res.body)).toBe('Forbidden resource');
      }
      const rows = await c.attendanceRows();
      expect(rows.map((r) => r.id)).toEqual([attendanceId]);
    });

    it('ATT-32 control: TRAINER can create and delete attendance', async () => {
      const c = ctx();
      const { trainer, location, own } = await seed();
      const token = await c.provisionAndLogin('trainer', trainer.id);

      const created = await c
        .http()
        .post('/api/attendance')
        .set('Authorization', `Bearer ${token}`)
        .send({
          traineeId: own.id,
          trainerId: trainer.id,
          locationId: location.id,
          trainedAt: '2025-12-01T10:00:00.000Z',
        })
        .expect(201);
      expect(await c.attendanceRows()).toHaveLength(1);

      await c
        .http()
        .delete(
          `/api/attendance/${(created.body as { attendance: { id: string } }).attendance.id}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(await c.attendanceRows()).toHaveLength(0);
    });
  });
});
