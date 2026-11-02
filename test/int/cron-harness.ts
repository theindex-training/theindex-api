import { PlanType } from '../../src/common/enums/plan-type.enum';
import { SubscriptionsCronService } from '../../src/subscriptions/subscriptions-cron.service';
import { Fixtures } from './fixtures';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/**
 * CRON-02 harness for driving `SubscriptionsCronService` with fake timeouts
 * (use together with `freezeTimeAndTimeouts`). The job itself runs against
 * the real test database. Lifecycle hooks are called directly: the
 * integration module is only compiled (no `init()`), so the timer is never
 * scheduled unless a test asks for it.
 *
 * Tests assert on subscription rows: "has the job run by now?" is answered by
 * whether an expired TIME subscription is EXHAUSTED yet. The pass-through spy
 * on `SubscriptionsService.exhaustPastEndTimeSubscriptions` does not replace
 * the real method. Its only job is to hand over the promise of a run that has
 * started, so `settle()` can wait for the job's DB write and the
 * rescheduling that follows it.
 */
export function setupCronHarness(fixtures: () => Fixtures) {
  let cron: SubscriptionsCronService;
  let jobRuns: jest.SpyInstance<Promise<number>, []>;

  beforeEach(() => {
    const fx = fixtures();
    cron = fx.moduleRef.get(SubscriptionsCronService);
    jobRuns = jest.spyOn(fx.subscriptions, 'exhaustPastEndTimeSubscriptions');
  });

  afterEach(async () => {
    cron.onModuleDestroy();
    await settle();
    jobRuns.mockRestore();
  });

  /** Outcome of every job run started so far (in start order). */
  function runOutcomes() {
    return Promise.allSettled(
      jobRuns.mock.results.map((r) => r.value as Promise<number>),
    );
  }

  /** Waits for every job run that has started, and what runs after it. */
  async function settle(): Promise<void> {
    await runOutcomes();
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    cron: () => cron,

    /** Advances fake time (firing due timeouts) and waits for the job. */
    advance: async (ms: number): Promise<void> => {
      await jest.advanceTimersByTimeAsync(ms);
      await settle();
    },

    /** ACTIVE TIME subscription (direct insert) that ends at `endsAt`. */
    timeSub: async (endsAt: string) => {
      const fx = fixtures();
      const [trainee, plan] = await Promise.all([
        fx.trainee(`Trainee ${endsAt}`),
        fx.timePlan(30, 0),
      ]);
      const end = new Date(endsAt);
      return fx.insertSubscription({
        traineeId: trainee.id,
        planId: plan.id,
        type: PlanType.TIME,
        startsAt: new Date(end.getTime() - 30 * DAY_MS),
        endsAt: end,
      });
    },

    statusOf: async (id: string) => {
      return (await fixtures().sub(id)).status;
    },
  };
}
