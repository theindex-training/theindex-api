import { BadRequestException } from '@nestjs/common';

export function getLocalDayRange(dateStr: string): { from: Date; to: Date } {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  if (!y || !m || !d) throw new BadRequestException('Invalid date');

  // Local timezone boundaries for that day:
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0); // exclusive upper bound

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new BadRequestException('Invalid date');
  }

  return { from, to };
}
