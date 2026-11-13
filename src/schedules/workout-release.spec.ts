import { isWorkoutReleased, workoutReleasesAt } from './workout-release';

describe('workout release (trainees)', () => {
  it("a day's workouts come out at 20:00 gym-local of the day before, in winter and in summer", () => {
    // Sofia is UTC+2 in November and UTC+3 in July.
    expect(workoutReleasesAt('2026-11-14').toISOString()).toBe(
      '2026-11-13T18:00:00.000Z',
    );
    expect(workoutReleasesAt('2026-07-01').toISOString()).toBe(
      '2026-06-30T17:00:00.000Z',
    );
  });

  it('crosses month and year ends, and the DST changes', () => {
    expect(workoutReleasesAt('2026-12-01').toISOString()).toBe(
      '2026-11-30T18:00:00.000Z',
    );
    expect(workoutReleasesAt('2027-01-01').toISOString()).toBe(
      '2026-12-31T18:00:00.000Z',
    );
    // Clocks go back on Sun 25 Oct 2026 (03:00 EEST -> 02:00 EET), forward on Sun 29 Mar 2026.
    expect(workoutReleasesAt('2026-10-26').toISOString()).toBe(
      '2026-10-25T18:00:00.000Z',
    );
    expect(workoutReleasesAt('2026-10-25').toISOString()).toBe(
      '2026-10-24T17:00:00.000Z',
    );
    expect(workoutReleasesAt('2026-03-30').toISOString()).toBe(
      '2026-03-29T17:00:00.000Z',
    );
  });

  it('at 21:00 on Fri 13 Nov: the past, today and tomorrow are out; the day after is not', () => {
    const fridayNine = new Date('2026-11-13T19:00:00Z'); // 21:00 in Sofia
    expect(isWorkoutReleased('2026-11-01', fridayNine)).toBe(true);
    expect(isWorkoutReleased('2026-11-12', fridayNine)).toBe(true);
    expect(isWorkoutReleased('2026-11-13', fridayNine)).toBe(true);
    expect(isWorkoutReleased('2026-11-14', fridayNine)).toBe(true);
    expect(isWorkoutReleased('2026-11-15', fridayNine)).toBe(false);
  });

  it('tomorrow comes out exactly at 20:00, not a second before', () => {
    expect(
      isWorkoutReleased('2026-11-14', new Date('2026-11-13T17:59:59.999Z')),
    ).toBe(false);
    expect(
      isWorkoutReleased('2026-11-14', new Date('2026-11-13T18:00:00Z')),
    ).toBe(true);
  });

  it('at 09:00 on Fri 13 Nov, today is out and tomorrow is not', () => {
    const fridayMorning = new Date('2026-11-13T07:00:00Z');
    expect(isWorkoutReleased('2026-11-13', fridayMorning)).toBe(true);
    expect(isWorkoutReleased('2026-11-14', fridayMorning)).toBe(false);
  });

  it('just after midnight gym-local (still the day before in UTC), today is out', () => {
    // 00:30 Sofia on Sat 14 Nov is 22:30Z on Fri 13 Nov.
    const justAfterMidnight = new Date('2026-11-13T22:30:00Z');
    expect(isWorkoutReleased('2026-11-14', justAfterMidnight)).toBe(true);
    expect(isWorkoutReleased('2026-11-15', justAfterMidnight)).toBe(false);
  });
});
