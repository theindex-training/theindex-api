import { BadRequestException } from '@nestjs/common';
import { fromGymLocalToUtc } from './attendance-timezone.util';

function hasExplicitTimeZone(dateTime: string): boolean {
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(dateTime);
}

export function resolveTrainedAt(dto: {
  trainedAt?: string;
  trainedDate?: string;
  trainedTime?: string;
}): Date {
  // Priority 1: full datetime
  if (dto.trainedAt) {
    if (!hasExplicitTimeZone(dto.trainedAt)) {
      const parsed = dto.trainedAt.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
      );

      if (parsed) {
        const [, yStr, mStr, dStr, hStr, minStr, secStr, msStr] = parsed;
        const second = secStr ? Number(secStr) : 0;
        const millisecond = msStr ? Number(msStr.padEnd(3, '0')) : 0;

        return fromGymLocalToUtc(
          Number(yStr),
          Number(mStr),
          Number(dStr),
          Number(hStr),
          Number(minStr),
          second,
          millisecond,
        );
      }
    }

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

    const local = fromGymLocalToUtc(y, m, day, hours, minutes, 0, 0);
    if (isNaN(local.getTime()))
      throw new BadRequestException('Invalid date/time');
    return local;
  }

  // Priority 3: default now
  return new Date();
}
