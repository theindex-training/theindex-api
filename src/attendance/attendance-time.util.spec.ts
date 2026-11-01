import { BadRequestException } from '@nestjs/common';
import { freezeTime, restoreTime } from '../../test/int/clock';
import { requireProductionHourCycle } from '../../test/intl-runtime';
import { resolveTrainedAt } from './attendance-time.util';

describe('resolveTrainedAt', () => {
  it('stores trainedDate+trainedTime as Europe/Sofia local time in winter', () => {
    const trainedAt = resolveTrainedAt({
      trainedDate: '2025-01-15',
      trainedTime: '08:10',
    });

    expect(trainedAt.toISOString()).toBe('2025-01-15T06:10:00.000Z');
  });

  it('stores trainedDate+trainedTime as Europe/Sofia local time in summer', () => {
    const trainedAt = resolveTrainedAt({
      trainedDate: '2025-07-15',
      trainedTime: '08:10',
    });

    expect(trainedAt.toISOString()).toBe('2025-07-15T05:10:00.000Z');
  });

  it('treats trainedAt without timezone as Europe/Sofia local datetime', () => {
    const trainedAt = resolveTrainedAt({
      trainedAt: '2025-01-15T08:10:00',
    });

    expect(trainedAt.toISOString()).toBe('2025-01-15T06:10:00.000Z');
  });

  it('preserves milliseconds for trainedAt without timezone', () => {
    const trainedAt = resolveTrainedAt({
      trainedAt: '2025-01-15T08:10:00.123',
    });

    expect(trainedAt.toISOString()).toBe('2025-01-15T06:10:00.123Z');
  });
});

