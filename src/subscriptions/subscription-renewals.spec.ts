import { PlanType } from '../common/enums/plan-type.enum';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import {
  buildSubscriptionRenewals,
  RenewalAttendanceStats,
  RenewalSubscription,
  RenewalTrainee,
} from './subscription-renewals';

const { ACTIVE, EXHAUSTED, CANCELLED } = SubscriptionStatus;
// 12:00 in Sofia (UTC+2) on 2026-11-09.
const NOW = new Date('2026-11-09T10:00:00.000Z');

let seq = 0;
function trainee(name: string, nickname: string | null = null): RenewalTrainee {
  seq += 1;
  return { id: `t-${String(seq).padStart(3, '0')}`, name, nickname };
}

function punch(
  t: RenewalTrainee,
  remainingCredits: number,
  startsAt: string,
  extra: Partial<RenewalSubscription> = {},
): RenewalSubscription {
  return {
    traineeId: t.id,
    type: PlanType.PUNCH,
    status: remainingCredits > 0 ? ACTIVE : EXHAUSTED,
    planTitle: 'Punch 16',
    startsAt: new Date(startsAt),
    endsAt: null,
    remainingCredits,
    createdAt: new Date(startsAt),
    ...extra,
  };
}

function time(
  t: RenewalTrainee,
  startsAt: string,
  endsAt: string,
  extra: Partial<RenewalSubscription> = {},
): RenewalSubscription {
  return {
    traineeId: t.id,
    type: PlanType.TIME,
    // The cron marks ended TIME subscriptions only at 02:00 UTC, so an
    // ended one can still be ACTIVE; the overview must not rely on it.
    status: ACTIVE,
    planTitle: 'Month',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    remainingCredits: null,
    createdAt: new Date(startsAt),
    ...extra,
  };
}

