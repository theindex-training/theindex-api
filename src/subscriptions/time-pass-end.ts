import {
  fromGymLocalToUtc,
  toGymLocalDate,
} from '../attendance/attendance-timezone.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a TIME plan lasts: a number of days, or of calendar months. */
export type TimePassDuration = {
  durationDays: number | null;
  durationMonths: number | null;
};

/**
 * The date `months` calendar months after `year-month-day`. When the target
 * month is shorter, it is that month's last day (Jan 31 + 1 month = Feb 28,
 * Feb 29 in a leap year).
 */
export function addCalendarMonths(
  year: number,
  month: number,
  day: number,
  months: number,
): { year: number; month: number; day: number } {
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return {
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, lastDay),
  };
}

/**
 * When a TIME pass starting at `startsAt` ends (exclusive: the pass covers
 * `startsAt <= trainedAt < endsAt`).
 *
 * - `durationMonths`: gym-local (Europe/Sofia) midnight of the same day of the
 *   month, that many months after the gym-local day of `startsAt`. A pass from
 *   Apr 14 covers Apr 14 – May 13 and the next one starts on May 14. A day the
 *   target month lacks becomes its last day (Jan 31 + 1 month ends Feb 28).
 * - `durationDays`: `startsAt` + that many 24-hour days, as before.
 */
export function timePassEndsAt(
  startsAt: Date,
  duration: TimePassDuration,
): Date {
  if (duration.durationMonths) {
    const [year, month, day] = toGymLocalDate(startsAt).split('-').map(Number);
    const end = addCalendarMonths(year, month, day, duration.durationMonths);
    return fromGymLocalToUtc(end.year, end.month, end.day, 0, 0);
  }
  return new Date(startsAt.getTime() + duration.durationDays! * DAY_MS);
}

/**
 * The last instant a TIME pass covers (`endsAt` is exclusive). Its gym-local
 * day is the pass's last day: a month pass from Nov 23 ends Dec 23 00:00, so
 * its last day is Dec 22. Count "days left" to this, so the last day reads 0
 * ("ends today"). Passes that end later in the day (e.g. 02:00, as a date-only
 * start gives day plans) keep that day as their last day.
 */
export function timePassLastInstant(endsAt: Date): Date {
  return new Date(endsAt.getTime() - 1);
}
