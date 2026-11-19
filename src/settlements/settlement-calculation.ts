import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import { AllocationReason } from './enums/allocation-reason.enum';
import { splitCents } from './settlement-allocation.util';

/**
 * What a settlement report pays, as pure functions (the service only loads the rows).
 *
 * Every training is paid to its trainer exactly once, in the first report whose period end has
 * passed once the training's value is known (its "payable" moment):
 * - paid by a PUNCH pass: the later of the training and the pass purchase. A training paid when
 *   it was recorded is payable on its day; an unpaid one that a pass bought later covers is
 *   payable when the pass was bought, so it is paid by the report of that period.
 * - paid by a TIME pass: when the pass ends, because only then is the number of trainings it is
 *   split over known.
 * - unpaid (or paid without a subscription): not payable; it waits until a pass covers it.
 *
 * A report pays every training not paid by a finalized report yet, dated before its period end,
 * that was payable by then: its own period's trainings and those of earlier periods that became
 * payable since. Its period's trainings that aren't payable by its end wait for a later report.
 */

export interface CandidateAttendance {
  id: string;
  trainerId: string;
  traineeId: string;
  locationId: string | null;
  trainedAt: Date;
  paymentStatus: AttendancePaymentStatus;
  subscriptionId: string | null;
}

export interface PayingSubscription {
  id: string;
  type: PlanType;
  paidCents: number;
  initialCredits: number | null;
  endsAt: Date | null;
  /** When it was bought (and reconciled the trainee's unpaid trainings). */
  createdAt: Date;
}

export interface SettlementItem {
  attendance: CandidateAttendance;
  subscriptionId: string;
  subscriptionType: PlanType;
  valueCents: number;
  reason: AllocationReason;
  /** Dated before the report's period: carried over from an earlier period. */
  fromEarlierPeriod: boolean;
}

/**
 * Why a training of the period isn't paid by its report:
 * - `UNPAID`: no subscription pays it yet;
 * - `TIME_PASS_NOT_ENDED`: its TIME pass ends after the period (`availableFrom` is the end);
 * - `NEXT_REPORT`: its value became known after the period (a pass bought later), or it was
 *   recorded after the report was finalized; a later report pays it.
 */
export type WaitingReason = 'UNPAID' | 'TIME_PASS_NOT_ENDED' | 'NEXT_REPORT';

export interface WaitingItem {
  attendance: CandidateAttendance;
  reason: WaitingReason;
  subscriptionType: PlanType | null;
  /** When it becomes (or became) payable, when known. */
  availableFrom: Date | null;
}

export interface CalculationInput {
  /** The report's period as instants, `[from, to)`. */
  bounds: { from: Date; to: Date };
  /** Trainings not paid by a finalized report, dated before `bounds.to`. */
  attendances: CandidateAttendance[];
  subscriptions: Map<string, PayingSubscription>;
  /**
   * Per subscription, the ids of ALL its PAID trainings (paid out or not), by `trainedAt` then
   * id: a training's value depends on its place in that order.
   */
  paidOrder: Map<string, string[]>;
  /**
   * True for a draft (it pays what is payable). False for a finalized report, whose payments are
   * stored: only its period's trainings still waiting are worked out.
   */
  includePayable: boolean;
  /**
   * The end (`to`) of the draft just before this one, when there is one. What that draft (or an
   * older one) pays isn't repeated here: each training belongs to the earliest open report that
   * can pay it.
   */
  earlierDraftTo?: Date | null;
}

export interface CalculationResult {
  items: SettlementItem[];
  waiting: WaitingItem[];
}

function payableAt(
  attendance: CandidateAttendance,
  subscription: PayingSubscription | undefined,
): Date | null {
  if (
    attendance.paymentStatus !== AttendancePaymentStatus.PAID ||
    !subscription
  ) {
    return null;
  }
  if (subscription.type === PlanType.TIME) {
    return subscription.endsAt;
  }
  return attendance.trainedAt.getTime() >= subscription.createdAt.getTime()
    ? attendance.trainedAt
    : subscription.createdAt;
}

/** Whether something payable at `at` is payable by the end of the period ending at `to`. */
function payableBy(
  at: Date,
  subscription: PayingSubscription,
  to: Date,
): boolean {
  // A TIME pass ending exactly at midnight covered the day before, so it ended in that period.
  return subscription.type === PlanType.TIME
    ? at.getTime() <= to.getTime()
    : at.getTime() < to.getTime();
}

/** A PAID training's value: its share of its subscription's price. */
function valueOf(
  attendance: CandidateAttendance,
  subscription: PayingSubscription,
  paidOrder: Map<string, string[]>,
  splits: Map<string, { index: Map<string, number>; split: number[] }>,
): number {
  let entry = splits.get(subscription.id);
  if (!entry) {
    const order = paidOrder.get(subscription.id) ?? [];
    // PUNCH: the price over the credits, in training order (later trainings than credits, which
    // consumption never produces, get nothing). TIME: the price over all its trainings.
    const parts =
      subscription.type === PlanType.PUNCH
        ? (subscription.initialCredits ?? 0)
        : order.length;
    entry = {
      index: new Map(order.map((id, i) => [id, i])),
      split: splitCents(subscription.paidCents, parts),
    };
    splits.set(subscription.id, entry);
  }
  const i = entry.index.get(attendance.id);
  return i === undefined ? 0 : (entry.split[i] ?? 0);
}

