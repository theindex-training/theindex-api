import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

/**
 * Tokens for a booked training's calendar file (`GET /api/bookings/calendar.ics?token=…`): Apple
 * Calendar, and anything else that opens an `.ics` link, fetches it without the trainee's login,
 * so the link carries this instead. It names one training and one trainee and lasts until a day
 * after the training ends.
 *
 * Like the article preview tokens (`articles/preview-token.ts`), it is signed with a key derived
 * from JWT_SECRET for this purpose only and carries its own audience, so it is never accepted as
 * a login or preview token, and they are never accepted as one of these.
 */
const AUDIENCE = 'theindex:training-calendar';
const KEY_PURPOSE = 'theindex training calendar token v1';
const VALID_AFTER_END_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token is malformed, forged, for something else, or expired. */
export class InvalidCalendarTokenError extends Error {}

export interface CalendarTokenClaims {
  slotId: string;
  traineeId: string;
}

const jwt = new JwtService();

function calendarKey(jwtSecret: string): string {
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', jwtSecret)
    .update(KEY_PURPOSE)
    .digest('base64url');
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function signCalendarToken(
  claims: CalendarTokenClaims,
  endsAt: Date,
  jwtSecret: string,
  now: Date = new Date(),
): string {
  return jwt.sign(
    {
      trainee: claims.traineeId,
      iat: seconds(now),
      exp: seconds(endsAt) + VALID_AFTER_END_SECONDS,
    },
    {
      secret: calendarKey(jwtSecret),
      algorithm: 'HS256',
      audience: AUDIENCE,
      subject: claims.slotId,
    },
  );
}

/** The training and trainee the token was issued for. Throws InvalidCalendarTokenError otherwise. */
export function verifyCalendarToken(
  token: string,
  jwtSecret: string,
  now: Date = new Date(),
): CalendarTokenClaims {
  const invalid = () =>
    new InvalidCalendarTokenError(
      'This calendar link is invalid or has expired',
    );
  let payload: { sub?: unknown; trainee?: unknown };
  try {
    payload = jwt.verify<{ sub?: unknown; trainee?: unknown }>(token, {
      secret: calendarKey(jwtSecret),
      algorithms: ['HS256'],
      audience: AUDIENCE,
      clockTimestamp: seconds(now),
    });
  } catch {
    throw invalid();
  }
  if (
    typeof payload.sub !== 'string' ||
    !UUID.test(payload.sub) ||
    typeof payload.trainee !== 'string' ||
    !UUID.test(payload.trainee)
  ) {
    throw invalid();
  }
  return { slotId: payload.sub, traineeId: payload.trainee };
}
