import { getLocalDateTimeInterval } from './attendance-datetime-range.util';

/**
 * DT-06: DT-04 rerun under TZ=Europe/Sofia (test/tz-sofia-guard.ts).
 * `/attendance/sessions` uses this range; under Sofia the times a user types
 * are gym-local.
 */
describe('getLocalDateTimeInterval under TZ=Europe/Sofia (DT-06 / DT-04)', () => {
  const isoRange = (input: Parameters<typeof getLocalDateTimeInterval>[0]) => {
    const r = getLocalDateTimeInterval(input);
    return [r.from.toISOString(), r.to.toISOString()];
  };

  it('DT-06 defaults 00:00 .. 23:59 Sofia: "to" is the next Sofia midnight', () => {
    expect(
      isoRange({ startDate: '2025-12-01', endDate: '2025-12-31' }),
    ).toEqual(['2025-11-30T22:00:00.000Z', '2025-12-31T22:00:00.000Z']);
  });

  it('DT-06 custom times are Sofia wall-clock times (winter +02:00, summer +03:00)', () => {
    expect(
      isoRange({
        startDate: '2025-12-01',
        endDate: '2025-12-02',
        startTime: '08:30',
        endTime: '10:15',
      }),
    ).toEqual(['2025-12-01T06:30:00.000Z', '2025-12-02T08:16:00.000Z']);
    expect(
      isoRange({
        startDate: '2025-07-01',
        endDate: '2025-07-01',
        startTime: '08:30',
        endTime: '10:15',
      }),
    ).toEqual(['2025-07-01T05:30:00.000Z', '2025-07-01T07:16:00.000Z']);
  });

  it('DT-06 DST: a time in the spring-forward gap moves 1h later; an overlap time takes the first (+03:00) instant', () => {
    // 2025-03-30 03:30 Sofia doesn't exist -> 04:30 EEST.
    expect(
      isoRange({
        startDate: '2025-03-30',
        endDate: '2025-03-30',
        startTime: '03:30',
        endTime: '05:00',
      }),
    ).toEqual(['2025-03-30T01:30:00.000Z', '2025-03-30T02:01:00.000Z']);
    // 2025-10-26 03:30 Sofia happens twice -> the EEST one.
    expect(
      isoRange({
        startDate: '2025-10-26',
        endDate: '2025-10-26',
        startTime: '03:30',
        endTime: '03:30',
      }),
    ).toEqual(['2025-10-26T00:30:00.000Z', '2025-10-26T00:31:00.000Z']);
  });
});
