import { gymLocalDaysBetween } from '../attendance/attendance-timezone.util';
import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';

/** An active trainee, as the renewals overview needs it. */
export type RenewalTrainee = {
  id: string;
  name: string;
  nickname: string | null;
};

/** One of the trainee's subscriptions, with its plan's title. */
export type RenewalSubscription = {
  traineeId: string;
  type: PlanType;
  status: SubscriptionStatus;
  planTitle: string;
  startsAt: Date;
  endsAt: Date | null;
  remainingCredits: number | null;
  createdAt: Date;
};

/** The trainee's attendance: unpaid trainings and the latest training. */
export type RenewalAttendanceStats = {
  unpaidTrainings: number;
  lastTrainedAt: Date | null;
};

/**
 * One trainee on the renewals page. Which fields are set depends on the tab
 * and section:
 * - PUNCH active: `remainingCredits` (summed over the active subscriptions).
 * - PUNCH exhausted: `unpaidTrainings` is what they trained past the last one.
 * - TIME active: `endsAt` (the latest end of the active ones) and `daysLeft`.
 * - TIME exhausted: `endsAt` (when the last one ended) and `daysSinceEnd`.
 */
export type RenewalRow = {
  traineeId: string;
  name: string;
  nickname: string | null;
  /** Plan of the trainee's latest subscription of this type. */
  planTitle: string;
  /** Subscriptions of this type still running (0 when exhausted). */
  activeSubscriptions: number;
  remainingCredits: number | null;
  endsAt: Date | null;
  daysLeft: number | null;
  daysSinceEnd: number | null;
  unpaidTrainings: number;
  lastTrainedAt: Date | null;
};

export type RenewalSections = {
  /** Nothing left: most unpaid trainings (PUNCH) or longest ended (TIME) first. */
  exhausted: RenewalRow[];
  /** Still paid: fewest trainings or days left first. */
  active: RenewalRow[];
};

export type SubscriptionRenewals = {
  punch: RenewalSections;
  time: RenewalSections;
};

/**
 * Same rule as the trainee's "active subscriptions" (training insights):
 * PUNCH is ACTIVE with credits left; TIME is ACTIVE and ends after `now`
 * (one starting later counts too, since it is already paid).
 */
export function isRenewalActive(sub: RenewalSubscription, now: Date): boolean {
  if (sub.status !== SubscriptionStatus.ACTIVE) return false;
  if (sub.type === PlanType.PUNCH) return (sub.remainingCredits ?? 0) > 0;
  return sub.endsAt !== null && sub.endsAt.getTime() > now.getTime();
}

/** Latest first: by start, then by creation. */
function byLatest(a: RenewalSubscription, b: RenewalSubscription): number {
  return (
    b.startsAt.getTime() - a.startsAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

const byName = (a: RenewalRow, b: RenewalRow) =>
  a.name.localeCompare(b.name, 'bg') || a.traineeId.localeCompare(b.traineeId);

function latestEnd(subs: RenewalSubscription[]): Date | null {
  const ends = subs
    .map((s) => s.endsAt?.getTime())
    .filter((t): t is number => t !== undefined);
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/**
 * Builds the renewals overview: every active trainee with at least one
 * (non-cancelled) subscription, in exactly one tab.
 *
 * The tab is the type of the trainee's latest active subscription; with none
 * active, the type of their latest subscription. Days are Europe/Sofia
 * calendar days, so a subscription ending later today has 0 days left.
 */
export function buildSubscriptionRenewals(
  trainees: RenewalTrainee[],
  subscriptions: RenewalSubscription[],
  attendance: Map<string, RenewalAttendanceStats>,
  now: Date,
): SubscriptionRenewals {
  const subsByTrainee = new Map<string, RenewalSubscription[]>();
  for (const sub of subscriptions) {
    if (sub.status === SubscriptionStatus.CANCELLED) continue;
    const list = subsByTrainee.get(sub.traineeId) ?? [];
    list.push(sub);
    subsByTrainee.set(sub.traineeId, list);
  }

  const result: SubscriptionRenewals = {
    punch: { exhausted: [], active: [] },
    time: { exhausted: [], active: [] },
  };

  for (const trainee of trainees) {
    const subs = (subsByTrainee.get(trainee.id) ?? []).sort(byLatest);
    if (!subs.length) continue;

    const active = subs.filter((s) => isRenewalActive(s, now));
    const type = (active[0] ?? subs[0]).type;
    const ofType = subs.filter((s) => s.type === type);
    const activeOfType = active.filter((s) => s.type === type);
    const stats = attendance.get(trainee.id);

    const row: RenewalRow = {
      traineeId: trainee.id,
      name: trainee.name,
      nickname: trainee.nickname,
      planTitle: (activeOfType[0] ?? ofType[0]).planTitle,
      activeSubscriptions: activeOfType.length,
      remainingCredits: null,
      endsAt: null,
      daysLeft: null,
      daysSinceEnd: null,
      unpaidTrainings: stats?.unpaidTrainings ?? 0,
      lastTrainedAt: stats?.lastTrainedAt ?? null,
    };

    if (type === PlanType.PUNCH) {
      if (activeOfType.length) {
        row.remainingCredits = activeOfType.reduce(
          (sum, s) => sum + (s.remainingCredits ?? 0),
          0,
        );
        result.punch.active.push(row);
      } else {
        result.punch.exhausted.push(row);
      }
      continue;
    }

    if (activeOfType.length) {
      row.endsAt = latestEnd(activeOfType);
      row.daysLeft = gymLocalDaysBetween(now, row.endsAt!);
      result.time.active.push(row);
    } else {
      row.endsAt = latestEnd(ofType);
      row.daysSinceEnd = row.endsAt
        ? Math.max(0, gymLocalDaysBetween(row.endsAt, now))
        : null;
      result.time.exhausted.push(row);
    }
  }

  result.punch.exhausted.sort(
    (a, b) => b.unpaidTrainings - a.unpaidTrainings || byName(a, b),
  );
  result.punch.active.sort(
    (a, b) => a.remainingCredits! - b.remainingCredits! || byName(a, b),
  );
  result.time.exhausted.sort(
    (a, b) =>
      (b.daysSinceEnd ?? 0) - (a.daysSinceEnd ?? 0) ||
      b.unpaidTrainings - a.unpaidTrainings ||
      byName(a, b),
  );
  result.time.active.sort(
    (a, b) => a.endsAt!.getTime() - b.endsAt!.getTime() || byName(a, b),
  );

  return result;
}
