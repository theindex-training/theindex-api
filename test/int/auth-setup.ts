import { createHmac } from 'crypto';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../../src/auth/auth.module';

/** Secret used to sign tokens in integration suites that load AuthModule. */
export const TEST_JWT_SECRET = 'int-test-only-secret';

/**
 * Modules needed to build AuthModule (and, through it, AccountsModule) in an
 * integration suite. `JwtStrategy` reads `process.env.JWT_SECRET` in its
 * constructor and the JWT module reads it through ConfigService, so the env
 * var is set here, before the suite's module is compiled. `JWT_EXPIRES_IN` is
 * cleared so the production default ('7d') applies. Jest gives each test file
 * its own copy of `process.env`.
 */
export function authImports() {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;

  return [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    AuthModule,
  ];
}

/**
 * Decodes an HS256 JWT and checks its signature against `secret`, without
 * going through the app's own JwtService. Throws on a bad signature.
 */
export function decodeVerifiedJwt(
  token: string,
  secret = TEST_JWT_SECRET,
): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [headerB64, payloadB64, signature] = token.split('.');
  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  if (signature !== expected) {
    throw new Error('JWT signature does not match the test secret');
  }

  const decode = (part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

  return { header: decode(headerB64), payload: decode(payloadB64) };
}
