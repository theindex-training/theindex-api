import { AttendancePaymentStatus } from '../common/enums/attendance-payment-status.enum';
import { PlanType } from '../common/enums/plan-type.enum';
import {
  calculateSettlement,
  CandidateAttendance,
  CalculationInput,
  PayingSubscription,
  trainerTotals,
} from './settlement-calculation';
import { periodBounds } from './settlement-periods';

const NOV_1 = periodBounds({
  periodStart: '2026-11-01',
  periodEnd: '2026-11-15',
});
const NOV_2 = periodBounds({
  periodStart: '2026-11-16',
  periodEnd: '2026-11-30',
});
const { PAID, UNPAID } = AttendancePaymentStatus;

function training(
  id: string,
  trainedAt: string,
  subscriptionId: string | null,
  trainerId = 'coach-a',
): CandidateAttendance {
  return {
    id,
    trainerId,
    traineeId: 'ana',
    locationId: 'gym',
    trainedAt: new Date(trainedAt),
    paymentStatus: subscriptionId ? PAID : UNPAID,
    subscriptionId,
  };
}

function punch(
  id: string,
  boughtAt: string,
  paidCents: number,
  credits: number,
): PayingSubscription {
  return {
    id,
    type: PlanType.PUNCH,
    paidCents,
    initialCredits: credits,
    endsAt: null,
    createdAt: new Date(boughtAt),
  };
}

function time(id: string, endsAt: string, paidCents: number) {
  return {
    id,
    type: PlanType.TIME,
    paidCents,
    initialCredits: null,
    endsAt: new Date(endsAt),
    createdAt: new Date('2026-10-01T00:00:00Z'),
  } satisfies PayingSubscription;
}

function run(
  bounds: { from: Date; to: Date },
  attendances: CandidateAttendance[],
  subs: PayingSubscription[],
  includePayable = true,
) {
  const paidOrder = new Map<string, string[]>();
  for (const a of [...attendances].sort(
    (x, y) => x.trainedAt.getTime() - y.trainedAt.getTime(),
  )) {
    if (a.paymentStatus !== PAID || !a.subscriptionId) continue;
    paidOrder.set(a.subscriptionId, [
      ...(paidOrder.get(a.subscriptionId) ?? []),
      a.id,
    ]);
  }
  const input: CalculationInput = {
    bounds,
    attendances,
    subscriptions: new Map(subs.map((s) => [s.id, s])),
    paidOrder,
    includePayable,
  };
  return calculateSettlement(input);
}

