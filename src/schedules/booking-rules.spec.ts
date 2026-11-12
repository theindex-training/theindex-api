import {
  bookingClosesAt,
  canBook,
  canCancel,
  cancelUntil,
  slotStartsAt,
} from './booking-rules';

describe('booking rules', () => {
  it('a training starts at its gym-local time, in winter and in summer', () => {
    expect(slotStartsAt('2026-11-13', '07:10:00').toISOString()).toBe(
      '2026-11-13T05:10:00.000Z',
    );
    expect(slotStartsAt('2026-07-01', '18:00:00').toISOString()).toBe(
      '2026-07-01T15:00:00.000Z',
    );
  });

  it('booking closes 30 minutes before the start; cancelling, 1 hour before', () => {
    const start = slotStartsAt('2026-11-13', '18:00:00');
    expect(bookingClosesAt(start).toISOString()).toBe(
      '2026-11-13T15:30:00.000Z',
    );
    expect(cancelUntil(start).toISOString()).toBe('2026-11-13T15:00:00.000Z');
  });

  it('a training can be booked until just before its booking closes', () => {
    const start = slotStartsAt('2026-11-13', '18:00:00');
    expect(canBook(new Date('2026-11-13T15:29:59Z'), start)).toBe(true);
    expect(canBook(new Date('2026-11-13T15:30:00Z'), start)).toBe(false);
    expect(canBook(new Date('2026-11-13T16:00:00Z'), start)).toBe(false);
  });

  it('a booking can be cancelled up to exactly 1 hour before', () => {
    const start = slotStartsAt('2026-11-13', '18:00:00');
    expect(canCancel(new Date('2026-11-13T15:00:00Z'), start)).toBe(true);
    expect(canCancel(new Date('2026-11-13T15:00:01Z'), start)).toBe(false);
  });
});
