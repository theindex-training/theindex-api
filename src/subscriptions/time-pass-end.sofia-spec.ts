import { timePassEndsAt } from './time-pass-end';

const months = (durationMonths: number) => ({
  durationDays: null,
  durationMonths,
});

// DT-06: the same instants as time-pass-end.spec.ts, with the process in
// Europe/Sofia (the end must not depend on the server's timezone).
describe('timePassEndsAt under TZ=Europe/Sofia', () => {
  it.each([
    ['2026-04-14T00:00:00Z', 1, '2026-05-13T21:00:00.000Z'],
    ['2026-01-14T00:00:00Z', 1, '2026-02-13T22:00:00.000Z'],
    ['2026-04-13T22:30:00Z', 1, '2026-05-13T21:00:00.000Z'],
    ['2026-01-31T00:00:00Z', 1, '2026-02-27T22:00:00.000Z'],
    ['2026-10-14T00:00:00Z', 1, '2026-11-13T22:00:00.000Z'],
    ['2026-11-14T00:00:00Z', 3, '2027-02-13T22:00:00.000Z'],
  ])('%s + %i month(s) -> %s', (start, n, end) => {
    expect(timePassEndsAt(new Date(start), months(n)).toISOString()).toBe(end);
  });
});
