import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Certificates,
  OAuth2Client,
  type TokenPayload,
} from 'google-auth-library';

/**
 * Google's public keys, by key id (PEM), that sign its ID tokens. In production they come from
 * Google (`GOOGLE_SIGNING_KEYS_PROVIDER`, cached by google-auth-library as long as Google says);
 * tests give their own, since Google is an external service.
 */
export const GOOGLE_SIGNING_KEYS = Symbol('GOOGLE_SIGNING_KEYS');
export type GoogleSigningKeys = () => Promise<Certificates>;

export const GOOGLE_SIGNING_KEYS_PROVIDER = {
  provide: GOOGLE_SIGNING_KEYS,
  useFactory: (): GoogleSigningKeys => {
    const client = new OAuth2Client();
    return async () => (await client.getFederatedSignonCertsAsync()).certs;
  },
};

/** The issuers Google signs its ID tokens as. */
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** The `error` of a 401 for a Google ID token that isn't valid for this app (or has expired). */
export const GOOGLE_TOKEN_INVALID = 'GOOGLE_TOKEN_INVALID';

/**
 * Checks a "Sign in with Google" ID token (Google Identity Services' `credential`): Google's
 * signature, that it was issued to this app (`GOOGLE_CLIENT_ID` as its audience), by Google,
 * and that it hasn't expired. What the email may open is decided by `googleSignInEmail`.
 *
 * `GOOGLE_CLIENT_ID` is read on use, like the media settings: without it Google sign-in answers
 * 503 (and the front shows no button), but the API still starts.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly client = new OAuth2Client();

  constructor(
    private readonly config: ConfigService,
    @Inject(GOOGLE_SIGNING_KEYS)
    private readonly signingKeys: GoogleSigningKeys,
  ) {}

  /** The OAuth client id of the app's Google sign-in, or null when it isn't set up. */
  clientId(): string | null {
    return this.config.get<string>('GOOGLE_CLIENT_ID')?.trim() || null;
  }

  async verify(idToken: string): Promise<TokenPayload> {
    const clientId = this.clientId();
    if (!clientId) {
      throw new ServiceUnavailableException('Google sign-in is not set up');
    }

    let keys: Certificates;
    try {
      keys = await this.signingKeys();
    } catch (error) {
      this.logger.error(
        `Could not fetch Google's signing keys: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Google sign-in is unavailable right now',
      );
    }

    try {
      const ticket = await this.client.verifySignedJwtWithCertsAsync(
        idToken,
        keys,
        clientId,
        GOOGLE_ISSUERS,
      );
      const payload = ticket.getPayload();
      if (!payload) throw new Error('No payload');
      return payload;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'This Google sign-in is invalid or has expired',
        error: GOOGLE_TOKEN_INVALID,
      });
    }
  }
}
