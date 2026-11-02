import { freezeTimeAndTimeouts } from '../../test/int/clock';
import { HOUR_MS, setupCronHarness } from '../../test/int/cron-harness';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';

const { ACTIVE, EXHAUSTED } = SubscriptionStatus;

/**
 * DT-06 / CRON-02 under TZ=Europe/Sofia (test/tz-sofia-guard.ts). The cron
 * computes its run time with UTC setters, so unlike the other date helpers it
 * does NOT follow the server TZ: it runs at 02:00 UTC, which is 04:00 Sofia in
 * winter and 05:00 Sofia in summer, whatever TZ production sets.
 */
describe('SubscriptionsCronService scheduling under TZ=Europe/Sofia (DT-06)', () => {
  const fixtures = setupIntegrationSuite();
  const { cron, advance, timeSub, statusOf } = setupCronHarness(fixtures);

  it('DT-06 CRON-02 winter: runs at 02:00 UTC (04:00 Sofia), not at 02:00 Sofia', async () => {
    const expired = await timeSub('2026-01-09T12:00:00.000Z');
    // 2026-01-10 01:00 Sofia: 02:00 Sofia (00:00Z) comes first, then 02:00Z.
    freezeTimeAndTimeouts('2026-01-09T23:00:00.000Z');

    cron().onModuleInit();

    await advance(3 * HOUR_MS - 1); // 2026-01-10T01:59:59.999Z (03:59 Sofia)
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 2026-01-10T02:00:00.000Z (04:00 Sofia)
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });

  it('DT-06 CRON-02 summer: runs at 02:00 UTC (05:00 Sofia)', async () => {
    const expired = await timeSub('2026-07-09T12:00:00.000Z');
    freezeTimeAndTimeouts('2026-07-10T01:30:00.000Z'); // 04:30 Sofia

    cron().onModuleInit();

    await advance(HOUR_MS / 2 - 1); // 01:59:59.999Z
    expect(await statusOf(expired.id)).toBe(ACTIVE);

    await advance(1); // 02:00:00.000Z (05:00 Sofia)
    expect(await statusOf(expired.id)).toBe(EXHAUSTED);
  });
});
