import { freezeTime } from '../../test/int/clock';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionRenewalsService } from './subscription-renewals.service';

describe('SubscriptionRenewalsService (integration)', () => {
  const fixtures = setupIntegrationSuite();

  async function world() {
    const fx = fixtures();
    const [trainer, loc] = await Promise.all([
      fx.trainer('Coach'),
      fx.location(),
    ]);
    const attend = (traineeId: string, trainedAt: string) =>
      fx.attend(traineeId, trainer.id, loc.id, trainedAt);
    const renewals = fx.moduleRef.get(SubscriptionRenewalsService);
    return { fx, attend, renewals };
  }

  it('ranks PUNCH trainees from the real credit and unpaid counts', async () => {
    const { fx, attend, renewals } = await world();
    const ana = await fx.trainee('Ana');
    const bob = await fx.trainee('Bob', { nickname: 'B' });
    const cvet = await fx.trainee('Cvet');
    const dora = await fx.trainee('Dora');
    const two = await fx.punchPlan(2, 2000, { title: 'Two' });
    const sixteen = await fx.punchPlan(16, 16000, { title: 'Sixteen' });

    // Ana: 2 credits used, then 3 more trainings unpaid.
    await fx.buy(ana.id, two.id, { startsAt: '2026-10-01T08:00:00Z' });
    for (const day of ['02', '03', '04', '05', '06']) {
      await attend(ana.id, `2026-10-${day}T16:00:00Z`);
    }
    // Bob: one training past his card.
    await fx.buy(bob.id, two.id, { startsAt: '2026-10-01T08:00:00Z' });
    for (const day of ['07', '08', '09']) {
      await attend(bob.id, `2026-10-${day}T16:00:00Z`);
    }
    // Cvet: two cards of 16 at once, one training used -> 31 left.
    await fx.buy(cvet.id, sixteen.id, { startsAt: '2026-11-01T08:00:00Z' });
    await fx.buy(cvet.id, sixteen.id, { startsAt: '2026-11-01T08:00:00Z' });
    await attend(cvet.id, '2026-11-02T16:00:00Z');
    // Dora: 1 left.
    await fx.buy(dora.id, two.id, { startsAt: '2026-11-01T08:00:00Z' });
    await attend(dora.id, '2026-11-03T16:00:00Z');

    freezeTime('2026-11-09T10:00:00Z');
    const result = await renewals.overview();

    expect(
      result.punch.exhausted.map((r) => [
        r.name,
        r.unpaidTrainings,
        r.planTitle,
        r.lastTrainedAt?.toISOString(),
      ]),
    ).toEqual([
      ['Ana', 3, 'Two', '2026-10-06T16:00:00.000Z'],
      ['Bob', 1, 'Two', '2026-10-09T16:00:00.000Z'],
    ]);
    expect(result.punch.exhausted[1]).toMatchObject({
      traineeId: bob.id,
      nickname: 'B',
      activeSubscriptions: 0,
      remainingCredits: null,
    });
    expect(
      result.punch.active.map((r) => [
        r.name,
        r.remainingCredits,
        r.activeSubscriptions,
      ]),
    ).toEqual([
      ['Dora', 1, 1],
      ['Cvet', 31, 2],
    ]);
    expect(result.time).toEqual({ exhausted: [], active: [] });
  });

  it('ranks TIME trainees by days left or days since the end, before the cron marks them', async () => {
    const { fx, attend, renewals } = await world();
    const ana = await fx.trainee('Ana');
    const bob = await fx.trainee('Bob');
    const cvet = await fx.trainee('Cvet');
    const month = await fx.timePlan(30, 9000, { title: 'Month' });

    // Ana: ended on 2026-10-31 (10:00Z), trained twice since -> unpaid.
    await fx.buy(ana.id, month.id, { startsAt: '2026-10-01T10:00:00Z' });
    await attend(ana.id, '2026-11-02T16:00:00Z');
    await attend(ana.id, '2026-11-04T16:00:00Z');
    // Bob: ends on 2026-11-19.
    await fx.buy(bob.id, month.id, { startsAt: '2026-10-20T10:00:00Z' });
    // Cvet: ends on 2026-11-12.
    await fx.buy(cvet.id, month.id, { startsAt: '2026-10-13T10:00:00Z' });

    freezeTime('2026-11-09T10:00:00Z');
    const result = await renewals.overview();

    // The cron hasn't run in this test: Ana's subscription is still ACTIVE.
    expect(
      (await fx.subscriptionRows()).every(
        (s) => s.status === SubscriptionStatus.ACTIVE,
      ),
    ).toBe(true);
    expect(result.time.exhausted).toHaveLength(1);
    expect(result.time.exhausted[0]).toMatchObject({
      name: 'Ana',
      planTitle: 'Month',
      daysSinceEnd: 9,
      unpaidTrainings: 2,
      daysLeft: null,
    });
    expect(result.time.exhausted[0].endsAt?.toISOString()).toBe(
      '2026-10-31T10:00:00.000Z',
    );
    expect(result.time.active.map((r) => [r.name, r.daysLeft])).toEqual([
      ['Cvet', 3],
      ['Bob', 10],
    ]);
  });

  it('leaves out inactive trainees and trainees who never had a subscription', async () => {
    const { fx, attend, renewals } = await world();
    const ana = await fx.trainee('Ana');
    const gone = await fx.trainee('Gone');
    const dropIn = await fx.trainee('Drop-in');
    const plan = await fx.punchPlan(1, 1000);

    await fx.buy(ana.id, plan.id, { startsAt: '2026-11-01T08:00:00Z' });
    await fx.buy(gone.id, plan.id, { startsAt: '2026-11-01T08:00:00Z' });
    await attend(gone.id, '2026-11-02T16:00:00Z');
    await attend(dropIn.id, '2026-11-02T16:00:00Z');
    // Deactivated after the fact (as DELETE /trainees/:id does).
    await fx.ds
      .getRepository('trainee_profiles')
      .update({ id: gone.id }, { isActive: false });

    const result = await renewals.overview();

    expect(result.punch.active.map((r) => r.name)).toEqual(['Ana']);
    expect(result.punch.exhausted).toEqual([]);
    expect(result.time).toEqual({ exhausted: [], active: [] });
  });

  it('a new purchase moves the trainee from exhausted to active', async () => {
    const { fx, attend, renewals } = await world();
    const ana = await fx.trainee('Ana');
    const plan = await fx.punchPlan(4, 4000);

    await fx.buy(ana.id, plan.id, { startsAt: '2026-10-01T08:00:00Z' });
    for (const day of ['02', '03', '04', '05', '06', '07']) {
      await attend(ana.id, `2026-10-${day}T16:00:00Z`);
    }
    expect((await renewals.overview()).punch.exhausted[0]).toMatchObject({
      name: 'Ana',
      unpaidTrainings: 2,
    });

    // The purchase pays the 2 unpaid trainings first: 2 of 4 left.
    await fx.moduleRef
      .get(SubscriptionsService)
      .createForTrainee(ana.id, { planId: plan.id });
    const after = await renewals.overview();

    expect(after.punch.exhausted).toEqual([]);
    expect(after.punch.active[0]).toMatchObject({
      name: 'Ana',
      remainingCredits: 2,
      unpaidTrainings: 0,
    });
  });
});
