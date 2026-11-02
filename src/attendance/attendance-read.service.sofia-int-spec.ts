import { Fixtures } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TrainingTimeEntity } from '../training-times/training-time.entity';

/**
 * DT-06: the ATR-01 and ATR-10 cases rerun under TZ=Europe/Sofia
 * (test/tz-sofia-guard.ts). Under UTC (the pinned default, see
 * attendance-read.service.int-spec.ts) both are flagged as possibly
 * unintended; these tests document that with a Sofia server TZ the
 * server-local range/grouping agrees with gym-local time (TEST_PLAN Q1).
 */
describe('AttendanceService read path under TZ=Europe/Sofia (DT-06)', () => {
  const fixtures = setupIntegrationSuite();

  async function world(fx: Fixtures) {
    const [ana, coach, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach'),
      fx.location('Main'),
    ]);
    const attend = (trainedAt: string) =>
      fx.attend(ana.id, coach.id, loc.id, trainedAt).then((r) => r.attendance);
    return { coach, loc, attend };
  }

  function trainingTime(fx: Fixtures, startTime: string, endTime: string) {
    return fx.ds.getRepository(TrainingTimeEntity).save({ startTime, endTime });
  }

  it('DT-06 ATR-01 dates: the range and the Sofia-date grouping agree', async () => {
    const fx = fixtures();
    const { attend } = await world(fx);
    // 2025-12-01 01:00 Sofia: first day of December.
    await attend('2025-11-30T23:00:00.000Z');
    // 2025-12-31 23:59:59.999 Sofia: last instant of December.
    await attend('2025-12-31T21:59:59.999Z');
    // 2026-01-01 00:00 Sofia: excluded.
    await attend('2025-12-31T22:00:00.000Z');
    // 2026-01-01 01:30 Sofia: excluded (included and mislabelled under UTC).
    await attend('2025-12-31T23:30:00.000Z');

    const res = await fx.attendance.dates({
      from: '2025-12-01',
      to: '2025-12-31',
    });

    expect(res.days.map((d) => [d.date, d.count])).toEqual([
      ['2025-12-01', 1],
      ['2025-12-31', 1],
    ]);
  });

  it('DT-06 ATR-10 sessions: day, hour and slot matching use Sofia wall-clock time', async () => {
    const fx = fixtures();
    const { coach, loc, attend } = await world(fx);
    const slot = await trainingTime(fx, '18:00', '19:00');
    // 18:30 Sofia (winter) = 16:30Z: inside the 18:00-19:00 slot.
    const evening = await attend('2025-12-10T16:30:00.000Z');
    // 2025-12-11 00:30 Sofia = 2025-12-10 22:30Z: belongs to Dec 11.
    const lateNight = await attend('2025-12-10T22:30:00.000Z');

    const tail = `${coach.id}|${loc.id}`;
    const dec10 = await fx.attendance.sessions({
      startDate: '2025-12-10',
      endDate: '2025-12-10',
    });
    expect(
      dec10.sessions.map((s) => ({
        sessionKey: s.sessionKey,
        date: s.date,
        start: s.start,
        end: s.end,
        ids: s.attendance.map((a) => a.id),
      })),
    ).toEqual([
      {
        sessionKey: `2025-12-10|slot:${slot.id}|${tail}`,
        date: '2025-12-10',
        start: '2025-12-10T16:00:00.000Z',
        end: '2025-12-10T17:00:00.000Z',
        ids: [evening.id],
      },
    ]);

    const dec11 = await fx.attendance.sessions({
      startDate: '2025-12-11',
      endDate: '2025-12-11',
    });
    expect(
      dec11.sessions.map((s) => ({
        sessionKey: s.sessionKey,
        date: s.date,
        start: s.start,
        end: s.end,
        ids: s.attendance.map((a) => a.id),
      })),
    ).toEqual([
      {
        sessionKey: `2025-12-11|custom:00:30|${tail}`,
        date: '2025-12-11',
        start: '2025-12-10T22:30:00.000Z',
        end: '2025-12-10T23:30:00.000Z',
        ids: [lateNight.id],
      },
    ]);
  });

  it('DT-06 ATR-10 sessions in summer: 18:30 Sofia = 15:30Z still matches the 18:00 slot', async () => {
    const fx = fixtures();
    const { attend } = await world(fx);
    const slot = await trainingTime(fx, '18:00', '19:00');
    const evening = await attend('2025-07-10T15:30:00.000Z');

    const res = await fx.attendance.sessions({
      startDate: '2025-07-10',
      endDate: '2025-07-10',
    });

    expect(
      res.sessions.map((s) => [
        s.trainingTimeId,
        s.start,
        s.end,
        s.attendance[0].id,
      ]),
    ).toEqual([
      [
        slot.id,
        '2025-07-10T15:00:00.000Z',
        '2025-07-10T16:00:00.000Z',
        evening.id,
      ],
    ]);
  });
});
