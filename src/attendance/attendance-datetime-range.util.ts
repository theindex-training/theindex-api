import { BadRequestException } from '@nestjs/common';

function parseDateOnly(dateStr: string): { y: number; m: number; d: number } {
  const [yStr, mStr, dStr] = dateStr.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);

  if (!y || !m || !d) throw new BadRequestException('Invalid date');
  return { y, m, d };
}

function parseTimeOnly(timeStr: string): { h: number; min: number } {
  const [hStr, minStr] = timeStr.split(':');
  const h = Number(hStr);
  const min = Number(minStr);

  if (
    Number.isNaN(h) ||
    Number.isNaN(min) ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  ) {
    throw new BadRequestException('Invalid time');
  }

  return { h, min };
}

export function getLocalDateTimeInterval(input: {
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}): { from: Date; to: Date } {
  const start = parseDateOnly(input.startDate);
  const end = parseDateOnly(input.endDate ?? input.startDate);
  const startTime = parseTimeOnly(input.startTime ?? '00:00');
  const endTime = parseTimeOnly(input.endTime ?? '23:59');

  const from = new Date(
    start.y,
    start.m - 1,
    start.d,
    startTime.h,
    startTime.min,
    0,
    0,
  );

  const to = new Date(end.y, end.m - 1, end.d, endTime.h, endTime.min, 59, 999);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new BadRequestException('Invalid date/time range');
  }

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('start date/time must be before end date/time');
  }

  return { from, to: new Date(to.getTime() + 1) };
}
