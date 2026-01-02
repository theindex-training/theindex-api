import { BadRequestException } from '@nestjs/common';

export function resolveTrainedAt(dto: {
  trainedAt?: string;
  trainedDate?: string;
  trainedTime?: string;
}): Date {
  // Priority 1: full datetime
  if (dto.trainedAt) {
    const d = new Date(dto.trainedAt);
    if (isNaN(d.getTime())) throw new BadRequestException('Invalid trainedAt');
    return d;
  }

  // Priority 2: date (+ optional time)
  if (dto.trainedDate) {
    const [yStr, mStr, dStr] = dto.trainedDate.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const day = Number(dStr);

    if (!y || !m || !day) throw new BadRequestException('Invalid trainedDate');

    let hours = 12; // DST-safe default
    let minutes = 0;

    if (dto.trainedTime) {
      const [hhStr, mmStr] = dto.trainedTime.split(':');
      hours = Number(hhStr);
      minutes = Number(mmStr);

      if (
        Number.isNaN(hours) ||
        Number.isNaN(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
      ) {
        throw new BadRequestException('Invalid trainedTime');
      }
    }

    // Local time constructor (safe for your single-gym deployment)
    const local = new Date(y, m - 1, day, hours, minutes, 0, 0);
    if (isNaN(local.getTime()))
      throw new BadRequestException('Invalid date/time');
    return local;
  }

  // Priority 3: default now
  return new Date();
}