describe('resolveTrainedAt (DT-02)', () => {
  afterEach(() => restoreTime());

  const iso = (dto: Parameters<typeof resolveTrainedAt>[0]) =>
    resolveTrainedAt(dto).toISOString();
  const messageOf = (dto: Parameters<typeof resolveTrainedAt>[0]) => {
    try {
      resolveTrainedAt(dto);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      return (err as Error).message;
    }
    throw new Error('expected resolveTrainedAt to throw');
  };

  it('DT-02 trainedAt with an explicit Z or offset is kept as that instant', () => {
    expect(iso({ trainedAt: '2025-01-15T08:10:00Z' })).toBe(
      '2025-01-15T08:10:00.000Z',
    );
    expect(iso({ trainedAt: '2025-01-15T08:10Z' })).toBe(
      '2025-01-15T08:10:00.000Z',
    );
    expect(iso({ trainedAt: '2025-01-15T08:10:00+05:00' })).toBe(
      '2025-01-15T03:10:00.000Z',
    );
    expect(iso({ trainedAt: '2025-07-15T08:10:00-0400' })).toBe(
      '2025-07-15T12:10:00.000Z',
    );
  });

  it('DT-02 a 1- or 2-digit fraction in a zoneless trainedAt is read as milliseconds', () => {
    expect(iso({ trainedAt: '2025-01-15T08:10:00.5' })).toBe(
      '2025-01-15T06:10:00.500Z',
    );
    expect(iso({ trainedAt: '2025-01-15T08:10:00.05' })).toBe(
      '2025-01-15T06:10:00.050Z',
    );
  });

  it('DT-02 trainedAt without seconds and without a zone is Europe/Sofia', () => {
    expect(iso({ trainedAt: '2025-01-15T08:10' })).toBe(
      '2025-01-15T06:10:00.000Z',
    );
    expect(iso({ trainedAt: '2025-07-15T08:10' })).toBe(
      '2025-07-15T05:10:00.000Z',
    );
  });

  it('DT-02 trainedDate alone is 12:00 Sofia; with trainedTime it is that Sofia time', () => {
    expect(iso({ trainedDate: '2025-01-15' })).toBe('2025-01-15T10:00:00.000Z');
    expect(iso({ trainedDate: '2025-07-15' })).toBe('2025-07-15T09:00:00.000Z');
    expect(iso({ trainedDate: '2025-01-15', trainedTime: '01:00' })).toBe(
      '2025-01-14T23:00:00.000Z',
    );
    expect(iso({ trainedDate: '2025-01-15', trainedTime: '23:59' })).toBe(
      '2025-01-15T21:59:00.000Z',
    );
    // an empty trainedTime is treated as absent
    expect(iso({ trainedDate: '2025-01-15', trainedTime: '' })).toBe(
      '2025-01-15T10:00:00.000Z',
    );
  });

  it('DT-02 out-of-range or malformed trainedTime -> 400 Invalid trainedTime', () => {
    for (const trainedTime of ['24:00', '12:60', '-1:00', 'ab:cd', '8']) {
      expect(messageOf({ trainedDate: '2025-01-15', trainedTime })).toBe(
        'Invalid trainedTime',
      );
    }
  });

  it('DT-02 trainedDate with a zero or missing part -> 400 Invalid trainedDate', () => {
    for (const trainedDate of [
      '2025-00-10',
      '2025-01-00',
      '0-01-10',
      '2025-01',
      'garbage',
    ]) {
      expect(messageOf({ trainedDate })).toBe('Invalid trainedDate');
    }
  });

  it('DT-02 unparseable trainedAt -> 400 Invalid trainedAt', () => {
    expect(messageOf({ trainedAt: 'not-a-date' })).toBe('Invalid trainedAt');
    expect(messageOf({ trainedAt: '2025-13-45T99:99Z' })).toBe(
      'Invalid trainedAt',
    );
  });

  it('DT-02 nothing given -> now; trainedTime without trainedDate is ignored', () => {
    freezeTime('2025-06-01T09:30:15.250Z');

    expect(iso({})).toBe('2025-06-01T09:30:15.250Z');
    expect(iso({ trainedTime: '18:00' })).toBe('2025-06-01T09:30:15.250Z');
  });

  it('DT-02 trainedAt wins over trainedDate/trainedTime', () => {
    expect(
      iso({
        trainedAt: '2025-01-15T08:10:00Z',
        trainedDate: '2025-03-01',
        trainedTime: '18:00',
      }),
    ).toBe('2025-01-15T08:10:00.000Z');
  });

  // CHARACTERIZATION: possibly unintended
  it('DT-02 on Node 20 (production) a 00:xx Sofia trainedTime or zoneless trainedAt is stored one day early', () => {
    requireProductionHourCycle();

    // Correct instants would be 2025-01-14T22:00Z / 22:59Z / 22:30Z.
    expect(iso({ trainedDate: '2025-01-15', trainedTime: '00:00' })).toBe(
      '2025-01-13T22:00:00.000Z',
    );
    expect(iso({ trainedDate: '2025-01-15', trainedTime: '00:59' })).toBe(
      '2025-01-13T22:59:00.000Z',
    );
    expect(iso({ trainedAt: '2025-01-15T00:30' })).toBe(
      '2025-01-13T22:30:00.000Z',
    );
  });

  // CHARACTERIZATION: possibly unintended
  it('DT-02 date-only trainedAt is UTC midnight, not Sofia', () => {
    expect(iso({ trainedAt: '2025-01-15' })).toBe('2025-01-15T00:00:00.000Z');
  });

  // CHARACTERIZATION: possibly unintended
  it('DT-02 trainedAt with a space instead of T is server-local time, not Sofia', () => {
    // Under TZ=UTC this is 08:10Z; '2025-01-15T08:10' would be 06:10Z.
    expect(iso({ trainedAt: '2025-01-15 08:10' })).toBe(
      '2025-01-15T08:10:00.000Z',
    );
  });

  // CHARACTERIZATION: possibly unintended
  it('DT-02 impossible dates and hours roll over instead of being rejected', () => {
    // Feb 30 -> Mar 2, 12:00 Sofia
    expect(iso({ trainedDate: '2025-02-30' })).toBe('2025-03-02T10:00:00.000Z');
    // hour 25 on Jan 15 -> Jan 16 01:00 Sofia
    expect(iso({ trainedAt: '2025-01-15T25:00' })).toBe(
      '2025-01-15T23:00:00.000Z',
    );
  });
});
