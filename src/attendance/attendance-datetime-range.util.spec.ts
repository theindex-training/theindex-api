import { BadRequestException } from '@nestjs/common';
import { getLocalDateTimeInterval } from './attendance-datetime-range.util';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as Error).message;
  }
  throw new Error('expected a BadRequestException');
}

// Runs under TZ=UTC (test/tz-guard.ts), so "local" times are UTC.
describe('getLocalDateTimeInterval (DT-04)', () => {
  const isoRange = (input: Parameters<typeof getLocalDateTimeInterval>[0]) => {
    const r = getLocalDateTimeInterval(input);
    return [r.from.toISOString(), r.to.toISOString()];
  };

  it('DT-04 defaults to 00:00 .. 23:59, so "to" is the next day 00:00 (exclusive)', () => {
    expect(
      isoRange({ startDate: '2025-12-01', endDate: '2025-12-31' }),
    ).toEqual(['2025-12-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
  });

  it('DT-04 custom times: "to" is the end minute + 59.999 s + 1 ms', () => {
    expect(
      isoRange({
        startDate: '2025-12-01',
        endDate: '2025-12-02',
        startTime: '08:30',
        endTime: '10:15',
      }),
    ).toEqual(['2025-12-01T08:30:00.000Z', '2025-12-02T10:16:00.000Z']);
  });

  it('DT-04 start and end in the same minute is allowed (one-minute window)', () => {
    expect(
      isoRange({
        startDate: '2025-12-01',
        endDate: '2025-12-01',
        startTime: '10:00',
        endTime: '10:00',
      }),
    ).toEqual(['2025-12-01T10:00:00.000Z', '2025-12-01T10:01:00.000Z']);
  });

  it('DT-04 start after end -> 400', () => {
    expect(
      messageOf(() =>
        getLocalDateTimeInterval({
          startDate: '2025-12-01',
          endDate: '2025-12-01',
          startTime: '10:01',
          endTime: '10:00',
        }),
      ),
    ).toBe('start date/time must be before end date/time');
    expect(
      messageOf(() =>
        getLocalDateTimeInterval({
          startDate: '2025-12-02',
          endDate: '2025-12-01',
        }),
      ),
    ).toBe('start date/time must be before end date/time');
  });

  it('DT-04 out-of-range or malformed times -> 400 "Invalid time"', () => {
    for (const time of ['24:00', '12:60', '-1:00', 'ab:cd', '8']) {
      expect(
        messageOf(() =>
          getLocalDateTimeInterval({
            startDate: '2025-12-01',
            endDate: '2025-12-01',
            startTime: time,
          }),
        ),
      ).toBe('Invalid time');
      expect(
        messageOf(() =>
          getLocalDateTimeInterval({
            startDate: '2025-12-01',
            endDate: '2025-12-01',
            endTime: time,
          }),
        ),
      ).toBe('Invalid time');
    }
  });

  it('DT-04 bad dates -> 400 "Invalid date"', () => {
    expect(
      messageOf(() =>
        getLocalDateTimeInterval({
          startDate: 'garbage',
          endDate: '2025-12-01',
        }),
      ),
    ).toBe('Invalid date');
    expect(
      messageOf(() =>
        getLocalDateTimeInterval({
          startDate: '2025-12-01',
          endDate: '2025-00-01',
        }),
      ),
    ).toBe('Invalid date');
  });
});
