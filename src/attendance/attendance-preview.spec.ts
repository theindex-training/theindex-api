import { PlanType } from '../common/enums/plan-type.enum';
import {
  buildAttendancePreview,
  PreviewSubscription,
  PreviewTrainee,
} from './attendance-preview';

// 12:00 in Sofia (UTC+2) on 2026-11-09.
const NOW = new Date('2026-11-09T10:00:00.000Z');
const TRAINED_AT = new Date('2026-11-09T16:30:00.000Z');

let seq = 0;
function trainee(name: string, nickname: string | null = null): PreviewTrainee {
  seq += 1;
  return { id: `t-${String(seq).padStart(3, '0')}`, name, nickname };
}

function punch(
  t: PreviewTrainee,
  remainingCredits: number,
  startsAt = '2026-10-01T00:00:00Z',
  extra: Partial<PreviewSubscription> = {},
): PreviewSubscription {
  seq += 1;
  return {
    id: `s-${seq}`,
    traineeId: t.id,
    type: PlanType.PUNCH,
    planTitle: 'Punch 16',
    startsAt: new Date(startsAt),
    endsAt: null,
    remainingCredits,
    createdAt: new Date(startsAt),
    ...extra,
  };
}

function time(
  t: PreviewTrainee,
  startsAt: string,
  endsAt: string,
  extra: Partial<PreviewSubscription> = {},
): PreviewSubscription {
  seq += 1;
  return {
    id: `s-${seq}`,
    traineeId: t.id,
    type: PlanType.TIME,
    planTitle: 'Month',
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    remainingCredits: null,
    createdAt: new Date(startsAt),
    ...extra,
  };
}

const preview = (
  trainees: PreviewTrainee[],
  subs: PreviewSubscription[],
  trainedAt = TRAINED_AT,
  now = NOW,
) => buildAttendancePreview(trainees, subs, trainedAt, now);

