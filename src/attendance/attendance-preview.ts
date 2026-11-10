import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { gymLocalDaysBetween } from './attendance-timezone.util';

/** A trainee picked for the training. */
export type PreviewTrainee = {
  id: string;
  name: string;
  nickname: string | null;
};

/** One of the trainee's ACTIVE subscriptions, with its plan's title. */
export type PreviewSubscription = {
  id: string;
  traineeId: string;
  type: PlanType;
  planTitle: string;
  startsAt: Date;
  endsAt: Date | null;
  remainingCredits: number | null;
  createdAt: Date;
};

/**
 * How close the trainee is to the end of what they paid for, once this
 * training is saved:
 * - `UNPAID`: no subscription covers the training.
 * - `LAST`: PUNCH with no trainings left after this one; TIME ending today.
 * - `LOW`: PUNCH with up to `LOW_CREDITS` left; TIME with up to `LOW_DAYS` days.
 * - `OK`: anything more.
 */
export type AttendancePreviewLevel = 'UNPAID' | 'LAST' | 'LOW' | 'OK';

export const LOW_CREDITS = 2;
export const LOW_DAYS = 7;

export type AttendancePreviewRow = {
  traineeId: string;
  name: string;
  nickname: string | null;
  /** What the training would be saved as. */
  paymentStatus: AttendancePaymentStatus;
  level: AttendancePreviewLevel;
  /** The subscription that would pay for the training; null when UNPAID. */
  subscription: {
    id: string;
    type: PlanType;
    planTitle: string;
    /**
     * PUNCH: trainings left after this one, over all the trainee's active
     * punch subscriptions. Null for TIME.
     */
    remainingCreditsAfter: number | null;
    /** TIME: the latest end of the trainee's active time subscriptions. */
    endsAt: Date | null;
    /** TIME: Europe/Sofia calendar days from `now` to `endsAt`, never below 0. */
    daysLeft: number | null;
  } | null;
};

const LEVEL_ORDER: AttendancePreviewLevel[] = ['UNPAID', 'LAST', 'LOW', 'OK'];

const hasCredits = (sub: PreviewSubscription) =>
  sub.type === PlanType.PUNCH && (sub.remainingCredits ?? 0) > 0;

/**
 * The rule of `SubscriptionResolverService.resolveForAttendance`, for ACTIVE
 * subscriptions: PUNCH with credits left (whatever its start), or TIME with
 * `startsAt <= trainedAt < endsAt`.
 */
function isEligible(sub: PreviewSubscription, trainedAt: Date): boolean {
  if (sub.type === PlanType.PUNCH) return hasCredits(sub);
  return (
    sub.endsAt !== null &&
    sub.startsAt.getTime() <= trainedAt.getTime() &&
    trainedAt.getTime() < sub.endsAt.getTime()
  );
}

/** The resolver's order: earliest start first, then earliest created. */
const byEarliest = (a: PreviewSubscription, b: PreviewSubscription) =>
  a.startsAt.getTime() - b.startsAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime();

function levelFor(left: number, low: number): AttendancePreviewLevel {
  if (left <= 0) return 'LAST';
  return left <= low ? 'LOW' : 'OK';
}

/**
 * What saving a training for these trainees at `trainedAt` would do, without
 * saving anything: which subscription pays for each trainee and what is left
 * of it afterwards. Rows needing attention come first (unpaid, last, low),
 * then by name.
 *
 * `subscriptions` are the trainees' ACTIVE subscriptions. A trainee is in a
 * batch once, so each row is worked out on its own.
 */
export function buildAttendancePreview(
  trainees: PreviewTrainee[],
  subscriptions: PreviewSubscription[],
  trainedAt: Date,
  now: Date,
): AttendancePreviewRow[] {
  const subsByTrainee = new Map<string, PreviewSubscription[]>();
  for (const sub of subscriptions) {
    const list = subsByTrainee.get(sub.traineeId) ?? [];
    list.push(sub);
    subsByTrainee.set(sub.traineeId, list);
  }

  const rows = trainees.map((trainee): AttendancePreviewRow => {
    const subs = (subsByTrainee.get(trainee.id) ?? []).sort(byEarliest);
    const paying = subs.find((sub) => isEligible(sub, trainedAt));
    const person = {
      traineeId: trainee.id,
      name: trainee.name,
      nickname: trainee.nickname,
    };

    if (!paying) {
      return {
        ...person,
        paymentStatus: AttendancePaymentStatus.UNPAID,
        level: 'UNPAID',
        subscription: null,
      };
    }

    if (paying.type === PlanType.PUNCH) {
      const remainingCreditsAfter =
        subs
          .filter(hasCredits)
          .reduce((sum, sub) => sum + (sub.remainingCredits ?? 0), 0) - 1;

      return {
        ...person,
        paymentStatus: AttendancePaymentStatus.PAID,
        level: levelFor(remainingCreditsAfter, LOW_CREDITS),
        subscription: {
          id: paying.id,
          type: paying.type,
          planTitle: paying.planTitle,
          remainingCreditsAfter,
          endsAt: null,
          daysLeft: null,
        },
      };
    }

    // A later time subscription that is already paid moves the end.
    const endsAt = new Date(
      Math.max(
        ...subs
          .filter((sub) => sub.type === PlanType.TIME && sub.endsAt !== null)
          .map((sub) => sub.endsAt!.getTime()),
      ),
    );
    const daysLeft = Math.max(0, gymLocalDaysBetween(now, endsAt));

    return {
      ...person,
      paymentStatus: AttendancePaymentStatus.PAID,
      level: levelFor(daysLeft, LOW_DAYS),
      subscription: {
        id: paying.id,
        type: paying.type,
        planTitle: paying.planTitle,
        remainingCreditsAfter: null,
        endsAt,
        daysLeft,
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
