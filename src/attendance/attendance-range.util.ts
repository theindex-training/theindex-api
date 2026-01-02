import { BadRequestException } from '@nestjs/common';

function parseDateOnly(dateStr: string): { y: number; m: number; d: number } {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!y || !m || !d) throw new BadRequestException('Invalid date');
  return { y, m, d };
}

/**
 * Returns [from, to) in local time, where "to" is the start of the day after "toDate".
 * Example: from=2025-12-01, to=2025-12-31 => [Dec 1 00:00, Jan 1 00:00)
 */
export function getLocalDateInterval(
  fromDate: string,
  toDate: string,
): { from: Date; to: Date } {
  const f = parseDateOnly(fromDate);
  const t = parseDateOnly(toDate);

  const from = new Date(f.y, f.m - 1, f.d, 0, 0, 0, 0);
  const to = new Date(t.y, t.m - 1, t.d + 1, 0, 0, 0, 0);

  if (isNaN(from.getTime()) || isNaN(to.getTime()))
    throw new BadRequestException('Invalid date range');
  if (from.getTime() >= to.getTime())
    throw new BadRequestException('from must be <= to');

  return { from, to };
}
