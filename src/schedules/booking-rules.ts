import { fromGymLocalToUtc } from '../attendance/attendance-timezone.util';

/** Booking a training closes this long before it starts. */
export const BOOKING_CLOSES_MINUTES_BEFORE = 30;
/** A booking can be cancelled until this long before the training starts. */
export const CANCEL_UNTIL_MINUTES_BEFORE = 60;

const MINUTE_MS = 60 * 1000;

/** When a training starts: its gym-local day and start time (Postgres `time`, '07:10:00'). */
export function slotStartsAt(date: string, startTime: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = startTime.split(':').map(Number);
  return fromGymLocalToUtc(year, month, day, hour, minute);
}

export function bookingClosesAt(startsAt: Date): Date {
  return new Date(
    startsAt.getTime() - BOOKING_CLOSES_MINUTES_BEFORE * MINUTE_MS,
  );
}

export function cancelUntil(startsAt: Date): Date {
  return new Date(startsAt.getTime() - CANCEL_UNTIL_MINUTES_BEFORE * MINUTE_MS);
}

/** A training can be booked until 30 minutes before it starts. */
export function canBook(now: Date, startsAt: Date): boolean {
  return now.getTime() < bookingClosesAt(startsAt).getTime();
}

/** A booking can be cancelled until 1 hour before the training, that moment included. */
export function canCancel(now: Date, startsAt: Date): boolean {
  return now.getTime() <= cancelUntil(startsAt).getTime();
}
