import { generateKeyPairSync, KeyObject, sign } from 'crypto';
import { GOOGLE_SIGNING_KEYS } from '../../src/auth/google/google-id-token.verifier';
import type { ProviderOverride } from './test-app';

/** The OAuth client id the suites' "Sign in with Google" is set up with (`GOOGLE_CLIENT_ID`). */
export const TEST_GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

/**
 * Stands in for Google, an external service: an RSA key pair whose public half the API is given
 * as Google's signing keys (`GOOGLE_SIGNING_KEYS`), and ID tokens shaped like Google's, signed
 * with the private half. The API still checks them with google-auth-library, as in production.
 */
export class FakeGoogle {
  readonly keyId = 'test-key-1';
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

  /** Google's signing keys as the API reads them. Pass to the suite's `overrides`. */
  readonly signingKeys: ProviderOverride = {
    provide: GOOGLE_SIGNING_KEYS,
    useValue: () =>
      Promise.resolve({
        [this.keyId]: this.keys.publicKey.export({
          type: 'spki',
          format: 'pem',
        }) as string,
      }),
  };

  /**
   * A Google ID token for `claims` (email, email_verified, hd...), issued now for an hour to
   * TEST_GOOGLE_CLIENT_ID. `overrides` replaces any standard claim; `signWith` another key.
   */
  idToken(
    claims: Record<string, unknown>,
    {
      overrides = {},
      signWith = this.keys.privateKey,
    }: { overrides?: Record<string, unknown>; signWith?: KeyObject } = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: this.keyId };
    const payload = {
      iss: 'https://accounts.google.com',
      aud: TEST_GOOGLE_CLIENT_ID,
      azp: TEST_GOOGLE_CLIENT_ID,
      sub: '109876543210987654321',
      iat: now,
      exp: now + 3600,
      ...claims,
      ...overrides,
    };
    const encode = (part: object) =>
      Buffer.from(JSON.stringify(part)).toString('base64url');
    const signed = `${encode(header)}.${encode(payload)}`;
    const signature = sign('RSA-SHA256', Buffer.from(signed), signWith);
    return `${signed}.${signature.toString('base64url')}`;
  }

  /** Another key pair's private key: a token signed with it isn't Google's. */
  static strangerKey(): KeyObject {
    return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  }
}
