import { fromGymLocalToUtc } from './attendance-timezone.util';

describe('fromGymLocalToUtc (DT-01)', () => {
  const iso = (...args: Parameters<typeof fromGymLocalToUtc>) =>
    fromGymLocalToUtc(...args).toISOString();

  it('DT-01 winter is UTC+2 and summer is UTC+3 in Europe/Sofia', () => {
    expect(iso(2025, 1, 15, 8, 10)).toBe('2025-01-15T06:10:00.000Z');
    expect(iso(2025, 7, 15, 8, 10)).toBe('2025-07-15T05:10:00.000Z');
  });

  it('DT-01 keeps seconds and milliseconds', () => {
    expect(iso(2025, 1, 15, 8, 10, 42, 7)).toBe('2025-01-15T06:10:42.007Z');
    expect(iso(2025, 7, 15, 23, 59, 59, 999)).toBe('2025-07-15T20:59:59.999Z');
  });

  it('DT-01 01:00 local on Jan 1 converts to 23:00Z on Dec 31', () => {
    expect(iso(2026, 1, 1, 1, 0)).toBe('2025-12-31T23:00:00.000Z');
  });

  // Regression: on Node 20, Intl's hour12:false resolved to hourCycle h24,
  // so midnight read as hour 24 and every 00:xx time came out one day early.
  // These must hold on every Node version (CI and production use `.nvmrc`).
  it('DT-01 00:xx gym-local times convert to the same day, not one day early', () => {
    expect(iso(2026, 1, 1, 0, 0)).toBe('2025-12-31T22:00:00.000Z');
    expect(iso(2026, 1, 1, 0, 30)).toBe('2025-12-31T22:30:00.000Z');
    expect(iso(2025, 7, 15, 0, 0)).toBe('2025-07-14T21:00:00.000Z');
    expect(iso(2025, 7, 15, 0, 59, 59, 999)).toBe('2025-07-14T21:59:59.999Z');
    // DST switch days
    expect(iso(2025, 3, 30, 0, 30)).toBe('2025-03-29T22:30:00.000Z');
    expect(iso(2025, 10, 26, 0, 30)).toBe('2025-10-25T21:30:00.000Z');
    // other zones, incl. UTC itself
    expect(iso(2025, 1, 15, 0, 30, 0, 0, 'UTC')).toBe(
      '2025-01-15T00:30:00.000Z',
    );
    expect(iso(2025, 1, 15, 0, 30, 0, 0, 'America/New_York')).toBe(
      '2025-01-15T05:30:00.000Z',
    );
  });

  it('DT-01 honours an explicit timeZone argument', () => {
    expect(iso(2025, 1, 15, 8, 10, 0, 0, 'America/New_York')).toBe(
      '2025-01-15T13:10:00.000Z',
    );
    expect(iso(2025, 1, 15, 8, 10, 0, 0, 'UTC')).toBe(
      '2025-01-15T08:10:00.000Z',
    );
  });

  it('DT-01 last hour before and first hour after the DST switches', () => {
    // spring forward: 2025-03-30 03:00 EET -> 04:00 EEST (01:00Z)
    expect(iso(2025, 3, 30, 2, 59)).toBe('2025-03-30T00:59:00.000Z');
    expect(iso(2025, 3, 30, 4, 0)).toBe('2025-03-30T01:00:00.000Z');
    // fall back: 2025-10-26 04:00 EEST -> 03:00 EET (01:00Z)
    expect(iso(2025, 10, 26, 2, 59)).toBe('2025-10-25T23:59:00.000Z');
    expect(iso(2025, 10, 26, 4, 0)).toBe('2025-10-26T02:00:00.000Z');
  });

  it('DT-01 pins the result for a local time that does not exist (spring-forward gap)', () => {
    // 03:30 is skipped; today it resolves to 01:30Z = 04:30 EEST.
    expect(iso(2025, 3, 30, 3, 30)).toBe('2025-03-30T01:30:00.000Z');
  });

  it('DT-01 pins the result for a local time that happens twice (fall-back overlap)', () => {
    // 03:30 happens at 00:30Z (EEST) and 01:30Z (EET); today it picks the later one.
    expect(iso(2025, 10, 26, 3, 30)).toBe('2025-10-26T01:30:00.000Z');
  });
});
