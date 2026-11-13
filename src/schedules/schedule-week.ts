/**
 * Pure date rules of the weekly schedules. Days are gym-local calendar dates, 'YYYY-MM-DD'
 * (Europe/Sofia, see attendance/attendance-timezone.util.ts); weeks run Monday to Sunday.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcDay(toUtcDay(date) + days * DAY_MS);
}

/** ISO weekday of a date: 1 = Monday ... 7 = Sunday (the template's `weekday`). */
export function weekdayOf(date: string): number {
  const day = new Date(toUtcDay(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week a date falls in. */
export function weekStartOf(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

/** The seven dates of the week that starts on `weekStart`, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * The first day whose slots can still change: tomorrow. Today and the days before it are
 * read-only (the trainings have happened or are happening).
 */
export function firstEditableDate(today: string): string {
  return addDays(today, 1);
}

export function isEditableDate(date: string, today: string): boolean {
  return date >= firstEditableDate(today);
}

/** A week can be created until its last day (Sunday) is over. */
export function isWeekOver(weekStart: string, today: string): boolean {
  return addDays(weekStart, 6) < today;
}

type Sortable = {
  date?: string;
  weekday?: number;
  trainingTime: { startTime: string; endTime: string };
  trainer: { name: string };
};

/**
 * Slots in the order people read them: by day, then start time, end time and trainer name.
 * Times are Postgres `time` strings ('07:10:00'), so they compare as text.
 */
export function compareSlots(a: Sortable, b: Sortable): number {
  const day = (s: Sortable) => s.date ?? String(s.weekday ?? 0);
  return (
    day(a).localeCompare(day(b)) ||
    a.trainingTime.startTime.localeCompare(b.trainingTime.startTime) ||
    a.trainingTime.endTime.localeCompare(b.trainingTime.endTime) ||
    a.trainer.name.localeCompare(b.trainer.name)
  );
}

/**
 * The workout of each day that has exactly one: a week created from the template puts it on that
 * day's trainings. A day with several workouts gets none (only a trainer knows which applies).
 */
export function onlyWorkoutByDay(
  workouts: { id: string; date: string }[],
): Map<string, string> {
  const byDay = new Map<string, string[]>();
  for (const workout of workouts) {
    byDay.set(workout.date, [...(byDay.get(workout.date) ?? []), workout.id]);
  }
  const only = new Map<string, string>();
  for (const [date, ids] of byDay) {
    if (ids.length === 1) only.set(date, ids[0]);
  }
  return only;
}
