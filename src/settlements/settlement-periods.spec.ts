import {
  addDays,
  halfMonthOf,
  periodAfter,
  periodBounds,
  periodsDue,
  reportCreatedAt,
} from './settlement-periods';
import { nextSettlementRun } from './settlements-cron.service';

describe('settlement periods', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it.each([
    ['2026-11-01', '2026-11-01', '2026-11-15'],
    ['2026-11-15', '2026-11-01', '2026-11-15'],
    ['2026-11-16', '2026-11-16', '2026-11-30'],
    ['2026-12-31', '2026-12-16', '2026-12-31'],
    ['2026-02-20', '2026-02-16', '2026-02-28'],
    ['2028-02-29', '2028-02-16', '2028-02-29'],
  ])('halfMonthOf(%s) is %s to %s', (date, periodStart, periodEnd) => {
    expect(halfMonthOf(date)).toEqual({ periodStart, periodEnd });
  });

  it.each([
    ['2026-11-15', '2026-11-16', '2026-11-30'],
    ['2026-11-30', '2026-12-01', '2026-12-15'],
    ['2026-12-31', '2027-01-01', '2027-01-15'],
    ['2027-02-15', '2027-02-16', '2027-02-28'],
    // After an old manual period that ended mid-half: the rest of that half.
    ['2026-11-10', '2026-11-11', '2026-11-15'],
  ])('periodAfter(%s) is %s to %s', (end, periodStart, periodEnd) => {
    expect(periodAfter(end)).toEqual({ periodStart, periodEnd });
  });

  it('periodBounds are gym-local midnights, across the summer time change', () => {
    expect(
      periodBounds({ periodStart: '2026-11-01', periodEnd: '2026-11-15' }),
    ).toEqual({
      from: new Date('2026-10-31T22:00:00.000Z'),
      to: new Date('2026-11-15T22:00:00.000Z'),
    });
    // Summer time starts on 2026-03-29 in Sofia (UTC+2 -> UTC+3).
    expect(
      periodBounds({ periodStart: '2026-03-16', periodEnd: '2026-03-31' }),
    ).toEqual({
      from: new Date('2026-03-15T22:00:00.000Z'),
      to: new Date('2026-03-31T21:00:00.000Z'),
    });
  });

  it('a report is created at 04:00 Sofia the day after its period', () => {
    expect(
      reportCreatedAt({ periodStart: '2026-11-16', periodEnd: '2026-11-30' }),
    ).toEqual(new Date('2026-12-01T02:00:00.000Z'));
    expect(
      reportCreatedAt({ periodStart: '2026-07-01', periodEnd: '2026-07-15' }),
    ).toEqual(new Date('2026-07-16T01:00:00.000Z'));
  });

  describe('periodsDue', () => {
    it('after the last manual report (to Nov 15): Nov 16-30 from 04:00 Sofia on Dec 1', () => {
      expect(
        periodsDue('2026-11-15', new Date('2026-12-01T01:59:59.999Z')),
      ).toEqual([]);
      expect(
        periodsDue('2026-11-15', new Date('2026-12-01T02:00:00.000Z')),
      ).toEqual([{ periodStart: '2026-11-16', periodEnd: '2026-11-30' }]);
    });

    it('catches up on every period missed, oldest first', () => {
      expect(
        periodsDue('2026-11-15', new Date('2027-01-20T12:00:00.000Z')),
      ).toEqual([
        { periodStart: '2026-11-16', periodEnd: '2026-11-30' },
        { periodStart: '2026-12-01', periodEnd: '2026-12-15' },
        { periodStart: '2026-12-16', periodEnd: '2026-12-31' },
        { periodStart: '2027-01-01', periodEnd: '2027-01-15' },
      ]);
    });

    it('after a period that ended mid-half: the rest of that half, then half months', () => {
      expect(
        periodsDue('2026-11-10', new Date('2026-12-02T00:00:00.000Z')),
      ).toEqual([
        { periodStart: '2026-11-11', periodEnd: '2026-11-15' },
        { periodStart: '2026-11-16', periodEnd: '2026-11-30' },
      ]);
    });

    it('with no report yet: only the half month that ended last', () => {
      expect(periodsDue(null, new Date('2026-11-19T10:00:00.000Z'))).toEqual([
        { periodStart: '2026-11-01', periodEnd: '2026-11-15' },
      ]);
      // 03:00 Sofia on Nov 16: Nov 1-15's report isn't due yet.
      expect(periodsDue(null, new Date('2026-11-16T01:00:00.000Z'))).toEqual([
        { periodStart: '2026-10-16', periodEnd: '2026-10-31' },
      ]);
    });
  });

  describe('nextSettlementRun', () => {
    it('is the next 04:00 Sofia, strictly after now', () => {
      expect(nextSettlementRun(new Date('2026-11-19T10:00:00.000Z'))).toEqual(
        new Date('2026-11-20T02:00:00.000Z'),
      );
      expect(nextSettlementRun(new Date('2026-11-20T01:59:00.000Z'))).toEqual(
        new Date('2026-11-20T02:00:00.000Z'),
      );
      expect(nextSettlementRun(new Date('2026-11-20T02:00:00.000Z'))).toEqual(
        new Date('2026-11-21T02:00:00.000Z'),
      );
    });

    it('follows the summer time change', () => {
      // Sofia moves to UTC+3 at 03:00 on 2026-03-29.
      expect(nextSettlementRun(new Date('2026-03-28T12:00:00.000Z'))).toEqual(
        new Date('2026-03-29T01:00:00.000Z'),
      );
    });
  });
});