describe('buildAttendancePreview', () => {
  describe('PUNCH', () => {
    it('shows the trainings left after this one', () => {
      const ana = trainee('Ana', 'Ani');
      const sub = punch(ana, 10);

      expect(preview([ana], [sub])).toEqual([
        {
          traineeId: ana.id,
          name: 'Ana',
          nickname: 'Ani',
          paymentStatus: 'PAID',
          level: 'OK',
          subscription: {
            id: sub.id,
            type: 'PUNCH',
            planTitle: 'Punch 16',
            remainingCreditsAfter: 9,
            endsAt: null,
            daysLeft: null,
          },
        },
      ]);
    });

    it.each([
      [1, 0, 'LAST'],
      [2, 1, 'LOW'],
      [3, 2, 'LOW'],
      [4, 3, 'OK'],
    ])('%i credits -> %i left, level %s', (credits, left, level) => {
      const ana = trainee('Ana');

      const [row] = preview([ana], [punch(ana, credits)]);

      expect(row.subscription?.remainingCreditsAfter).toBe(left);
      expect(row.level).toBe(level);
    });

    it('adds up several punch subscriptions; the earliest started pays', () => {
      const ana = trainee('Ana');
      const later = punch(ana, 8, '2026-11-01T00:00:00Z');
      const earlier = punch(ana, 1, '2026-10-01T00:00:00Z', {
        planTitle: 'Punch 8',
      });

      const [row] = preview([ana], [later, earlier]);

      expect(row.subscription).toMatchObject({
        id: earlier.id,
        planTitle: 'Punch 8',
        remainingCreditsAfter: 8,
      });
      expect(row.level).toBe('OK');
    });

    it('pays even when the subscription starts after the training', () => {
      const ana = trainee('Ana');
      const sub = punch(ana, 5, '2026-12-01T00:00:00Z');

      const [row] = preview([ana], [sub]);

      expect(row.paymentStatus).toBe('PAID');
      expect(row.subscription?.id).toBe(sub.id);
    });

    it('a subscription without credits does not pay', () => {
      const ana = trainee('Ana');

      const [row] = preview([ana], [punch(ana, 0)]);

      expect(row).toMatchObject({
        paymentStatus: 'UNPAID',
        level: 'UNPAID',
        subscription: null,
      });
    });
  });

  describe('TIME', () => {
    it('shows the end date and the days left from today', () => {
      const ana = trainee('Ana');
      const sub = time(ana, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');

      const [row] = preview([ana], [sub]);

      expect(row).toMatchObject({
        paymentStatus: 'PAID',
        level: 'OK',
        subscription: {
          id: sub.id,
          type: 'TIME',
          planTitle: 'Month',
          remainingCreditsAfter: null,
          endsAt: new Date('2026-12-01T00:00:00Z'),
          daysLeft: 22,
        },
      });
    });

    it.each([
      // Ends later today in Sofia.
      ['2026-11-09T20:00:00Z', 0, 'LAST'],
      ['2026-11-10T20:00:00Z', 1, 'LOW'],
      ['2026-11-16T10:00:00Z', 7, 'LOW'],
      ['2026-11-17T10:00:00Z', 8, 'OK'],
    ])('ending %s -> %i days left, level %s', (endsAt, daysLeft, level) => {
      const ana = trainee('Ana');

      const [row] = preview([ana], [time(ana, '2026-10-17T10:00:00Z', endsAt)]);

      expect(row.subscription?.daysLeft).toBe(daysLeft);
      expect(row.level).toBe(level);
    });

    it('counts Sofia calendar days: 23:30 UTC is already the next day', () => {
      const ana = trainee('Ana');
      // 01:30 on 10 Nov in Sofia.
      const now = new Date('2026-11-09T23:30:00Z');

      const [row] = preview(
        [ana],
        [time(ana, '2026-10-01T00:00:00Z', '2026-11-11T08:00:00Z')],
        new Date('2026-11-09T23:30:00Z'),
        now,
      );

      expect(row.subscription?.daysLeft).toBe(1);
    });

    it('covers startsAt <= trainedAt < endsAt only', () => {
      const ana = trainee('Ana');
      const sub = time(ana, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
      const statusAt = (trainedAt: string) =>
        preview([ana], [sub], new Date(trainedAt))[0].paymentStatus;

      expect(statusAt('2026-10-31T23:59:59Z')).toBe('UNPAID');
      expect(statusAt('2026-11-01T00:00:00Z')).toBe('PAID');
      expect(statusAt('2026-11-30T23:59:59Z')).toBe('PAID');
      expect(statusAt('2026-12-01T00:00:00Z')).toBe('UNPAID');
    });

    it('an already paid next period moves the end', () => {
      const ana = trainee('Ana');
      const current = time(ana, '2026-10-10T00:00:00Z', '2026-11-10T00:00:00Z');
      const next = time(ana, '2026-11-10T00:00:00Z', '2026-12-10T00:00:00Z');

      const [row] = preview([ana], [next, current]);

      expect(row.subscription).toMatchObject({
        id: current.id,
        endsAt: new Date('2026-12-10T00:00:00Z'),
        daysLeft: 31,
      });
      expect(row.level).toBe('OK');
    });

    it('a backdated training in a period that is over has 0 days left', () => {
      const ana = trainee('Ana');
      // Still ACTIVE until the nightly job marks it.
      const sub = time(ana, '2026-10-09T00:00:00Z', '2026-11-08T22:00:00Z');

      const [row] = preview([ana], [sub], new Date('2026-11-05T10:00:00Z'));

      expect(row.subscription?.daysLeft).toBe(0);
      expect(row.level).toBe('LAST');
    });
  });

  it('with both types, the earliest started eligible subscription pays', () => {
    const ana = trainee('Ana');
    const month = time(ana, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    const card = punch(ana, 5, '2026-11-05T00:00:00Z');
    const bob = trainee('Bob');
    const bobCard = punch(bob, 5, '2026-10-01T00:00:00Z');
    const bobMonth = time(bob, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');

    const rows = preview([ana, bob], [card, month, bobMonth, bobCard]);

    expect(rows.map((r) => [r.name, r.subscription?.id])).toEqual([
      ['Ana', month.id],
      ['Bob', bobCard.id],
    ]);
    expect(rows[1].subscription?.remainingCreditsAfter).toBe(4);
  });

  it('breaks a start tie by creation time', () => {
    const ana = trainee('Ana');
    const second = punch(ana, 5, '2026-10-01T00:00:00Z', {
      createdAt: new Date('2026-10-02T00:00:00Z'),
    });
    const first = punch(ana, 5, '2026-10-01T00:00:00Z', {
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });

    expect(preview([ana], [second, first])[0].subscription?.id).toBe(first.id);
  });

  it('a trainee without subscriptions is UNPAID', () => {
    const ana = trainee('Ana');

    expect(preview([ana], [])).toEqual([
      {
        traineeId: ana.id,
        name: 'Ana',
        nickname: null,
        paymentStatus: 'UNPAID',
        level: 'UNPAID',
        subscription: null,
      },
    ]);
  });

  it("never uses another trainee's subscription", () => {
    const ana = trainee('Ana');
    const bob = trainee('Bob');

    const rows = preview([ana, bob], [punch(bob, 5)]);

    expect(rows.map((r) => [r.name, r.paymentStatus])).toEqual([
      ['Ana', 'UNPAID'],
      ['Bob', 'PAID'],
    ]);
  });

  it('orders by attention (unpaid, last, low, ok), then by name', () => {
    const ok = trainee('Ани');
    const low = trainee('Борис');
    const last = trainee('Вера');
    const unpaidB = trainee('Яна');
    const unpaidA = trainee('Георги');
    const lowTime = trainee('Асен');

    const rows = preview(
      [ok, low, last, unpaidB, unpaidA, lowTime],
      [
        punch(ok, 10),
        punch(low, 2),
        punch(last, 1),
        time(lowTime, '2026-10-12T00:00:00Z', '2026-11-12T00:00:00Z'),
      ],
    );

    expect(rows.map((r) => [r.level, r.name])).toEqual([
      ['UNPAID', 'Георги'],
      ['UNPAID', 'Яна'],
      ['LAST', 'Вера'],
      ['LOW', 'Асен'],
      ['LOW', 'Борис'],
      ['OK', 'Ани'],
    ]);
  });
});
