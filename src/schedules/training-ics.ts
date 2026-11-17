/**
 * A booked training as an iCalendar file (RFC 5545), for Apple Calendar and any other calendar
 * that opens `.ics` files: one event with the training's start and end, the gym as the place,
 * the trainer (and the workout's name once it is out) as the description, and a reminder 30
 * minutes before. Pure: the service gives it the training.
 */
export type CalendarLanguage = 'bg' | 'en';

export const CALENDAR_LANGUAGES: CalendarLanguage[] = ['bg', 'en'];

/** The front's words for the event (its `googleCalendar.event.*`), in the trainee's language. */
const TEXTS: Record<
  CalendarLanguage,
  { title: string; trainer: string; workout: string }
> = {
  bg: {
    title: 'CrossFit тренировка',
    trainer: 'Групов инструктор: {name}',
    workout: 'Тренировка на деня: {title}',
  },
  en: {
    title: 'CrossFit training',
    trainer: 'Group instructor: {name}',
    workout: 'Workout: {title}',
  },
};

/** The reminder comes this long before the training. */
export const REMINDER_MINUTES = 30;

export interface CalendarTraining {
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  gym: { name: string; address: string | null };
  trainerName: string;
  /** Only once the day's workouts are out. */
  workoutTitle: string | null;
}

/** `20261113T160000Z`. */
export function icsInstant(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** A TEXT value: backslashes, semicolons, commas and line breaks escaped. */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets (UTF-8), never inside a character. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    // Continuation lines start with a space, which counts toward their 75.
    const limit = parts.length ? 74 : 75;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function trainingIcs(
  training: CalendarTraining,
  language: CalendarLanguage,
  now: Date,
): string {
  const texts = TEXTS[language];
  const description = [
    texts.trainer.replace('{name}', training.trainerName),
    training.workoutTitle
      ? texts.workout.replace('{title}', training.workoutTitle)
      : null,
  ]
    .filter((line): line is string => !!line)
    .join('\n');
  const location = training.gym.address?.trim() || training.gym.name;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Index//Trainings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // The same training gives the same event, so adding it twice updates it.
    `UID:training-${training.slotId}@theindex.training`,
    `DTSTAMP:${icsInstant(now)}`,
    `DTSTART:${icsInstant(training.startsAt)}`,
    `DTEND:${icsInstant(training.endsAt)}`,
    `SUMMARY:${icsText(texts.title)}`,
    `LOCATION:${icsText(location)}`,
    `DESCRIPTION:${icsText(description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(texts.title)}`,
    `TRIGGER:-PT${REMINDER_MINUTES}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
