import { BadRequestException } from '@nestjs/common';
import { getLocalDateInterval } from './attendance-range.util';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as Error).message;
  }
  throw new Error('expected a BadRequestException');
}

// Runs under TZ=UTC (test/tz-guard.ts), so "local" midnight is 00:00Z.
describe('getLocalDateInterval (DT-03)', () => {
  const isoRange = (from: string, to: string) => {
    const r = getLocalDateInterval(from, to);
    return [r.from.toISOString(), r.to.toISOString()];
  };

  it('DT-03 returns [from 00:00, day after to 00:00) in server-local time', () => {
    expect(isoRange('2025-12-01', '2025-12-31')).toEqual([
      '2025-12-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
    expect(isoRange('2024-02-01', '2024-02-29')).toEqual([
      '2024-02-01T00:00:00.000Z',
      '2024-03-01T00:00:00.000Z',
    ]);
  });

  it('DT-03 from == to is a valid one-day interval', () => {
    expect(isoRange('2025-06-10', '2025-06-10')).toEqual([
      '2025-06-10T00:00:00.000Z',
      '2025-06-11T00:00:00.000Z',
    ]);
  });

  it('DT-03 from after to -> 400 "from must be <= to"', () => {
    expect(
      messageOf(() => getLocalDateInterval('2025-06-11', '2025-06-10')),
    ).toBe('from must be <= to');
  });

  it('DT-03 non-numeric or zero parts -> 400 "Invalid date"', () => {
    for (const bad of [
      'garbage',
      '2025-06',
      '2025-00-10',
      '2025-06-00',
      'yyyy-mm-dd',
    ]) {
      expect(messageOf(() => getLocalDateInterval(bad, '2025-06-10'))).toBe(
        'Invalid date',
      );
      expect(messageOf(() => getLocalDateInterval('2025-06-10', bad))).toBe(
        'Invalid date',
      );
    }
  });

  // CHARACTERIZATION: possibly unintended
  it('DT-03 month 13 and day 32 roll over silently instead of being rejected', () => {
    expect(isoRange('2025-13-01', '2025-13-01')).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ]);
    expect(isoRange('2025-01-32', '2025-01-32')).toEqual([
      '2025-02-01T00:00:00.000Z',
      '2025-02-02T00:00:00.000Z',
    ]);
  });
});
