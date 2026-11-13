import {
  AttendancePreviewLevel,
  buildAttendancePreview,
  LOW_CREDITS,
  LOW_DAYS,
  PreviewSubscription,
} from '../attendance/attendance-preview';
import { gymLocalDaysBetween } from '../attendance/attendance-timezone.util';
import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';

/** A trainee who booked the training. */
export type BookedTrainee = {
  traineeId: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
  bookedAt: Date;
};

/**
 * Attendance already saved for this training: the same trainee, gym and start time (what
 * Register attendance saves when it is opened from the training).
 */
export type SavedAttendance = {
  traineeId: string;
  paymentStatus: AttendancePaymentStatus;
  /** The subscription that paid; null when unpaid. */
  subscription: {
    type: PlanType;
    planTitle: string;
    endsAt: Date | null;
  } | null;
};

/**
 * One booked trainee on the staff's training page.
 *
 * Until attendance is saved for the training (`attendanceSaved: false`) the figures are a
 * **projection**: what would be left if the trainee comes and attendance is saved for this
 * training, by the rule of the attendance preview (`attendance-preview.ts`) with the training's
 * start as `trainedAt`. Once it is saved they are what is left now, and `paymentStatus` is the
 * saved one.
 */
export type TrainingBookingRow = {
  traineeId: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
  bookedAt: Date;
  attendanceSaved: boolean;
  paymentStatus: AttendancePaymentStatus;
  level: AttendancePreviewLevel;
  subscription: {
    type: PlanType;
    planTitle: string;
    /** PUNCH: trainings left over all active punch subscriptions. Null for TIME. */
    remainingCredits: number | null;
    /** TIME: the latest end of the paid period. Null for PUNCH. */
    endsAt: Date | null;
    /** TIME: Europe/Sofia calendar days from now to `endsAt`, never below 0. */
    daysLeft: number | null;
  } | null;
};

const LEVEL_ORDER: AttendancePreviewLevel[] = ['UNPAID', 'LAST', 'LOW', 'OK'];

function levelFor(left: number, low: number): AttendancePreviewLevel {
  if (left <= 0) return 'LAST';
  return left <= low ? 'LOW' : 'OK';
}

/** What is left now for a trainee whose attendance for the training is saved. */
function savedFigures(
  saved: SavedAttendance,
  subs: PreviewSubscription[],
  now: Date,
): Pick<TrainingBookingRow, 'level' | 'subscription'> {
  const paying = saved.subscription;
  if (saved.paymentStatus !== AttendancePaymentStatus.PAID || !paying) {
    return { level: 'UNPAID', subscription: null };
  }
  if (paying.type === PlanType.PUNCH) {
    const remainingCredits = subs
      .filter((s) => s.type === PlanType.PUNCH)
      .reduce((sum, s) => sum + Math.max(0, s.remainingCredits ?? 0), 0);
    return {
      level: levelFor(remainingCredits, LOW_CREDITS),
      subscription: {
        type: paying.type,
        planTitle: paying.planTitle,
        remainingCredits,
        endsAt: null,
        daysLeft: null,
      },
    };
  }
  const ends = [paying.endsAt, ...subs.map((s) => s.endsAt)]
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const endsAt = ends.length ? new Date(Math.max(...ends)) : null;
  const daysLeft = endsAt ? Math.max(0, gymLocalDaysBetween(now, endsAt)) : 0;
  return {
    level: levelFor(daysLeft, LOW_DAYS),
    subscription: {
      type: paying.type,
      planTitle: paying.planTitle,
      remainingCredits: null,
      endsAt,
      daysLeft,
    },
  };
}

/**
 * The trainees who booked a training, with what is left of their subscriptions (projected until
 * their attendance is saved, see `TrainingBookingRow`). Rows needing attention come first
 * (unpaid, last, low), then by name: the order of the attendance preview.
 *
 * `subscriptions` are the trainees' ACTIVE subscriptions; `attendance` is what is saved for
 * this training.
 */
export function buildTrainingBookings(
  booked: BookedTrainee[],
  subscriptions: PreviewSubscription[],
  attendance: SavedAttendance[],
  startsAt: Date,
  now: Date,
): TrainingBookingRow[] {
  const savedByTrainee = new Map<string, SavedAttendance>();
  for (const row of attendance) {
    // A trainee saved twice for the same training: the paid row tells more.
    const known = savedByTrainee.get(row.traineeId);
    if (!known || known.paymentStatus !== AttendancePaymentStatus.PAID) {
      savedByTrainee.set(row.traineeId, row);
    }
  }

  const projected = new Map(
    buildAttendancePreview(
      booked
        .filter((b) => !savedByTrainee.has(b.traineeId))
        .map((b) => ({ id: b.traineeId, name: b.name, nickname: b.nickname })),
      subscriptions,
      startsAt,
      now,
    ).map((row) => [row.traineeId, row]),
  );

  const rows = booked.map((b): TrainingBookingRow => {
    const person = {
      traineeId: b.traineeId,
      name: b.name,
      nickname: b.nickname,
      isActive: b.isActive,
      bookedAt: b.bookedAt,
    };
    const saved = savedByTrainee.get(b.traineeId);
    if (saved) {
      return {
        ...person,
        attendanceSaved: true,
        paymentStatus: saved.paymentStatus,
        ...savedFigures(
          saved,
          subscriptions.filter((s) => s.traineeId === b.traineeId),
          now,
        ),
      };
    }
    const preview = projected.get(b.traineeId)!;
    return {
      ...person,
      attendanceSaved: false,
      paymentStatus: preview.paymentStatus,
      level: preview.level,
      subscription: preview.subscription && {
        type: preview.subscription.type,
        planTitle: preview.subscription.planTitle,
        remainingCredits: preview.subscription.remainingCreditsAfter,
        endsAt: preview.subscription.endsAt,
        daysLeft: preview.subscription.daysLeft,
      },
    };
  });

  return rows.sort(
    (a, b) =>
      LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
      a.name.localeCompare(b.name, 'bg') ||
      a.traineeId.localeCompare(b.traineeId),
  );
}
