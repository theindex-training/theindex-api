import { YearAttendance, yearBounds, yearInReview } from './year-in-review';

const IVAN = { trainerId: 'tr-ivan', trainerName: 'Ivan Petrov' };
const DESI = { trainerId: 'tr-desi', trainerName: 'Desislava Ilieva' };

const at = (
  iso: string,
  trainer: { trainerId: string; trainerName: string } = IVAN,
): YearAttendance => ({ trainedAt: new Date(iso), ...trainer });

describe('yearInReview', () => {
  it('is empty for a year without trainings', () => {
    expect(yearInReview(2026, [])).toEqual({
      year: 2026,
      trainings: 0,
      firstTrainingOn: null,
      favouriteTime: null,
      longestStreakWeeks: 0,
      topTrainer: null,
      busiestMonth: null,
    });
  });

  it('counts the year’s trainings by the gym’s calendar, not UTC', () => {
    const review = yearInReview(2026, [
      // 23:30 UTC on Dec 31, 2025 is 01:30 on Jan 1, 2026 in Sofia: in.
      at('2025-12-31T23:30:00Z'),
      // 22:30 UTC on Dec 31, 2026 is 00:30 on Jan 1, 2027 in Sofia: out.
      at('2026-12-31T22:30:00Z'),
      at('2026-06-10T05:00:00Z'),
    ]);
    expect(review.trainings).toBe(2);
    expect(review.firstTrainingOn).toBe('2026-01-01');
  });

  it('finds the favourite start time, in Sofia time, the earlier one winning a tie', () => {
    const review = yearInReview(2026, [
      // 07:00 Sofia in winter (UTC+2) and in summer (UTC+3).
      at('2026-02-02T05:00:00Z'),
      at('2026-07-07T04:00:00Z'),
      at('2026-03-03T16:30:00Z'), // 18:30
      at('2026-03-04T16:30:00Z'), // 18:30
      at('2026-03-05T06:00:00Z'), // 08:00
    ]);
    expect(review.favouriteTime).toEqual({ time: '07:00', count: 2 });
  });

  it('counts the longest run of weeks (Monday to Sunday) with a training', () => {
    const review = yearInReview(2026, [
      // Three weeks in a row: Mon Jan 5, Sun Jan 18 (a week later), Mon Jan 19.
      at('2026-01-05T08:00:00Z'),
      at('2026-01-18T08:00:00Z'),
      at('2026-01-19T08:00:00Z'),
      at('2026-01-20T08:00:00Z'),
      // A gap, then two weeks in a row.
      at('2026-03-02T08:00:00Z'),
      at('2026-03-09T08:00:00Z'),
    ]);
    expect(review.longestStreakWeeks).toBe(2 + 1);
  });

  it('runs a streak across a month and the turn of the week at Sofia midnight', () => {
    const review = yearInReview(2026, [
      // Sunday Mar 29, 23:30 Sofia (20:30 UTC, the clocks have gone forward) ...
      at('2026-03-29T20:30:00Z'),
      // ... and Monday Mar 30, 00:30 Sofia: two weeks.
      at('2026-03-29T21:30:00Z'),
    ]);
    expect(review.longestStreakWeeks).toBe(2);
  });

  it('names the trainer trained with most, the name deciding a tie', () => {
    expect(
      yearInReview(2026, [
        at('2026-01-05T08:00:00Z', DESI),
        at('2026-01-06T08:00:00Z'),
        at('2026-01-07T08:00:00Z'),
      ]).topTrainer,
    ).toEqual({ id: 'tr-ivan', name: 'Ivan Petrov', count: 2 });
    expect(
      yearInReview(2026, [
        at('2026-01-05T08:00:00Z', IVAN),
        at('2026-01-06T08:00:00Z', DESI),
      ]).topTrainer,
    ).toEqual({ id: 'tr-desi', name: 'Desislava Ilieva', count: 1 });
  });

  it('finds the busiest month, the earlier winning a tie', () => {
    const review = yearInReview(2026, [
      at('2026-10-01T08:00:00Z'),
      at('2026-10-02T08:00:00Z'),
      at('2026-04-01T08:00:00Z'),
      at('2026-04-02T08:00:00Z'),
      at('2026-12-01T08:00:00Z'),
    ]);
    expect(review.busiestMonth).toEqual({ month: 4, count: 2 });
  });
});

describe('yearBounds', () => {
  it('runs from Jan 1 to Jan 1, midnight in Sofia', () => {
    expect(yearBounds(2026)).toEqual({
      from: new Date('2025-12-31T22:00:00Z'),
      to: new Date('2026-12-31T22:00:00Z'),
    });
  });
});
