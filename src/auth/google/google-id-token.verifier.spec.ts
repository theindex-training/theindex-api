import {
  HttpException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FakeGoogle,
  TEST_GOOGLE_CLIENT_ID,
} from '../../../test/int/google-id-token';
import {
  GOOGLE_TOKEN_INVALID,
  GoogleIdTokenVerifier,
  type GoogleSigningKeys,
} from './google-id-token.verifier';

describe('GoogleIdTokenVerifier', () => {
  const google = new FakeGoogle();
  const googleKeys = google.signingKeys.useValue as GoogleSigningKeys;
  const gmail = { email: 'ivan@gmail.com', email_verified: true };

  const verifier = (
    env: Record<string, string> = { GOOGLE_CLIENT_ID: TEST_GOOGLE_CLIENT_ID },
    keys: GoogleSigningKeys = googleKeys,
  ) => new GoogleIdTokenVerifier(new ConfigService(env), keys);

  async function rejection(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (err) {
      if (err instanceof HttpException) return err;
      throw err;
    }
    throw new Error('Expected a rejection');
  }

  it("answers the token's claims when Google signed it for this app", async () => {
    const claims = await verifier().verify(google.idToken(gmail));

    expect(claims).toMatchObject({
      email: 'ivan@gmail.com',
      email_verified: true,
      aud: TEST_GOOGLE_CLIENT_ID,
      sub: '109876543210987654321',
    });
  });

  it('accepts the issuer without the scheme too, as Google uses both', async () => {
    const claims = await verifier().verify(
      google.idToken(gmail, { overrides: { iss: 'accounts.google.com' } }),
    );

    expect(claims.email).toBe('ivan@gmail.com');
  });

  it('refuses with 401 GOOGLE_TOKEN_INVALID every token that is not a valid one for this app', async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalid: Record<string, string> = {
      'another app (audience)': google.idToken(gmail, {
        overrides: { aud: 'someone-else.apps.googleusercontent.com' },
      }),
      'another issuer': google.idToken(gmail, {
        overrides: { iss: 'https://evil.example.com' },
      }),
      'expired an hour ago': google.idToken(gmail, {
        overrides: { iat: now - 7200, exp: now - 3600 },
      }),
      'not signed by Google': google.idToken(gmail, {
        signWith: FakeGoogle.strangerKey(),
      }),
      'payload changed after signing': (() => {
        const [header, , signature] = google.idToken(gmail).split('.');
        const payload = Buffer.from(
          JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: TEST_GOOGLE_CLIENT_ID,
            iat: now,
            exp: now + 3600,
            email: 'admin@gmail.com',
            email_verified: true,
          }),
        ).toString('base64url');
        return `${header}.${payload}.${signature}`;
      })(),
      'not a JWT': 'not-a-token',
    };

    for (const [why, token] of Object.entries(invalid)) {
      const err = await rejection(verifier().verify(token));

      expect({ why, err }).toEqual({
        why,
        err: expect.any(UnauthorizedException) as unknown,
      });
      expect(err.getResponse()).toEqual({
        statusCode: 401,
        message: 'This Google sign-in is invalid or has expired',
        error: GOOGLE_TOKEN_INVALID,
      });
    }
  });

  it('answers 503 without GOOGLE_CLIENT_ID (blank counts as missing), and reports no client id', async () => {
    for (const env of [{}, { GOOGLE_CLIENT_ID: '  ' }]) {
      const v = verifier(env);

      expect(v.clientId()).toBeNull();
      const err = await rejection(v.verify(google.idToken(gmail)));
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.message).toBe('Google sign-in is not set up');
    }
  });

  it('reports the client id trimmed', () => {
    expect(
      verifier({ GOOGLE_CLIENT_ID: ` ${TEST_GOOGLE_CLIENT_ID} ` }).clientId(),
    ).toBe(TEST_GOOGLE_CLIENT_ID);
  });

  it("answers 503 when Google's signing keys can't be fetched", async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const v = verifier(undefined, () =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND www.googleapis.com')),
    );

    const err = await rejection(v.verify(google.idToken(gmail)));

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).toBe('Google sign-in is unavailable right now');
  });
});
