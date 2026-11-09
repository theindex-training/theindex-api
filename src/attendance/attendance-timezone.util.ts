const DEFAULT_GYM_TIMEZONE = 'Europe/Sofia';

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getDatePartsInTimeZone(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // Explicit 00-23 hours. `hour12: false` resolves to `h24` on some
    // Node/ICU builds (incl. Node 20), which renders midnight as hour 24 and
    // shifted every 00:xx gym-local time one day early.
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function getTimeZoneOffsetMs(instant: number, timeZone: string): number {
  const zoned = getDatePartsInTimeZone(new Date(instant), timeZone);
  const instantOnWholeSecond = Math.trunc(instant / 1000) * 1000;
  const utcEquivalent = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );

  return utcEquivalent - instantOnWholeSecond;
}

export function fromGymLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  millisecond = 0,
  timeZone = DEFAULT_GYM_TIMEZONE,
): Date {
  const localAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond,
  );

  // Offset can vary around DST transitions, so we resolve it iteratively.
  let utcInstant = localAsUtc - getTimeZoneOffsetMs(localAsUtc, timeZone);
  utcInstant = localAsUtc - getTimeZoneOffsetMs(utcInstant, timeZone);

  return new Date(utcInstant);
}

/** The gym-local calendar date of an instant, as `YYYY-MM-DD`. */
export function toGymLocalDate(
  date: Date,
  timeZone = DEFAULT_GYM_TIMEZONE,
): string {
  const { year, month, day } = getDatePartsInTimeZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Whole gym-local calendar days from `from` to `to` (negative when `to` is
 * earlier). Two instants on the same gym-local date are 0 days apart, and the
 * DST changes don't shift the count.
 */
export function gymLocalDaysBetween(
  from: Date,
  to: Date,
  timeZone = DEFAULT_GYM_TIMEZONE,
): number {
  const dayNumber = (date: Date) => {
    const [y, m, d] = toGymLocalDate(date, timeZone).split('-').map(Number);
    return Date.UTC(y, m - 1, d) / (24 * 60 * 60 * 1000);
  };
  return dayNumber(to) - dayNumber(from);
}
