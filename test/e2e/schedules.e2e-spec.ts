import { toGymLocalDate } from '../../src/attendance/attendance-timezone.util';
import { addDays, weekStartOf } from '../../src/schedules/schedule-week';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Weekly schedules over HTTP: request validation, status codes and the journey from a gym's
 * template to a created week. The rules are covered in `schedules.service.int-spec.ts`; access
 * is in the role matrix. The clock is real, so the week used is two weeks ahead.
 */
type Slot = {
  id: string;
  date?: string;
  weekday: number;
  trainingTime: { id: string; startTime: string; endTime: string };
  trainer: { id: string; name: string };
  workout?: { id: string; title: string | null } | null;
};
type Week = {
  weekStart: string;
  weekEnd: string;
  editableFrom: string;
  week: { id: string } | null;
  slots: Slot[];
};

describe('Weekly schedules (e2e)', () => {
  const ctx = setupE2eSuite();
  const future = weekStartOf(addDays(toGymLocalDate(new Date()), 14));

  async function staff() {
    const c = ctx();
    const auth = { Authorization: `Bearer ${await c.loginAsAdmin()}` };
    const send = (method: 'post' | 'patch', path: string, body: object) =>
      c.http()[method](`/api/${path}`).set(auth).send(body);
    const get = (path: string) => c.http().get(`/api/${path}`).set(auth);
    const gym = await c.location('Center');
    const trainer = await c.trainer('Velcho');
    return { c, auth, send, get, gym, trainer };
  }

  it('builds a template, creates a week from it and edits a training', async () => {
    const { c, auth, send, get, gym, trainer } = await staff();

    const first = await send('post', `schedule-templates/${gym.id}/slots`, {
      weekday: 1,
      trainingTime: { startTime: '07:10', endTime: '08:10' },
      trainerId: trainer.id,
    }).expect(201);
    expect(first.body).toMatchObject({
      weekday: 1,
      trainingTime: { startTime: '07:10:00', endTime: '08:10:00' },
      trainer: { id: trainer.id, name: 'Velcho' },
    });
    await send('post', `schedule-templates/${gym.id}/slots`, {
      weekday: 3,
      trainingTimeId: (first.body as Slot).trainingTime.id,
      trainerId: trainer.id,
    }).expect(201);

    const before = (
      await get(`schedules?gymId=${gym.id}&week=${addDays(future, 2)}`).expect(
        200,
      )
    ).body as Week;
    expect(before).toMatchObject({
      weekStart: future,
      weekEnd: addDays(future, 6),
      week: null,
      slots: [],
    });

    const created = (
      await send('post', 'schedules', { gymId: gym.id, week: future }).expect(
        201,
      )
    ).body as Week;
    expect(created.slots.map((s) => [s.date, s.weekday])).toEqual([
      [future, 1],
      [addDays(future, 2), 3],
    ]);
    expect(
      messageOf(
        (
          await send('post', 'schedules', {
            gymId: gym.id,
            week: future,
          }).expect(409)
        ).body,
      ),
    ).toBe('This week has already been created');

    const added = await send('post', `schedules/${created.week!.id}/slots`, {
      date: addDays(future, 4),
      trainingTime: { startTime: '18:00', endTime: '19:00' },
      trainerId: trainer.id,
    }).expect(201);
    const changed = await send(
      'patch',
      `schedules/slots/${(added.body as Slot).id}`,
      { trainingTimeId: (first.body as Slot).trainingTime.id },
    ).expect(200);
    expect((changed.body as Slot).trainingTime.startTime).toBe('07:10:00');

    await c
      .http()
      .delete(`/api/schedules/slots/${created.slots[0].id}`)
      .set(auth)
      .expect(200);
    const after = (await get(`schedules?gymId=${gym.id}&week=${future}`))
      .body as Week;
    expect(after.slots.map((s) => s.date)).toEqual([
      addDays(future, 2),
      addDays(future, 4),
    ]);
    // The template is untouched by the week's changes.
    const template = (await get(`schedule-templates/${gym.id}`).expect(200))
      .body as { slots: Slot[] };
    expect(template.slots.map((s) => s.weekday)).toEqual([1, 3]);
  });

  it('validates the requests', async () => {
    const { send, get, gym, trainer } = await staff();

    expect(
      messageOf(
        (
          await send('post', `schedule-templates/${gym.id}/slots`, {
            weekday: 8,
            trainingTime: { startTime: '7:10', endTime: '08:10' },
            trainerId: trainer.id,
            room: 'A',
          }).expect(400)
        ).body,
      ),
    ).toEqual([
      'property room should not exist',
      'weekday must not be greater than 7',
      'trainingTime.startTime must be HH:mm',
    ]);
    await get('schedules').expect(400);
    await get(`schedules?gymId=${gym.id}&week=2026-02-30`).expect(400);
    await get('schedule-templates/not-a-uuid').expect(400);
    expect(
      messageOf(
        (
          await send('post', 'schedules', {
            gymId: gym.id,
            week: future,
          }).expect(400)
        ).body,
      ),
    ).toBe('This gym has no schedule template yet');
    await get('schedules?gymId=7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b').expect(
      404,
    );
  });
});
