import { fromGymLocalToUtc } from '../attendance/attendance-timezone.util';
import { addDays } from './schedule-week';

/**
 * Trainees see a day's workout from this hour (gym-local) of the day before: past days, today,
 * and tomorrow once it is 20:00 here. Staff always see every workout.
 */
export const WORKOUT_RELEASE_HOUR = 20;

/**
 * When the workouts of a gym-local day ('YYYY-MM-DD') come out for trainees: 20:00 Europe/Sofia
 * of the day before. Computed, not stored: there is no published flag to flip, so nothing can
 * go out late or early, and a workout changed after it came out shows as changed.
 */
export function workoutReleasesAt(date: string): Date {
  const [year, month, day] = addDays(date, -1).split('-').map(Number);
  return fromGymLocalToUtc(year, month, day, WORKOUT_RELEASE_HOUR, 0);
}

/** Whether trainees may see the workouts of this day at `now` (20:00 itself included). */
export function isWorkoutReleased(date: string, now: Date): boolean {
  return now.getTime() >= workoutReleasesAt(date).getTime();
}
