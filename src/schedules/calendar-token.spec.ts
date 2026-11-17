import { JwtService } from '@nestjs/jwt';
import {
  signPreviewToken,
  verifyPreviewToken,
} from '../articles/preview-token';
import {
  InvalidCalendarTokenError,
  signCalendarToken,
  verifyCalendarToken,
} from './calendar-token';

const SECRET = 'unit-test-secret';
const CLAIMS = {
  slotId: '0b9e3c1a-5d2f-4e6a-8b7c-9d0e1f2a3b4c',
  traineeId: '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b',
};
const NOW = new Date('2026-11-12T10:00:00Z');
/** The training ends at 19:00 in Sofia on Friday 13 Nov. */
const ENDS_AT = new Date('2026-11-13T17:00:00Z');

function invalid(fn: () => unknown) {
  expect(fn).toThrow(InvalidCalendarTokenError);
  expect(fn).toThrow('This calendar link is invalid or has expired');
}

describe('calendar tokens', () => {
  it('names the training and the trainee, until a day after the training ends', () => {
    const token = signCalendarToken(CLAIMS, ENDS_AT, SECRET, NOW);

    expect(verifyCalendarToken(token, SECRET, NOW)).toEqual(CLAIMS);
    expect(
      verifyCalendarToken(token, SECRET, new Date('2026-11-14T16:59:59Z')),
    ).toEqual(CLAIMS);
    invalid(() =>
      verifyCalendarToken(token, SECRET, new Date('2026-11-14T17:00:00Z')),
    );
  });

  it('is refused when signed with another secret or tampered with', () => {
    const forged = signCalendarToken(CLAIMS, ENDS_AT, 'another-secret', NOW);
    invalid(() => verifyCalendarToken(forged, SECRET, NOW));

    const [head, , signature] = signCalendarToken(
      CLAIMS,
      ENDS_AT,
      SECRET,
      NOW,
    ).split('.');
    const body = Buffer.from(
      JSON.stringify({ sub: CLAIMS.slotId, trainee: 'someone-else' }),
    ).toString('base64url');
    invalid(() =>
      verifyCalendarToken(`${head}.${body}.${signature}`, SECRET, NOW),
    );
    invalid(() => verifyCalendarToken('not-a-token', SECRET, NOW));
  });

  it('is never a login or preview token, and they are never one', () => {
    const calendar = signCalendarToken(CLAIMS, ENDS_AT, SECRET, NOW);
    // A login token is signed with JWT_SECRET itself; give it the calendar's claims too.
    const login = new JwtService().sign(
      { sub: CLAIMS.slotId, trainee: CLAIMS.traineeId },
      { secret: SECRET },
    );
    const { token: preview } = signPreviewToken(CLAIMS.slotId, SECRET, NOW);

    invalid(() => verifyCalendarToken(login, SECRET, NOW));
    invalid(() => verifyCalendarToken(preview, SECRET, NOW));
    expect(() => verifyPreviewToken(calendar, SECRET, NOW)).toThrow();
    expect(() => {
      new JwtService().verify(calendar, { secret: SECRET });
    }).toThrow();
  });

  it('needs JWT_SECRET', () => {
    expect(() => signCalendarToken(CLAIMS, ENDS_AT, '', NOW)).toThrow(
      'JWT_SECRET is not set',
    );
  });
});
