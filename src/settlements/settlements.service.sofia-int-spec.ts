import { Fixtures } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';

/**
 * DT-06: the period boundaries rerun under TZ=Europe/Sofia (test/tz-sofia-guard.ts). Reports
 * compute their periods in Europe/Sofia themselves, so the server's time zone changes nothing:
 * this is the same split as SET-02 under UTC.
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

  it('DT-06 SET-02 a period is [periodStart 00:00 Sofia, periodEnd+1 00:00 Sofia)', async () => {
    const fx = fixtures();
    const { attend } = await world(fx);
    const justBefore = await attend('2025-11-30T21:59:59.999Z'); // Nov 30 23:59:59.999 Sofia
    const first = await attend('2025-11-30T22:00:00.000Z'); // Dec 1 00:00 Sofia
    const sofiaDec1 = await attend('2025-12-01T01:00:00+02:00'); // 23:00Z Nov 30
    const last = await attend('2025-12-15T21:59:59.999Z'); // Dec 15 23:59:59.999 Sofia
    const justAfter = await attend('2025-12-15T22:00:00.000Z'); // Dec 16 00:00 Sofia
    const nov = await fx.report('2025-11-16', '2025-11-30');
    const dec = await fx.report('2025-12-01', '2025-12-15');

    // All unpaid, so each report lists its own period's trainings as waiting.
    const ids = async (settlementId: string) =>
      (await fx.settlements.getById(settlementId)).waiting
        .map((w) => w.attendanceId)
        .sort();
    expect(await ids(dec.id)).toEqual([first.id, sofiaDec1.id, last.id].sort());
    expect(await ids(nov.id)).toEqual([justBefore.id]);
    expect(await ids(dec.id)).not.toContain(justAfter.id);
  });
});
