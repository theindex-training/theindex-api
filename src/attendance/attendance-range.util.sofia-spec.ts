import { BadRequestException } from '@nestjs/common';
import { getLocalDateInterval } from './attendance-range.util';

/**
 * DT-06: DT-03 rerun under TZ=Europe/Sofia (test/tz-sofia-guard.ts).
 * Documents TEST_PLAN Q1: if production sets TZ=Europe/Sofia, settlement
 * periods and /attendance/dates ranges start at gym-local midnight.
 */
describe('getLocalDateInterval under TZ=Europe/Sofia (DT-06 / DT-03)', () => {
  const isoRange = (from: string, to: string) => {
    const r = getLocalDateInterval(from, to);
    return [r.from.toISOString(), r.to.toISOString()];
  };

  it('DT-06 winter: [from 00:00 Sofia, day after to 00:00 Sofia) = 22:00Z the previous day', () => {
    expect(isoRange('2025-12-01', '2025-12-31')).toEqual([
      '2025-11-30T22:00:00.000Z',
      '2025-12-31T22:00:00.000Z',
    ]);
  });

  it('DT-06 summer: boundaries are 21:00Z (+03:00)', () => {
    expect(isoRange('2025-07-01', '2025-07-01')).toEqual([
      '2025-06-30T21:00:00.000Z',
      '2025-07-01T21:00:00.000Z',
    ]);
  });

  it('DT-06 DST days: spring-forward day is 23h long, fall-back day is 25h long', () => {
    expect(isoRange('2025-03-30', '2025-03-30')).toEqual([
      '2025-03-29T22:00:00.000Z',
      '2025-03-30T21:00:00.000Z',
    ]);
    expect(isoRange('2025-10-26', '2025-10-26')).toEqual([
      '2025-10-25T21:00:00.000Z',
      '2025-10-26T22:00:00.000Z',
    ]);
  });

  it('DT-06 validation does not depend on the zone: from after to -> 400', () => {
    expect(() => getLocalDateInterval('2025-06-11', '2025-06-10')).toThrow(
      new BadRequestException('from must be <= to'),
    );
  });
});
