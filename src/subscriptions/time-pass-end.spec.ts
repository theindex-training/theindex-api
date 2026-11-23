import { addCalendarMonths, timePassEndsAt } from './time-pass-end';

const months = (durationMonths: number) => ({
  durationDays: null,
  durationMonths,
});

describe('addCalendarMonths', () => {
  it.each([
    [
      [2026, 4, 14, 1],
      [2026, 5, 14],
    ],
    [
      [2026, 1, 14, 1],
      [2026, 2, 14],
    ],
    [
      [2026, 11, 14, 3],
      [2027, 2, 14],
    ],
    [
      [2026, 12, 31, 1],
      [2027, 1, 31],
    ],
    [
      [2026, 1, 31, 1],
      [2026, 2, 28],
    ],
    [
      [2028, 1, 31, 1],
      [2028, 2, 29],
    ],
    [
      [2026, 3, 31, 1],
      [2026, 4, 30],
    ],
    [
      [2026, 8, 31, 6],
      [2027, 2, 28],
    ],
    [
      [2026, 5, 1, 12],
      [2027, 5, 1],
    ],
    [
      [2026, 1, 30, 25],
      [2028, 2, 29],
    ],
  ])('%j -> %j', ([y, m, d, n], [ey, em, ed]) => {
    expect(addCalendarMonths(y, m, d, n)).toEqual({
      year: ey,
      month: em,
      day: ed,
    });
  });
});

describe('timePassEndsAt', () => {
  it('months: ends at Europe/Sofia midnight of the same day next month (summer, UTC+3)', () => {
    // A date-only start ('2026-04-14') is stored as UTC midnight: 03:00 Sofia.
    const end = timePassEndsAt(new Date('2026-04-14T00:00:00Z'), months(1));
    expect(end.toISOString()).toBe('2026-05-13T21:00:00.000Z'); // May 14 00:00 Sofia
  });

  it('months: winter end is midnight at UTC+2', () => {
    const end = timePassEndsAt(new Date('2026-01-14T00:00:00Z'), months(1));
    expect(end.toISOString()).toBe('2026-02-13T22:00:00.000Z'); // Feb 14 00:00 Sofia
  });

  it('months: crossing a DST change still ends at local midnight', () => {
    // Mar 14 (UTC+2) -> Apr 14 (UTC+3), and Oct 14 (UTC+3) -> Nov 14 (UTC+2).
    expect(
      timePassEndsAt(new Date('2026-03-14T00:00:00Z'), months(1)).toISOString(),
    ).toBe('2026-04-13T21:00:00.000Z');
    expect(
      timePassEndsAt(new Date('2026-10-14T00:00:00Z'), months(1)).toISOString(),
    ).toBe('2026-11-13T22:00:00.000Z');
  });

  it('months: the start day is the Europe/Sofia day, not the UTC day', () => {
    // 22:30 UTC on Apr 13 is 01:30 on Apr 14 in Sofia.
    const end = timePassEndsAt(new Date('2026-04-13T22:30:00Z'), months(1));
    expect(end.toISOString()).toBe('2026-05-13T21:00:00.000Z');
  });

  it('months: a start time during the day still ends at midnight', () => {
    const end = timePassEndsAt(new Date('2026-11-23T14:37:00Z'), months(1));
    expect(end.toISOString()).toBe('2026-12-22T22:00:00.000Z'); // Dec 23 00:00 Sofia
  });

  it('months: a day the target month lacks becomes its last day', () => {
    const end = timePassEndsAt(new Date('2026-01-31T00:00:00Z'), months(1));
    expect(end.toISOString()).toBe('2026-02-27T22:00:00.000Z'); // Feb 28 00:00 Sofia
  });

  it('months: several months', () => {
    const end = timePassEndsAt(new Date('2026-11-14T00:00:00Z'), months(3));
    expect(end.toISOString()).toBe('2027-02-13T22:00:00.000Z'); // Feb 14 00:00 Sofia
  });

  it('days: startsAt + N x 24h, unchanged', () => {
    const end = timePassEndsAt(new Date('2025-03-15T10:00:00.000Z'), {
      durationDays: 30,
      durationMonths: null,
    });
    expect(end.toISOString()).toBe('2025-04-14T10:00:00.000Z');
  });
});
