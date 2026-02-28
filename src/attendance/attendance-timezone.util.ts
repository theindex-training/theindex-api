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
    hour12: false,
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);

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
  const utcEquivalent = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second,
  );

  return utcEquivalent - instant;
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

