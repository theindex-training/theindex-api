import { PreviewSubscription } from '../attendance/attendance-preview';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import {
  BookedTrainee,
  buildTrainingBookings,
  SavedAttendance,
} from './training-bookings';

// Thursday 12 Nov 2026, noon in Sofia (UTC+2); the training is on Friday 13 Nov at 18:00.
const NOW = new Date('2026-11-12T10:00:00Z');
const STARTS_AT = new Date('2026-11-13T16:00:00Z');
const BOOKED_AT = new Date('2026-11-10T08:00:00Z');

let seq = 0;
function booked(name: string, extra: Partial<BookedTrainee> = {}) {
  seq += 1;
  return {
    traineeId: `t-${String(seq).padStart(3, '0')}`,
    name,
    nickname: null,
    isActive: true,
    bookedAt: BOOKED_AT,
    ...extra,
  };
}

function punch(
  t: BookedTrainee,
  remainingCredits: number,
): PreviewSubscription {
  seq += 1;
  return {
    id: `s-${seq}`,
    traineeId: t.traineeId,
    type: PlanType.PUNCH,
    planTitle: 'Punch 16',
    startsAt: new Date('2026-10-01T00:00:00Z'),
    endsAt: null,
    remainingCredits,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
}

function time(t: BookedTrainee, endsAt: string): PreviewSubscription {
  seq += 1;
  return {
    id: `s-${seq}`,
    traineeId: t.traineeId,
    type: PlanType.TIME,
    planTitle: 'Month',
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date(endsAt),
    remainingCredits: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}

const build = (
  people: BookedTrainee[],
  subs: PreviewSubscription[],
  saved: SavedAttendance[] = [],
) => buildTrainingBookings(people, subs, saved, STARTS_AT, NOW);

describe('buildTrainingBookings', () => {
  it('projects what a punch subscription has left after the training', () => {
    const ana = booked('Ana', { nickname: 'Ani' });

    expect(build([ana], [punch(ana, 10)])).toEqual([
      {
        traineeId: ana.traineeId,
        name: 'Ana',
        nickname: 'Ani',
        isActive: true,
        bookedAt: BOOKED_AT,
        attendanceSaved: false,
        paymentStatus: 'PAID',
        level: 'OK',
        subscription: {
          type: 'PUNCH',
          planTitle: 'Punch 16',
          remainingCredits: 9,
          endsAt: null,
          daysLeft: null,
        },
      },
    ]);
  });

  it('marks the last paid training and a low balance', () => {
    const last = booked('Last');
    const low = booked('Low');

    const rows = build([last, low], [punch(last, 1), punch(low, 3)]);

    expect(
      rows.map((r) => [r.name, r.level, r.subscription?.remainingCredits]),
    ).toEqual([
      ['Last', 'LAST', 0],
      ['Low', 'LOW', 2],
    ]);
  });

  it("projects a time subscription by the training's start: one ending before it leaves the training unpaid", () => {
    const covered = booked('Covered');
    const ended = booked('Ended');

    const rows = build(
      [covered, ended],
      // Ends on Friday 20 Nov; the other ends on Friday 13 Nov at 12:00, before the training.
      [
        time(covered, '2026-11-20T10:00:00Z'),
        time(ended, '2026-11-13T10:00:00Z'),
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Ended',
        paymentStatus: 'UNPAID',
        level: 'UNPAID',
        subscription: null,
      }),
      expect.objectContaining({
        name: 'Covered',
        paymentStatus: 'PAID',
        level: 'OK',
        subscription: {
          type: 'TIME',
          planTitle: 'Month',
          remainingCredits: null,
          endsAt: new Date('2026-11-20T10:00:00Z'),
          // Days from now (12 Nov), as on the Register attendance summary.
          daysLeft: 8,
        },
      }),
    ]);
  });

  it('shows what is left now, not one less, once attendance is saved for the training', () => {
    const ana = booked('Ana');
    const sub = punch(ana, 4); // already 5 - 1

    const [row] = build(
      [ana],
      [sub],
      [
        {
          traineeId: ana.traineeId,
          paymentStatus: AttendancePaymentStatus.PAID,
          subscription: {
            type: PlanType.PUNCH,
            planTitle: 'Punch 16',
            endsAt: null,
          },
        },
      ],
    );

    expect(row).toMatchObject({
      attendanceSaved: true,
      paymentStatus: 'PAID',
      level: 'OK',
      subscription: { type: 'PUNCH', remainingCredits: 4 },
    });
  });

  it('shows the last training as used once the saved attendance took it', () => {
    const ana = booked('Ana');

    // The subscription is EXHAUSTED now, so it is not among the active ones.
    const [row] = build(
      [ana],
      [],
      [
        {
          traineeId: ana.traineeId,
          paymentStatus: AttendancePaymentStatus.PAID,
          subscription: {
            type: PlanType.PUNCH,
            planTitle: 'Punch 16',
            endsAt: null,
          },
        },
      ],
    );

    expect(row).toMatchObject({
      attendanceSaved: true,
      level: 'LAST',
      subscription: { planTitle: 'Punch 16', remainingCredits: 0 },
    });
  });

  it('keeps a saved time attendance on its period, and unpaid attendance as unpaid', () => {
    const ana = booked('Ana');
    const boris = booked('Boris');

    const rows = build(
      [ana, boris],
      [punch(boris, 8)],
      [
        {
          traineeId: ana.traineeId,
          paymentStatus: AttendancePaymentStatus.PAID,
          subscription: {
            type: PlanType.TIME,
            planTitle: 'Month',
            endsAt: new Date('2026-12-12T10:00:00Z'),
          },
        },
        {
          traineeId: boris.traineeId,
          paymentStatus: AttendancePaymentStatus.UNPAID,
          subscription: null,
        },
      ],
    );

    expect(rows).toMatchObject([
      {
        name: 'Boris',
        attendanceSaved: true,
        paymentStatus: 'UNPAID',
        level: 'UNPAID',
        subscription: null,
      },
      {
        name: 'Ana',
        attendanceSaved: true,
        level: 'OK',
        subscription: { type: 'TIME', daysLeft: 30 },
      },
    ]);
  });

  it('lists unpaid, last and low first, then by name', () => {
    const zara = booked('Zara');
    const asen = booked('Asen');
    const unpaid = booked('Unpaid');
    const last = booked('Last');

    const rows = build(
      [zara, asen, unpaid, last],
      [punch(zara, 10), punch(asen, 10), punch(last, 1)],
    );

    expect(rows.map((r) => r.name)).toEqual(['Unpaid', 'Last', 'Asen', 'Zara']);
  });

  it('keeps inactive trainees, marked as such', () => {
    const gone = booked('Gone', { isActive: false });

    expect(build([gone], [])).toEqual([
      expect.objectContaining({
        name: 'Gone',
        isActive: false,
        level: 'UNPAID',
      }),
    ]);
  });
});
