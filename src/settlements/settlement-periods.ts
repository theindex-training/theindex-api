import {
  fromGymLocalToUtc,
  toGymLocalDate,
} from '../attendance/attendance-timezone.util';

/**
 * Settlement reports cover half months, in gym-local (Europe/Sofia) dates: the 1st to the 15th,
 * and the 16th to the last day of the month. A report is created automatically once its period
 * is over, at 04:00 gym-local the day after (the 16th for the first half, the 1st of the next
 * month for the second).
 */
export const SETTLEMENT_CREATION_HOUR = 4;

export interface SettlementPeriod {
  /** First day, `YYYY-MM-DD`. */
  periodStart: string;
  /** Last day, `YYYY-MM-DD`. */
  periodEnd: string;
}

function parse(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function format(y: number, m: number, d: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The calendar date `days` after `date` (both `YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return format(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The half month a gym-local date belongs to. */
export function halfMonthOf(date: string): SettlementPeriod {
  const { y, m, d } = parse(date);
  return d <= 15
    ? { periodStart: format(y, m, 1), periodEnd: format(y, m, 15) }
    : {
        periodStart: format(y, m, 16),
        periodEnd: format(y, m, lastDayOfMonth(y, m)),
      };
}

/**
 * The period that follows one ending on `periodEnd`: from the next day to the end of that day's
 * half month. After a regular half month this is the next half month; after a period that ended
 * mid-half (an old, manually chosen one) it is the rest of that half month.
 */
export function periodAfter(periodEnd: string): SettlementPeriod {
  const periodStart = addDays(periodEnd, 1);
  return { periodStart, periodEnd: halfMonthOf(periodStart).periodEnd };
}

/** The period as instants: `[periodStart 00:00, the day after periodEnd 00:00)`, gym-local. */
export function periodBounds(period: SettlementPeriod): {
  from: Date;
  to: Date;
} {
  const start = parse(period.periodStart);
  const after = parse(addDays(period.periodEnd, 1));
  return {
    from: fromGymLocalToUtc(start.y, start.m, start.d, 0, 0),
    to: fromGymLocalToUtc(after.y, after.m, after.d, 0, 0),
  };
}

/** When a period is over: the start of the day after its last day, gym-local. */
export function periodEndsAt(period: SettlementPeriod): Date {
  return periodBounds(period).to;
}

/** When the report of a period is created: 04:00 gym-local the day after its last day. */
export function reportCreatedAt(period: SettlementPeriod): Date {
  const after = parse(addDays(period.periodEnd, 1));
  return fromGymLocalToUtc(
    after.y,
    after.m,
    after.d,
    SETTLEMENT_CREATION_HOUR,
    0,
  );
}

/**
 * The periods whose report should exist at `now` and doesn't yet, oldest first.
 * - After the latest existing report (`latestPeriodEnd`), every following period whose creation
 *   time has come, so a missed run catches up.
 * - With no report at all (a new installation), only the latest period whose creation time has
 *   come: everything before it that is still to be paid is carried into that one.
 */
export function periodsDue(
  latestPeriodEnd: string | null,
  now: Date,
): SettlementPeriod[] {
  const due = (period: SettlementPeriod) =>
    reportCreatedAt(period).getTime() <= now.getTime();

  if (latestPeriodEnd === null) {
    // The half month that ended most recently: the previous one, or the one before it before
    // 04:00 on the day after.
    const today = toGymLocalDate(now);
    let candidate = halfMonthOf(addDays(halfMonthOf(today).periodStart, -1));
    if (!due(candidate)) {
      candidate = halfMonthOf(addDays(candidate.periodStart, -1));
    }
    return [candidate];
  }

  const periods: SettlementPeriod[] = [];
  let next = periodAfter(latestPeriodEnd);
  while (due(next)) {
    periods.push(next);
    next = periodAfter(next.periodEnd);
  }
  return periods;
}
