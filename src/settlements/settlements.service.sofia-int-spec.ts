import { Fixtures } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';

const DEC = { periodStart: '2025-12-01', periodEnd: '2025-12-31' };
const NOV = { periodStart: '2025-11-01', periodEnd: '2025-11-30' };

/**
 * DT-06: SET-02 rerun under TZ=Europe/Sofia (test/tz-sofia-guard.ts). Under
 * UTC an attendance at 2025-12-01 01:00 Sofia lands in the November
 * settlement (flagged in TEST_NOTES); with a Sofia server TZ the period is
 * [Dec 1 00:00 Sofia, Jan 1 00:00 Sofia) and it lands in December.
 */
describe('SettlementsService periods under TZ=Europe/Sofia (DT-06)', () => {
  const fixtures = setupIntegrationSuite();

  async function world(fx: Fixtures) {
    const [trainee, coach, loc] = await Promise.all([
      fx.trainee('Ana'),
      fx.trainer('Coach'),
      fx.location(),
    ]);
    const attend = (trainedAt: string) =>
      fx
        .attend(trainee.id, coach.id, loc.id, trainedAt)
        .then((r) => r.attendance);
    return { attend };
  }

  it('DT-06 SET-02 period is [periodStart 00:00 Sofia, periodEnd+1 00:00 Sofia)', async () => {
    const fx = fixtures();
    const { attend } = await world(fx);
    const justBefore = await attend('2025-11-30T21:59:59.999Z'); // Nov 30 23:59:59.999 Sofia
    const first = await attend('2025-11-30T22:00:00.000Z'); // Dec 1 00:00 Sofia
    const sofiaDec1 = await attend('2025-12-01T01:00:00+02:00'); // 23:00Z Nov 30
    const last = await attend('2025-12-31T21:59:59.999Z'); // Dec 31 23:59:59.999 Sofia
    const justAfter = await attend('2025-12-31T22:00:00.000Z'); // Jan 1 00:00 Sofia

    const dec = await fx.settlements.generate(DEC);
    const nov = await fx.settlements.generate(NOV);

    const ids = async (settlementId: string) =>
      (await fx.allocationsOf(settlementId)).map((a) => a.attendanceId).sort();
    expect(await ids(dec.settlement.id)).toEqual(
      [first.id, sofiaDec1.id, last.id].sort(),
    );
    expect(await ids(nov.settlement.id)).toEqual([justBefore.id]);
    expect(await ids(dec.settlement.id)).not.toContain(justAfter.id);
  });
});
