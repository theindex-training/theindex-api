import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

/**
 * Tokens for the public site's draft preview (`/preview?token=…`, theindex-web
 * docs/decision-record.md, sections 4 and 8): a JWT that names one article and lasts 30 minutes.
 *
 * It is signed with a key derived from JWT_SECRET for this purpose only, and carries its own
 * audience, so a preview token is never accepted as a login token (the JWT strategy uses the
 * secret itself) and a login token is never accepted as a preview token.
 */
export const PREVIEW_TOKEN_TTL_SECONDS = 30 * 60;

const AUDIENCE = 'theindex:article-preview';
const KEY_PURPOSE = 'theindex article preview token v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The token is malformed, forged, for something else, or expired. */
export class InvalidPreviewTokenError extends Error {}

export interface PreviewToken {
  token: string;
  expiresAt: Date;
}

const jwt = new JwtService();

function previewKey(jwtSecret: string): string {
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', jwtSecret)
    .update(KEY_PURPOSE)
    .digest('base64url');
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function signPreviewToken(
  articleId: string,
  jwtSecret: string,
  now: Date = new Date(),
): PreviewToken {
  const issuedAt = seconds(now);
  const token = jwt.sign(
    { iat: issuedAt },
    {
      secret: previewKey(jwtSecret),
      algorithm: 'HS256',
      audience: AUDIENCE,
      subject: articleId,
      expiresIn: PREVIEW_TOKEN_TTL_SECONDS,
    },
  );
  return {
    token,
    expiresAt: new Date((issuedAt + PREVIEW_TOKEN_TTL_SECONDS) * 1000),
  };
}

/** The article id the token was issued for. Throws InvalidPreviewTokenError otherwise. */
export function verifyPreviewToken(
  token: string,
  jwtSecret: string,
  now: Date = new Date(),
): string {
  let payload: { sub?: unknown };
  try {
    payload = jwt.verify<{ sub?: unknown }>(token, {
      secret: previewKey(jwtSecret),
      algorithms: ['HS256'],
      audience: AUDIENCE,
      clockTimestamp: seconds(now),
    });
  } catch {
    throw new InvalidPreviewTokenError(
      'The preview link is invalid or has expired',
    );
  }
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new InvalidPreviewTokenError(
      'The preview link is invalid or has expired',
    );
  }
  return payload.sub;
}
