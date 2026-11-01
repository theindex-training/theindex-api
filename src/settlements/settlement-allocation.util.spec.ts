import { splitCents } from './settlement-allocation.util';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('splitCents (DT-05)', () => {
  it('DT-05 gives the extra cents to the first parts', () => {
    expect(splitCents(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitCents(2, 3)).toEqual([1, 1, 0]);
    expect(splitCents(10001, 4)).toEqual([2501, 2500, 2500, 2500]);
    expect(splitCents(10003, 4)).toEqual([2501, 2501, 2501, 2500]);
  });

  it('DT-05 the parts always add up to the total', () => {
    for (const [total, parts] of [
      [10000, 3],
      [9000, 4],
      [1, 7],
      [123457, 11],
      [99, 100],
    ]) {
      const split = splitCents(total, parts);
      expect(split).toHaveLength(parts);
      expect(sum(split)).toBe(total);
      expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(1);
    }
  });

  it('DT-05 even split, single part and zero total', () => {
    expect(splitCents(9000, 4)).toEqual([2250, 2250, 2250, 2250]);
    expect(splitCents(4999, 1)).toEqual([4999]);
    expect(splitCents(0, 3)).toEqual([0, 0, 0]);
  });

  it('DT-05 parts <= 0 -> []', () => {
    expect(splitCents(10000, 0)).toEqual([]);
    expect(splitCents(10000, -2)).toEqual([]);
  });
});
