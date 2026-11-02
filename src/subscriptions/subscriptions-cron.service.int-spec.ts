import { freezeTimeAndTimeouts } from '../../test/int/clock';
import { DAY_MS, HOUR_MS, setupCronHarness } from '../../test/int/cron-harness';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';

const { ACTIVE, EXHAUSTED } = SubscriptionStatus;

/**
 * CRON-02: scheduling of the daily TIME-subscription exhaustion job.
 * `Date`, `setTimeout` and `clearTimeout` are faked (the CRON-02 exception to
 * INF-04, see `freezeTimeAndTimeouts`); how the job is driven and observed is
 * described in `test/int/cron-harness.ts`. The Sofia-TZ variant is in
 * `subscriptions-cron.service.sofia-int-spec.ts`.
 */
describe('SubscriptionsCronService scheduling (integration)', () => {
  const fixtures = setupIntegrationSuite();
  const { cron, advance, timeSub, statusOf } = setupCronHarness(fixtures);

  it('CRON-02 started before 02:00 UTC: the first run is today at exactly 02:00:00.000 UTC', async () => {
    const expired = await timeSub('2026-01-09T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T00:30:00.000Z');

    cron().onModuleInit();

    await advance(1.5 * HOUR_MS - 1); // 01:59:59.999Z
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 02:00:00.000Z
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });

  it('CRON-02 started after 02:00 UTC: the first run is tomorrow at 02:00 UTC', async () => {
    const expired = await timeSub('2026-01-09T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T15:30:00.000Z');

    cron().onModuleInit();

    await advance(10.5 * HOUR_MS - 1); // 2026-01-11T01:59:59.999Z
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 2026-01-11T02:00:00.000Z
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });

  it('CRON-02 started at exactly 02:00:00.000 UTC: no run now, the first run is 24h later', async () => {
    const expired = await timeSub('2026-01-09T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T02:00:00.000Z');

    cron().onModuleInit();

    await advance(0);
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(DAY_MS - 1); // 2026-01-11T01:59:59.999Z
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 2026-01-11T02:00:00.000Z
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });

  it('CRON-02 "tomorrow" rolls over the month and year (Dec 31 02:30Z -> Jan 1 02:00Z)', async () => {
    const expired = await timeSub('2025-12-30T12:00:00.000Z');
    freezeTimeAndTimeouts('2025-12-31T02:30:00.000Z');

    cron().onModuleInit();

    await advance(23.5 * HOUR_MS - 1); // 2026-01-01T01:59:59.999Z
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 2026-01-01T02:00:00.000Z
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });

  it('CRON-02 after each run the next one is scheduled for 02:00 UTC the following day', async () => {
    const endedBeforeRun1 = await timeSub('2026-01-09T12:00:00.000Z');
    const endsBetweenRun1And2 = await timeSub('2026-01-10T12:00:00.000Z');
    const endsBetweenRun2And3 = await timeSub('2026-01-11T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T01:00:00.000Z');

    cron().onModuleInit();

    await advance(HOUR_MS); // run 1: 2026-01-10T02:00Z
    expect(await statusOf(endedBeforeRun1.id)).toBe(EXHAUSTED);
    expect(await statusOf(endsBetweenRun1And2.id)).toBe(ACTIVE);

    await advance(DAY_MS - 1); // 2026-01-11T01:59:59.999Z
    expect(await statusOf(endsBetweenRun1And2.id)).toBe(ACTIVE);

    await advance(1); // run 2: 2026-01-11T02:00Z
    expect(await statusOf(endsBetweenRun1And2.id)).toBe(EXHAUSTED);
    expect(await statusOf(endsBetweenRun2And3.id)).toBe(ACTIVE);

    await advance(DAY_MS); // run 3: 2026-01-12T02:00Z
    expect(await statusOf(endsBetweenRun2And3.id)).toBe(EXHAUSTED);
  });

  it('CRON-02 onModuleDestroy before the first run: nothing fires afterwards', async () => {
    const expired = await timeSub('2026-01-09T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T01:00:00.000Z');

    cron().onModuleInit();
    cron().onModuleDestroy();

    await advance(3 * DAY_MS);
    expect(await statusOf(expired.id)).toBe(ACTIVE);
  });

  it('CRON-02 onModuleDestroy after a run cancels the rescheduled run', async () => {
    const endedBeforeRun1 = await timeSub('2026-01-09T12:00:00.000Z');
    const endsAfterRun1 = await timeSub('2026-01-10T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-01-10T01:00:00.000Z');

    cron().onModuleInit();
    await advance(HOUR_MS); // run 1: 2026-01-10T02:00Z
    expect(await statusOf(endedBeforeRun1.id)).toBe(EXHAUSTED);

    cron().onModuleDestroy();

    await advance(3 * DAY_MS);
    expect(await statusOf(endsAfterRun1.id)).toBe(ACTIVE);
  });
});