export function calculateSettlement(
  input: CalculationInput,
): CalculationResult {
  const { bounds, subscriptions, paidOrder, includePayable } = input;
  const earlierDraftTo = input.earlierDraftTo ?? null;
  const splits = new Map<
    string,
    { index: Map<string, number>; split: number[] }
  >();
  const items: SettlementItem[] = [];
  const waiting: WaitingItem[] = [];

  const ordered = [...input.attendances]
    .filter((a) => a.trainedAt.getTime() < bounds.to.getTime())
    .sort(
      (a, b) =>
        a.trainedAt.getTime() - b.trainedAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  for (const attendance of ordered) {
    const subscription = attendance.subscriptionId
      ? subscriptions.get(attendance.subscriptionId)
      : undefined;
    const at = payableAt(attendance, subscription);
    const inPeriod = attendance.trainedAt.getTime() >= bounds.from.getTime();
    const payable =
      at !== null && !!subscription && payableBy(at, subscription, bounds.to);

    if (payable && includePayable) {
      if (
        earlierDraftTo &&
        attendance.trainedAt.getTime() < earlierDraftTo.getTime() &&
        payableBy(at, subscription, earlierDraftTo)
      ) {
        // An earlier draft pays it.
        continue;
      }
      const type = subscription.type;
      items.push({
        attendance,
        subscriptionId: subscription.id,
        subscriptionType: type,
        valueCents: valueOf(attendance, subscription, paidOrder, splits),
        reason:
          type === PlanType.TIME
            ? AllocationReason.TIME_PRORATA
            : AllocationReason.PUNCH_CREDIT,
        fromEarlierPeriod: !inPeriod,
      });
      continue;
    }

    // Earlier periods' trainings that wait are listed by their own report.
    if (!inPeriod) continue;

    if (at === null || !subscription) {
      waiting.push({
        attendance,
        reason: 'UNPAID',
        subscriptionType: null,
        availableFrom: null,
      });
    } else if (subscription.type === PlanType.TIME && !payable) {
      waiting.push({
        attendance,
        reason: 'TIME_PASS_NOT_ENDED',
        subscriptionType: PlanType.TIME,
        availableFrom: at,
      });
    } else {
      waiting.push({
        attendance,
        reason: 'NEXT_REPORT',
        subscriptionType: subscription.type,
        availableFrom: at,
      });
    }
  }

  return { items, waiting };
}

export interface TrainerTotals {
  trainerId: string;
  /** What the report pays the trainer. */
  amountCents: number;
  /** Trainings it pays them for. */
  attendanceCount: number;
  punchCents: number;
  timeCents: number;
  /** The part of the above carried over from earlier periods. */
  earlierPeriodsCents: number;
  earlierPeriodsCount: number;
  /** Their trainings of the period that wait for a later report. */
  waitingCount: number;
}

export interface PaidItemSummary {
  trainerId: string;
  valueCents: number;
  subscriptionType: PlanType | null;
  fromEarlierPeriod: boolean;
}

/**
 * One row per trainer with anything paid or waiting, the biggest amount first (then by trainer
 * id, so the order is stable).
 */
export function trainerTotals(
  paid: PaidItemSummary[],
  waiting: { trainerId: string }[],
): TrainerTotals[] {
  const byTrainer = new Map<string, TrainerTotals>();
  const totalsOf = (trainerId: string) => {
    let totals = byTrainer.get(trainerId);
    if (!totals) {
      totals = {
        trainerId,
        amountCents: 0,
        attendanceCount: 0,
        punchCents: 0,
        timeCents: 0,
        earlierPeriodsCents: 0,
        earlierPeriodsCount: 0,
        waitingCount: 0,
      };
      byTrainer.set(trainerId, totals);
    }
    return totals;
  };

  for (const item of paid) {
    const totals = totalsOf(item.trainerId);
    totals.amountCents += item.valueCents;
    totals.attendanceCount += 1;
    if (item.subscriptionType === PlanType.PUNCH)
      totals.punchCents += item.valueCents;
    if (item.subscriptionType === PlanType.TIME)
      totals.timeCents += item.valueCents;
    if (item.fromEarlierPeriod) {
      totals.earlierPeriodsCents += item.valueCents;
      totals.earlierPeriodsCount += 1;
    }
  }
  for (const item of waiting) totalsOf(item.trainerId).waitingCount += 1;

  return [...byTrainer.values()].sort(
    (a, b) =>
      b.amountCents - a.amountCents ||
      (a.trainerId < b.trainerId ? -1 : a.trainerId > b.trainerId ? 1 : 0),
  );
}