describe('calculateSettlement', () => {
  it("pays a PUNCH pass's trainings their share, the extra cent to the earliest", () => {
    const sub = punch('p', '2026-10-20T10:00:00Z', 10000, 3);
    const { items, waiting } = run(
      NOV_1,
      [
        training('b', '2026-11-05T10:00:00Z', 'p'),
        training('a', '2026-11-03T10:00:00Z', 'p'),
      ],
      [sub],
    );

    expect(items.map((i) => [i.attendance.id, i.valueCents])).toEqual([
      ['a', 3334],
      ['b', 3333],
    ]);
    expect(items[0]).toMatchObject({
      subscriptionType: PlanType.PUNCH,
      reason: 'PUNCH_CREDIT',
      fromEarlierPeriod: false,
    });
    expect(waiting).toEqual([]);
  });

  it('lists unpaid trainings of the period as waiting, and not those of earlier periods', () => {
    const { items, waiting } = run(
      NOV_2,
      [
        training('old', '2026-11-10T10:00:00Z', null),
        training('new', '2026-11-20T10:00:00Z', null),
      ],
      [],
    );

    expect(items).toEqual([]);
    expect(
      waiting.map((w) => [
        w.attendance.id,
        w.reason,
        w.subscriptionType,
        w.availableFrom,
      ]),
    ).toEqual([['new', 'UNPAID', null, null]]);
  });

  it('pays an unpaid training covered by a pass bought later in the report of the purchase', () => {
    const sub = punch('p', '2026-11-18T09:00:00Z', 2000, 2);
    const attendances = [training('a', '2026-11-10T10:00:00Z', 'p')];

    const first = run(NOV_1, attendances, [sub]);
    expect(first.items).toEqual([]);
    expect(first.waiting).toEqual([
      expect.objectContaining({
        reason: 'NEXT_REPORT',
        subscriptionType: PlanType.PUNCH,
        availableFrom: new Date('2026-11-18T09:00:00Z'),
      }),
    ]);

    const second = run(NOV_2, attendances, [sub]);
    expect(second.items).toEqual([
      expect.objectContaining({ valueCents: 1000, fromEarlierPeriod: true }),
    ]);
    expect(second.waiting).toEqual([]);
  });

  it('waits for a TIME pass to end, then splits it over all its trainings', () => {
    // Ends at 00:00 Sofia on Nov 26: in the second half.
    const sub = time('t', '2026-11-25T22:00:00Z', 9001);
    const attendances = [
      training('a', '2026-11-05T10:00:00Z', 't'),
      training('b', '2026-11-12T10:00:00Z', 't', 'coach-b'),
      training('c', '2026-11-20T10:00:00Z', 't'),
    ];

    const first = run(NOV_1, attendances, [sub]);
    expect(first.items).toEqual([]);
    expect(
      first.waiting.map((w) => [w.attendance.id, w.reason, w.availableFrom]),
    ).toEqual([
      ['a', 'TIME_PASS_NOT_ENDED', sub.endsAt],
      ['b', 'TIME_PASS_NOT_ENDED', sub.endsAt],
    ]);

    const second = run(NOV_2, attendances, [sub]);
    expect(
      second.items.map((i) => [
        i.attendance.id,
        i.valueCents,
        i.fromEarlierPeriod,
        i.reason,
      ]),
    ).toEqual([
      ['a', 3001, true, 'TIME_PRORATA'],
      ['b', 3000, true, 'TIME_PRORATA'],
      ['c', 3000, false, 'TIME_PRORATA'],
    ]);
  });

  it('the price per training of a TIME pass depends on how many trainings it had: 10 -> $10, 20 -> $5', () => {
    const FEB_1 = periodBounds({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-15',
    });
    const sub = time('t', '2026-02-11T08:00:00Z', 10000); // $100, bought Jan 12, ends Feb 11
    const trainings = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        training(
          `a${String(i).padStart(2, '0')}`,
          new Date(Date.UTC(2026, 0, 13, 16) + i * 36e5 * 24).toISOString(),
          't',
        ),
      );

    for (const [count, each] of [
      [10, 1000],
      [20, 500],
    ]) {
      const { items } = run(FEB_1, trainings(count), [sub]);
      expect(items).toHaveLength(count);
      expect(new Set(items.map((i) => i.valueCents))).toEqual(new Set([each]));
    }
  });

  it('a TIME pass ending exactly at the period end is paid by it; 1 ms later it waits', () => {
    const attendances = [training('a', '2026-11-05T10:00:00Z', 't')];

    expect(
      run(NOV_1, attendances, [time('t', NOV_1.to.toISOString(), 100)]).items,
    ).toHaveLength(1);
    expect(
      run(NOV_1, attendances, [
        time('t', new Date(NOV_1.to.getTime() + 1).toISOString(), 100),
      ]).waiting[0].reason,
    ).toBe('TIME_PASS_NOT_ENDED');
  });

  it('a PUNCH pass bought exactly at the period end belongs to the next period', () => {
    const attendances = [training('a', '2026-11-05T10:00:00Z', 'p')];
    const sub = punch('p', NOV_1.to.toISOString(), 100, 1);

    expect(run(NOV_1, attendances, [sub]).waiting[0].reason).toBe(
      'NEXT_REPORT',
    );
  });

  it('leaves to an earlier draft what it pays: a training belongs to the earliest open report', () => {
    const early = punch('early', '2026-10-20T10:00:00Z', 100, 1);
    const late = punch('late', '2026-11-18T10:00:00Z', 100, 1);
    const result = calculateSettlement({
      bounds: NOV_2,
      attendances: [
        training('a', '2026-11-05T10:00:00Z', 'early'),
        training('b', '2026-11-06T10:00:00Z', 'late'),
      ],
      subscriptions: new Map([
        ['early', early],
        ['late', late],
      ]),
      paidOrder: new Map([
        ['early', ['a']],
        ['late', ['b']],
      ]),
      includePayable: true,
      earlierDraftTo: NOV_1.to,
    });

    expect(result.items.map((i) => i.attendance.id)).toEqual(['b']);
    expect(result.waiting).toEqual([]);
  });

  it('ignores trainings dated after the period', () => {
    const sub = punch('p', '2026-10-20T10:00:00Z', 100, 1);
    const result = run(
      NOV_1,
      [training('later', '2026-11-16T10:00:00Z', 'p')],
      [sub],
    );
    expect(result).toEqual({ items: [], waiting: [] });
  });

  it('for a finalized report (nothing to pay) lists its period still waiting, payable ones as NEXT_REPORT', () => {
    const sub = punch('p', '2026-10-20T10:00:00Z', 100, 1);
    const { items, waiting } = run(
      NOV_1,
      [
        training('a', '2026-11-05T10:00:00Z', 'p'),
        training('b', '2026-11-06T10:00:00Z', null),
      ],
      [sub],
      false,
    );

    expect(items).toEqual([]);
    expect(waiting.map((w) => [w.attendance.id, w.reason])).toEqual([
      ['a', 'NEXT_REPORT'],
      ['b', 'UNPAID'],
    ]);
  });

  it('a PAID training without its subscription waits as unpaid', () => {
    const { waiting } = run(
      NOV_1,
      [training('a', '2026-11-05T10:00:00Z', 'gone')],
      [],
    );
    expect(waiting[0].reason).toBe('UNPAID');
  });
});

describe('trainerTotals', () => {
  it('sums per trainer, keeps the carried-over part apart and counts waiting trainings', () => {
    const totals = trainerTotals(
      [
        {
          trainerId: 'b',
          valueCents: 1000,
          subscriptionType: PlanType.PUNCH,
          fromEarlierPeriod: false,
        },
        {
          trainerId: 'a',
          valueCents: 3000,
          subscriptionType: PlanType.TIME,
          fromEarlierPeriod: true,
        },
        {
          trainerId: 'a',
          valueCents: 500,
          subscriptionType: PlanType.PUNCH,
          fromEarlierPeriod: false,
        },
      ],
      [{ trainerId: 'a' }, { trainerId: 'c' }, { trainerId: 'c' }],
    );

    expect(totals).toEqual([
      {
        trainerId: 'a',
        amountCents: 3500,
        attendanceCount: 2,
        punchCents: 500,
        timeCents: 3000,
        earlierPeriodsCents: 3000,
        earlierPeriodsCount: 1,
        waitingCount: 1,
      },
      {
        trainerId: 'b',
        amountCents: 1000,
        attendanceCount: 1,
        punchCents: 1000,
        timeCents: 0,
        earlierPeriodsCents: 0,
        earlierPeriodsCount: 0,
        waitingCount: 0,
      },
      {
        trainerId: 'c',
        amountCents: 0,
        attendanceCount: 0,
        punchCents: 0,
        timeCents: 0,
        earlierPeriodsCents: 0,
        earlierPeriodsCount: 0,
        waitingCount: 2,
      },
    ]);
  });
});
