import { toGymLocalDate } from '../../src/attendance/attendance-timezone.util';
import { addDays, weekStartOf } from '../../src/schedules/schedule-week';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Bookings over HTTP: a trainee books and cancels a training of a created week, two weeks ahead
 * (the clock is real), and the staff see the count. The rules are covered in
 * `bookings.service.int-spec.ts`; access is in the role matrix.
 */
type TraineeSlot = {
  id: string;
  bookedCount: number;
  bookedByMe: boolean;
  canBook: boolean;
  canCancel: boolean;
};

describe('Bookings (e2e)', () => {
  const ctx = setupE2eSuite();
  const future = weekStartOf(addDays(toGymLocalDate(new Date()), 14));

  it('a trainee books and cancels a training; staff see the count', async () => {
    const c = ctx();
    const admin = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const gym = await c.location('Center');
    const trainer = await c.trainer('Velcho');
    const ana = await c.trainee('Ana');
    const trainee = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainee', ana.id)}`,
    };
    await c
      .http()
      .post(`/api/schedule-templates/${gym.id}/slots`)
      .set(admin)
      .send({
        weekday: 2,
        trainingTime: { startTime: '18:00', endTime: '19:00' },
        trainerId: trainer.id,
      })
      .expect(201);

    // Nothing to book before the week is created.
    const before = await c
      .http()
      .get(`/api/bookings/schedule?gymId=${gym.id}&week=${future}`)
      .set(trainee)
      .expect(200);
    expect(before.body).toMatchObject({ week: null, slots: [] });
    expect(
      (await c.http().get('/api/bookings/gyms').set(trainee).expect(200)).body,
    ).toEqual([{ id: gym.id, name: 'Center' }]);

    const created = await c
      .http()
      .post('/api/schedules')
      .set(admin)
      .send({ gymId: gym.id, week: future })
      .expect(201);
    const slotId = (created.body as { slots: { id: string }[] }).slots[0].id;

    const booked = await c
      .http()
      .post('/api/bookings')
      .set(trainee)
      .send({ slotId })
      .expect(201);
    expect(booked.body as TraineeSlot).toMatchObject({
      id: slotId,
      bookedCount: 1,
      bookedByMe: true,
      canBook: false,
      canCancel: true,
    });
    expect(
      messageOf(
        (
          await c
            .http()
            .post('/api/bookings')
            .set(trainee)
            .send({ slotId })
            .expect(409)
        ).body,
      ),
    ).toBe('You have already booked this training');

    const staff = await c
      .http()
      .get(`/api/schedules?gymId=${gym.id}&week=${future}`)
      .set(admin)
      .expect(200);
    expect(
      (staff.body as { slots: { bookedCount: number }[] }).slots[0].bookedCount,
    ).toBe(1);
    expect(
      messageOf(
        (
          await c
            .http()
            .delete(`/api/schedules/slots/${slotId}`)
            .set(admin)
            .expect(409)
        ).body,
      ),
    ).toBe('This training has bookings, so it cannot be removed');

    const cancelled = await c
      .http()
      .delete(`/api/bookings/${slotId}`)
      .set(trainee)
      .expect(200);
    expect(cancelled.body as TraineeSlot).toMatchObject({
      bookedCount: 0,
      bookedByMe: false,
      canBook: true,
    });
  });

  it('validates the requests', async () => {
    const c = ctx();
    const ana = await c.trainee('Ana');
    const trainee = {
      Authorization: `Bearer ${await c.provisionAndLogin('trainee', ana.id)}`,
    };

    expect(
      messageOf(
        (
          await c
            .http()
            .post('/api/bookings')
            .set(trainee)
            .send({ slotId: 'nope', note: 'x' })
            .expect(400)
        ).body,
      ),
    ).toEqual(['property note should not exist', 'slotId must be a UUID']);
    await c.http().get('/api/bookings/schedule').set(trainee).expect(400);
    await c
      .http()
      .post('/api/bookings')
      .set(trainee)
      .send({ slotId: '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b' })
      .expect(404);
  });
});
