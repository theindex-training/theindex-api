import { messageOf, setupE2eSuite } from './e2e-app';

const UUID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

/**
 * Attendance read path over HTTP: query DTOs for `/attendance/dates`
 * (ATR-03) and `reports/inactive-trainees` (ATR-22). Grouping, price info and
 * report contents are covered in `attendance-read.service.int-spec.ts`.
 */
describe('Attendance read path (e2e)', () => {
  const ctx = setupE2eSuite();

  async function get(path: string) {
    const c = ctx();
    return c
      .http()
      .get(path)
      .set('Authorization', `Bearer ${await c.loginAsAdmin()}`);
  }

  describe('ATR-03 GET /attendance/dates query', () => {
    it.each([
      ['missing from', '?to=2025-12-31'],
      ['missing to', '?from=2025-12-01'],
      ['non-YYYY-MM-DD from', '?from=1.12.2025&to=2025-12-31'],
      ['bad trainerId', '?from=2025-12-01&to=2025-12-31&trainerId=abc'],
      ['bad traineeId', '?from=2025-12-01&to=2025-12-31&traineeId=abc'],
      ['unknown param', '?from=2025-12-01&to=2025-12-31&locationId=' + UUID],
    ])('ATR-03 %s -> 400 from the DTO', async (_label, query) => {
      const res = await get(`/api/attendance/dates${query}`);

      expect(res.status).toBe(400);
      expect(Array.isArray(messageOf(res.body))).toBe(true);
    });

    it('ATR-03 from > to passes the DTO and fails in the service -> 400 "from must be <= to"', async () => {
      const res = await get(
        '/api/attendance/dates?from=2025-12-31&to=2025-12-01',
      );

      expect(res.status).toBe(400);
      expect(messageOf(res.body)).toBe('from must be <= to');
    });

    it('ATR-03 control: a valid query with both UUID filters -> 200, echoed', async () => {
      const res = await get(
        `/api/attendance/dates?from=2025-12-01&to=2025-12-31&trainerId=${UUID}&traineeId=${UUID}`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    });
  });

  describe('ATR-22 reports/inactive-trainees skipDays', () => {
    it.each([
      ['missing', ''],
      ['negative', '?skipDays=-1'],
      ['non-integer', '?skipDays=1.5'],
      ['non-numeric', '?skipDays=abc'],
    ])('ATR-22 skipDays %s -> 400', async (_label, query) => {
      const res = await get(
        `/api/attendance/reports/inactive-trainees${query}`,
      );

      expect(res.status).toBe(400);
      expect(Array.isArray(messageOf(res.body))).toBe(true);
    });

    it("ATR-22 '3' and '0' are coerced to numbers and accepted", async () => {
      const c = ctx();
      await c.trainee('Never trained');

      for (const skipDays of ['3', '0']) {
        const res = await get(
          `/api/attendance/reports/inactive-trainees?skipDays=${skipDays}`,
        );
        expect(res.status).toBe(200);
        expect(res.body).toEqual([
          expect.objectContaining({ lastTrainingDate: null }),
        ]);
      }
    });
  });
});
