import {
  fromGymLocalToUtc,
  toGymLocalDate,
} from '../attendance/attendance-timezone.util';

/** One of the trainee's trainings, as the year in review reads it. */
export interface YearAttendance {
  trainedAt: Date;
  trainerId: string;
  trainerName: string;
}

/**
 * A trainee's year at the gym (`GET /api/trainees/me/year-in-review`), for the front's "Your
 * year" story at New Year. Every date is gym-local (Europe/Sofia).
 */
export interface YearInReview {
  year: number;
  /** Trainings with attendance saved in the year. */
  trainings: number;
  /** The day of the first one ('YYYY-MM-DD'), null without any. */
  firstTrainingOn: string | null;
  /** The start time ('HH:mm') they trained at most, and how often; earlier wins a tie. */
  favouriteTime: { time: string; count: number } | null;
  /** The longest run of weeks in a row (Monday to Sunday) with at least one training. */
  longestStreakWeeks: number;
  /** The trainer they trained with most (never a nickname); fewer trainings, then the name, lose a tie. */
  topTrainer: { id: string; name: string; count: number } | null;
  /** The month (1–12) with most trainings, and how many; earlier wins a tie. */
  busiestMonth: { month: number; count: number } | null;
}

const MS_PER_DAY = 86_400_000;

const sofiaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Sofia',
  hour: '2-digit',
  minute: '2-digit',
  // Explicit 00-23 hours (see attendance-timezone.util.ts).
  hourCycle: 'h23',
});

/** The year's bounds as instants: from Jan 1 00:00 Sofia, up to (not including) the next one. */
export function yearBounds(year: number): { from: Date; to: Date } {
  return {
    from: fromGymLocalToUtc(year, 1, 1, 0, 0),
    to: fromGymLocalToUtc(year + 1, 1, 1, 0, 0),
  };
}

/** Days since 1970-01-01 of a 'YYYY-MM-DD'. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** The week (Monday to Sunday) a day falls in, as a running number: 1970-01-01 was a Thursday. */
function weekNumber(day: string): number {
  return Math.floor((dayNumber(day) + 3) / 7);
}

function topEntry<K>(
  counts: Map<K, number>,
  before: (a: K, b: K) => number,
): [K, number] | null {
  let best: [K, number] | null = null;
  for (const entry of counts) {
    if (
      !best ||
      entry[1] > best[1] ||
      (entry[1] === best[1] && before(entry[0], best[0]) < 0)
    ) {
      best = entry;
    }
  }
  return best;
}

function count<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** The year in review from the trainee's trainings (those outside the year are left out). */
export function yearInReview(
  year: number,
  attendance: readonly YearAttendance[],
): YearInReview {
  const days: string[] = [];
  const times = new Map<string, number>();
  const months = new Map<number, number>();
  const trainers = new Map<string, number>();
  const trainerNames = new Map<string, string>();

  for (const row of attendance) {
    const day = toGymLocalDate(row.trainedAt);
    if (Number(day.slice(0, 4)) !== year) {
      continue;
    }
    days.push(day);
    count(times, sofiaTime.format(row.trainedAt));
    count(months, Number(day.slice(5, 7)));
    count(trainers, row.trainerId);
    trainerNames.set(row.trainerId, row.trainerName);
  }

  const weeks = [...new Set(days.map(weekNumber))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  weeks.forEach((week, index) => {
    run = index > 0 && week === weeks[index - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });

  const time = topEntry(times, (a, b) => a.localeCompare(b));
  const month = topEntry(months, (a, b) => a - b);
  const trainer = topEntry(trainers, (a, b) =>
    (trainerNames.get(a) ?? '').localeCompare(trainerNames.get(b) ?? ''),
  );

  return {
    year,
    trainings: days.length,
    firstTrainingOn: days.length ? [...days].sort()[0] : null,
    favouriteTime: time ? { time: time[0], count: time[1] } : null,
    longestStreakWeeks: longest,
    topTrainer: trainer
      ? {
          id: trainer[0],
          name: trainerNames.get(trainer[0]) ?? '',
          count: trainer[1],
        }
      : null,
    busiestMonth: month ? { month: month[0], count: month[1] } : null,
  };
}
