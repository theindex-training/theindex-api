import { JwtService } from '@nestjs/jwt';
import {
  InvalidPreviewTokenError,
  PREVIEW_TOKEN_TTL_SECONDS,
  signPreviewToken,
  verifyPreviewToken,
} from './preview-token';

const SECRET = 'unit-test-secret';
const ARTICLE_ID = '0b9e3c1a-5d2f-4e6a-8b7c-9d0e1f2a3b4c';
const NOW = new Date('2026-11-06T10:00:00Z');
const at = (secondsLater: number) =>
  new Date(NOW.getTime() + secondsLater * 1000);

function invalid(fn: () => unknown) {
  expect(fn).toThrow(InvalidPreviewTokenError);
  expect(fn).toThrow('The preview link is invalid or has expired');
}

describe('preview tokens', () => {
  it('names the article and lasts 30 minutes', () => {
    const { token, expiresAt } = signPreviewToken(ARTICLE_ID, SECRET, NOW);

    expect(expiresAt).toEqual(new Date('2026-11-06T10:30:00Z'));
    expect(verifyPreviewToken(token, SECRET, NOW)).toBe(ARTICLE_ID);
    expect(
      verifyPreviewToken(token, SECRET, at(PREVIEW_TOKEN_TTL_SECONDS - 1)),
    ).toBe(ARTICLE_ID);
  });

  it('is refused once it has expired', () => {
    const { token } = signPreviewToken(ARTICLE_ID, SECRET, NOW);

    invalid(() =>
      verifyPreviewToken(token, SECRET, at(PREVIEW_TOKEN_TTL_SECONDS)),
    );
  });

  it('is refused when signed with another secret or tampered with', () => {
    const { token } = signPreviewToken(ARTICLE_ID, 'another-secret', NOW);
    invalid(() => verifyPreviewToken(token, SECRET, NOW));

    const [header, , signature] = signPreviewToken(
      ARTICLE_ID,
      SECRET,
      NOW,
    ).token.split('.');
    const otherPayload = Buffer.from(
      JSON.stringify({
        sub: '11111111-1111-4111-8111-111111111111',
        aud: 'theindex:article-preview',
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    invalid(() =>
      verifyPreviewToken(`${header}.${otherPayload}.${signature}`, SECRET, NOW),
    );
    invalid(() => verifyPreviewToken('not-a-token', SECRET, NOW));
  });

  it('is not a login token, and a login token is not a preview token', () => {
    const { token } = signPreviewToken(ARTICLE_ID, SECRET, NOW);
    // The JWT strategy verifies bearer tokens with JWT_SECRET itself.
    expect(() =>
      new JwtService({ secret: SECRET }).verify<object>(token, {
        clockTimestamp: Math.floor(NOW.getTime() / 1000),
      }),
    ).toThrow('invalid signature');

    const login = new JwtService({ secret: SECRET }).sign(
      { sub: ARTICLE_ID, role: 'ADMIN', iat: Math.floor(NOW.getTime() / 1000) },
      { expiresIn: '7d' },
    );
    invalid(() => verifyPreviewToken(login, SECRET, NOW));
  });

  it('needs a secret', () => {
    expect(() => signPreviewToken(ARTICLE_ID, '', NOW)).toThrow(
      'JWT_SECRET is not set',
    );
  });
});
