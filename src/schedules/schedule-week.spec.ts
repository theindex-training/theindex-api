import {
  addDays,
  compareSlots,
  firstEditableDate,
  isEditableDate,
  isWeekOver,
  weekDates,
  weekStartOf,
  weekdayOf,
} from './schedule-week';

describe('schedule-week', () => {
  it('numbers weekdays Monday 1 to Sunday 7', () => {
    expect(weekdayOf('2026-11-09')).toBe(1);
    expect(weekdayOf('2026-11-12')).toBe(4);
    expect(weekdayOf('2026-11-15')).toBe(7);
  });

  it('finds the Monday of any day, across months and years', () => {
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09');
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
  });

  it('lists the seven days of a week, also over a DST change', () => {
    expect(weekDates('2026-10-19')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });

  it('keeps today and earlier days read-only; tomorrow is the first editable day', () => {
    expect(firstEditableDate('2026-11-12')).toBe('2026-11-13');
    expect(isEditableDate('2026-11-11', '2026-11-12')).toBe(false);
    expect(isEditableDate('2026-11-12', '2026-11-12')).toBe(false);
    expect(isEditableDate('2026-11-13', '2026-11-12')).toBe(true);
  });

  it('a week is over only after its Sunday', () => {
    expect(isWeekOver('2026-11-09', '2026-11-15')).toBe(false);
    expect(isWeekOver('2026-11-09', '2026-11-16')).toBe(true);
  });

  it('orders slots by day, start, end, then trainer name', () => {
    const slot = (date: string, start: string, end: string, name: string) => ({
      date,
      trainingTime: { startTime: start, endTime: end },
      trainer: { name },
    });
    const slots = [
      slot('2026-11-10', '07:10:00', '08:10:00', 'Velcho'),
      slot('2026-11-09', '17:00:00', '18:00:00', 'Vasko'),
      slot('2026-11-09', '08:10:00', '09:10:00', 'Velcho'),
      slot('2026-11-09', '07:10:00', '08:10:00', 'Velcho'),
      slot('2026-11-09', '07:10:00', '08:10:00', 'Ana'),
      slot('2026-11-09', '07:10:00', '07:40:00', 'Velcho'),
    ];
    expect(
      [...slots]
        .sort(compareSlots)
        .map(
          (s) =>
            `${s.date} ${s.trainingTime.startTime}-${s.trainingTime.endTime} ${s.trainer.name}`,
        ),
    ).toEqual([
      '2026-11-09 07:10:00-07:40:00 Velcho',
      '2026-11-09 07:10:00-08:10:00 Ana',
      '2026-11-09 07:10:00-08:10:00 Velcho',
      '2026-11-09 08:10:00-09:10:00 Velcho',
      '2026-11-09 17:00:00-18:00:00 Vasko',
      '2026-11-10 07:10:00-08:10:00 Velcho',
    ]);
  });

  it('orders template slots by weekday', () => {
    const slot = (weekday: number, start: string) => ({
      weekday,
      trainingTime: { startTime: start, endTime: '23:00:00' },
      trainer: { name: 'A' },
    });
    expect(
      [slot(3, '07:00:00'), slot(1, '18:00:00'), slot(1, '07:00:00')]
        .sort(compareSlots)
        .map((s) => `${s.weekday} ${s.trainingTime.startTime}`),
    ).toEqual(['1 07:00:00', '1 18:00:00', '3 07:00:00']);
  });
});
