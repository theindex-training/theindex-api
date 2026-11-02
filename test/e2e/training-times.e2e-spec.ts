import { TrainingTimeEntity } from '../../src/training-times/training-time.entity';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Training times over HTTP: the `HH:mm` DTO regex and `end > start` (TT-01).
 * Partial-update validation, ordering and the response format are covered in
 * `src/training-times/training-times.service.int-spec.ts`.
 */
describe('Training times (e2e)', () => {
  const ctx = setupE2eSuite();

  const repo = () => ctx().ds.getRepository(TrainingTimeEntity);

  async function post(body: object) {
    const c = ctx();
    return c
      .http()
      .post('/api/training-times')
      .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
      .send(body);
  }

  it.each([
    ['single-digit hour', '9:00'],
    ['hour 24', '24:00'],
    ['minute 60', '09:60'],
    ['seconds', '09:00:00'],
    ['12h format', '09:00 AM'],
    ['empty', ''],
  ])('TT-01 startTime with %s -> 400 from the DTO', async (_label, value) => {
    const res = await post({ startTime: value, endTime: '23:59' });

    expect(res.status).toBe(400);
    expect(messageOf(res.body)).toEqual([
      'startTime must match /^([01]\\d|2[0-3]):([0-5]\\d)$/ regular expression',
    ]);
    expect(await repo().count()).toBe(0);
  });

  it('TT-01 endTime is checked by the same regex', async () => {
    const res = await post({ startTime: '09:00', endTime: '24:00' });

    expect(res.status).toBe(400);
    expect(messageOf(res.body)).toEqual([
      'endTime must match /^([01]\\d|2[0-3]):([0-5]\\d)$/ regular expression',
    ]);
    expect(await repo().count()).toBe(0);
  });

  it.each([
    ['before', '10:00', '09:59'],
    ['equal to', '10:00', '10:00'],
  ])(
    'TT-01 endTime %s startTime -> 400 "endTime must be after startTime"',
    async (_label, startTime, endTime) => {
      const res = await post({ startTime, endTime });

      expect(res.status).toBe(400);
      expect(messageOf(res.body)).toBe('endTime must be after startTime');
      expect(await repo().count()).toBe(0);
    },
  );

  it('TT-01 boundaries 00:00-23:59 and a one-minute slot are accepted', async () => {
    await post({ startTime: '00:00', endTime: '23:59' }).then((r) =>
      expect(r.status).toBe(201),
    );
    const res = await post({ startTime: '18:00', endTime: '18:01' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startTime: '18:00', endTime: '18:01' });
    expect(await repo().count()).toBe(2);
  });

  it('TT-01 PATCH applies the regex too; the row is unchanged', async () => {
    const c = ctx();
    const created = await post({ startTime: '09:00', endTime: '10:00' });
    const id = (created.body as { id: string }).id;

    const res = await c
      .http()
      .patch(`/api/training-times/${id}`)
      .set('Authorization', `Bearer ${await c.loginAsAdmin()}`)
      .send({ endTime: '25:00' })
      .expect(400);

    expect(Array.isArray(messageOf(res.body))).toBe(true);
    expect(await repo().findOneByOrFail({ id })).toMatchObject({
      startTime: '09:00:00',
      endTime: '10:00:00',
    });
  });
});