function stats(
  entries: [RenewalTrainee, number, string | null][],
): Map<string, RenewalAttendanceStats> {
  return new Map(
    entries.map(([t, unpaidTrainings, last]) => [
      t.id,
      { unpaidTrainings, lastTrainedAt: last ? new Date(last) : null },
    ]),
  );
}

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('buildSubscriptionRenewals', () => {
  describe('PUNCH tab', () => {
    it('lists exhausted trainees by most unpaid trainings, then by name (Bulgarian order)', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const cvet = trainee('Цвети');
      const dora = trainee('Dora');
      const subs = [
        punch(ana, 0, '2026-09-01T10:00:00Z'),
        punch(bob, 0, '2026-09-01T10:00:00Z'),
        punch(cvet, 0, '2026-09-01T10:00:00Z'),
        punch(dora, 0, '2026-09-01T10:00:00Z'),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob, cvet, dora],
        subs,
        stats([
          [ana, 2, '2026-11-08T16:00:00Z'],
          [bob, 5, '2026-11-07T16:00:00Z'],
          [cvet, 2, '2026-11-06T16:00:00Z'],
        ]),
        NOW,
      );

      // Ties go by name in Bulgarian order: Cyrillic names before Latin ones.
      expect(names(result.punch.exhausted)).toEqual([
        'Bob',
        'Цвети',
        'Ana',
        'Dora',
      ]);
      expect(result.punch.exhausted[0]).toMatchObject({
        traineeId: bob.id,
        planTitle: 'Punch 16',
        activeSubscriptions: 0,
        remainingCredits: null,
        unpaidTrainings: 5,
        lastTrainedAt: new Date('2026-11-07T16:00:00Z'),
      });
      // No attendance at all: 0 unpaid, no last training.
      expect(result.punch.exhausted[3]).toMatchObject({
        unpaidTrainings: 0,
        lastTrainedAt: null,
      });
      expect(result.punch.active).toEqual([]);
      expect(result.time).toEqual({ exhausted: [], active: [] });
    });

    it('lists active trainees by fewest remaining trainings, summed over every active subscription', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const cvet = trainee('Cvet');
      const subs = [
        // Bought two cards of 16 at once: 32 left.
        punch(ana, 16, '2026-11-01T10:00:00Z', { planTitle: 'Punch A' }),
        punch(ana, 16, '2026-11-01T10:00:00Z', {
          planTitle: 'Punch B',
          createdAt: new Date('2026-11-01T10:00:01Z'),
        }),
        punch(bob, 1, '2026-10-01T10:00:00Z'),
        punch(cvet, 0, '2026-08-01T10:00:00Z'),
        punch(cvet, 3, '2026-10-01T10:00:00Z'),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob, cvet],
        subs,
        new Map(),
        NOW,
      );

      expect(
        result.punch.active.map((r) => [
          r.name,
          r.remainingCredits,
          r.activeSubscriptions,
        ]),
      ).toEqual([
        ['Bob', 1, 1],
        ['Cvet', 3, 1],
        ['Ana', 32, 2],
      ]);
      // The latest active subscription names the plan (same start: newest created).
      expect(result.punch.active[2].planTitle).toBe('Punch B');
      expect(result.punch.exhausted).toEqual([]);
    });

    it('an ACTIVE punch subscription with no credits left is exhausted', () => {
      const ana = trainee('Ana');
      const result = buildSubscriptionRenewals(
        [ana],
        [punch(ana, 0, '2026-10-01T10:00:00Z', { status: ACTIVE })],
        new Map(),
        NOW,
      );

      expect(names(result.punch.exhausted)).toEqual(['Ana']);
    });
  });

  describe('TIME tab', () => {
    it('lists active trainees by the soonest end, with Sofia calendar days left', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const cvet = trainee('Cvet');
      const subs = [
        time(ana, '2026-10-20T10:00:00Z', '2026-11-19T10:00:00Z'),
        // Ends later today (22:30 Sofia): 0 days left, still active.
        time(bob, '2026-10-10T20:30:00Z', '2026-11-09T20:30:00Z'),
        // 22:30Z on the 9th is already the 10th in Sofia: 1 day left.
        time(cvet, '2026-10-10T22:30:00Z', '2026-11-09T22:30:00Z'),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob, cvet],
        subs,
        new Map(),
        NOW,
      );

      expect(
        result.time.active.map((r) => [r.name, r.daysLeft, r.endsAt]),
      ).toEqual([
        ['Bob', 0, new Date('2026-11-09T20:30:00Z')],
        ['Cvet', 1, new Date('2026-11-09T22:30:00Z')],
        ['Ana', 10, new Date('2026-11-19T10:00:00Z')],
      ]);
      expect(result.time.active[0]).toMatchObject({
        activeSubscriptions: 1,
        remainingCredits: null,
        daysSinceEnd: null,
      });
    });

    it('a renewal bought ahead counts: days left run to the latest end', () => {
      const ana = trainee('Ana');
      const subs = [
        time(ana, '2026-10-20T10:00:00Z', '2026-11-19T10:00:00Z'),
        time(ana, '2026-11-19T10:00:00Z', '2026-12-19T10:00:00Z', {
          planTitle: 'Next month',
        }),
      ];

      const [row] = buildSubscriptionRenewals([ana], subs, new Map(), NOW).time
        .active;

      expect(row).toMatchObject({
        activeSubscriptions: 2,
        daysLeft: 40,
        endsAt: new Date('2026-12-19T10:00:00Z'),
        planTitle: 'Next month',
      });
    });

    it('lists ended trainees by most days since the end, then most unpaid trainings', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const cvet = trainee('Cvet');
      const dora = trainee('Dora');
      const subs = [
        time(ana, '2026-09-01T10:00:00Z', '2026-10-01T10:00:00Z'),
        time(ana, '2026-10-01T10:00:00Z', '2026-10-31T10:00:00Z', {
          status: EXHAUSTED,
        }),
        time(bob, '2026-08-01T10:00:00Z', '2026-08-31T10:00:00Z', {
          status: EXHAUSTED,
        }),
        // Still ACTIVE (the cron hasn't run yet) but ended this morning.
        time(cvet, '2026-10-09T05:00:00Z', '2026-11-09T05:00:00Z'),
        time(dora, '2026-10-01T10:00:00Z', '2026-10-31T10:00:00Z', {
          status: EXHAUSTED,
        }),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob, cvet, dora],
        subs,
        stats([
          [ana, 1, '2026-11-02T16:00:00Z'],
          [dora, 4, '2026-11-08T16:00:00Z'],
        ]),
        NOW,
      );

      expect(
        result.time.exhausted.map((r) => [
          r.name,
          r.daysSinceEnd,
          r.unpaidTrainings,
        ]),
      ).toEqual([
        ['Bob', 70, 0],
        ['Dora', 9, 4],
        ['Ana', 9, 1],
        ['Cvet', 0, 0],
      ]);
      expect(result.time.exhausted[2]).toMatchObject({
        endsAt: new Date('2026-10-31T10:00:00Z'),
        activeSubscriptions: 0,
        daysLeft: null,
      });
      expect(result.time.active).toEqual([]);
    });
  });

  describe('which trainees and which tab', () => {
    it('puts each trainee in the tab of their latest subscription when none is active', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const subs = [
        time(ana, '2026-08-01T10:00:00Z', '2026-08-31T10:00:00Z'),
        punch(ana, 0, '2026-09-01T10:00:00Z'),
        punch(bob, 0, '2026-08-01T10:00:00Z'),
        time(bob, '2026-09-01T10:00:00Z', '2026-10-01T10:00:00Z'),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob],
        subs,
        new Map(),
        NOW,
      );

      expect(names(result.punch.exhausted)).toEqual(['Ana']);
      expect(names(result.time.exhausted)).toEqual(['Bob']);
      // Bob's row only looks at TIME: it ended on 2026-10-01.
      expect(result.time.exhausted[0].endsAt).toEqual(
        new Date('2026-10-01T10:00:00Z'),
      );
    });

    it('an active subscription decides the tab over a later ended one', () => {
      const ana = trainee('Ana');
      const subs = [
        punch(ana, 4, '2026-09-01T10:00:00Z'),
        time(ana, '2026-09-15T10:00:00Z', '2026-10-15T10:00:00Z'),
      ];

      const result = buildSubscriptionRenewals([ana], subs, new Map(), NOW);

      expect(result.punch.active).toHaveLength(1);
      expect(result.punch.active[0].remainingCredits).toBe(4);
      expect(result.time).toEqual({ exhausted: [], active: [] });
    });

    it('with both types active, the latest active subscription decides', () => {
      const ana = trainee('Ana');
      const subs = [
        punch(ana, 4, '2026-09-01T10:00:00Z'),
        time(ana, '2026-11-01T10:00:00Z', '2026-12-01T10:00:00Z'),
      ];

      const result = buildSubscriptionRenewals([ana], subs, new Map(), NOW);

      expect(names(result.time.active)).toEqual(['Ana']);
      expect(result.punch).toEqual({ exhausted: [], active: [] });
    });

    it('leaves out trainees without subscriptions and ignores cancelled ones', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');
      const subs = [
        punch(ana, 8, '2026-11-01T10:00:00Z', { status: CANCELLED }),
        punch(bob, 0, '2026-09-01T10:00:00Z'),
        punch(bob, 8, '2026-11-01T10:00:00Z', { status: CANCELLED }),
      ];

      const result = buildSubscriptionRenewals(
        [ana, bob, trainee('Cvet')],
        subs,
        stats([[ana, 3, '2026-11-08T16:00:00Z']]),
        NOW,
      );

      expect(names(result.punch.exhausted)).toEqual(['Bob']);
      expect(result.punch.active).toEqual([]);
      expect(result.time).toEqual({ exhausted: [], active: [] });
    });

    it('only lists the trainees it is given (the service passes active ones)', () => {
      const ana = trainee('Ana');
      const bob = trainee('Bob');

      const result = buildSubscriptionRenewals(
        [ana],
        [
          punch(ana, 2, '2026-11-01T10:00:00Z'),
          punch(bob, 1, '2026-11-01T10:00:00Z'),
        ],
        new Map(),
        NOW,
      );

      expect(names(result.punch.active)).toEqual(['Ana']);
    });
  });
});
