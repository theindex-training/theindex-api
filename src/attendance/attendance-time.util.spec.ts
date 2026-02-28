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
