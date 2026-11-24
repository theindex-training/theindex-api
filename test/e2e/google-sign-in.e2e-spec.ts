import { FakeGoogle, TEST_GOOGLE_CLIENT_ID } from '../int/google-id-token';
import { decodeVerifiedJwt } from '../int/auth-setup';
import { E2E_JWT_SECRET, messageOf, setupE2eSuite } from './e2e-app';

type LoginBody = {
  accessToken: string;
  account: Record<string, unknown>;
};

/**
 * "Sign in with Google" over HTTP: the public `GET /api/auth/google/config` and
 * `POST /api/auth/google`. Which accounts a Google sign-in opens is covered in
 * `src/auth/google-sign-in.int-spec.ts`; the token checks in `google-id-token.verifier.spec.ts`.
 */
describe('Google sign-in (e2e)', () => {
  const google = new FakeGoogle();
  const ctx = setupE2eSuite({ overrides: [google.signingKeys] });

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;
  });

  afterAll(() => {
    delete process.env.GOOGLE_CLIENT_ID;
  });

  const signIn = (body: object) =>
    ctx().http().post('/api/auth/google').send(body);

  describe('GET /api/auth/google/config', () => {
    it('is public and gives the client id', async () => {
      const res = await ctx().http().get('/api/auth/google/config').expect(200);

      expect(res.body).toEqual({ clientId: TEST_GOOGLE_CLIENT_ID });
    });

    it('gives null while GOOGLE_CLIENT_ID is not set, and sign-in answers 503', async () => {
      delete process.env.GOOGLE_CLIENT_ID;

      const res = await ctx().http().get('/api/auth/google/config').expect(200);
      expect(res.body).toEqual({ clientId: null });

      const refused = await signIn({
        credential: google.idToken({
          email: 'ivan@gmail.com',
          email_verified: true,
        }),
      }).expect(503);
      expect(messageOf(refused.body)).toBe('Google sign-in is not set up');
    });
  });

  describe('POST /api/auth/google', () => {
    it('answers 201 like POST /api/auth/login, with a token the API accepts', async () => {
      const c = ctx();
      const trainee = await c.trainee('Ivan');
      await c.provisionAndLogin('trainee', trainee.id, 'ivan@gmail.com');

      const res = await signIn({
        credential: google.idToken({
          email: 'ivan@gmail.com',
          email_verified: true,
        }),
      }).expect(201);
      const body = res.body as LoginBody;

      expect(Object.keys(body).sort()).toEqual(['accessToken', 'account']);
      expect(body.account).toMatchObject({
        email: 'ivan@gmail.com',
        role: 'TRAINEE',
        traineeProfileId: trainee.id,
      });
      expect(body.account).not.toHaveProperty('passwordHash');
      expect(
        decodeVerifiedJwt(body.accessToken, E2E_JWT_SECRET).payload,
      ).toMatchObject({ traineeProfileId: trainee.id, setupRequired: false });

      const me = await c
        .http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ email: 'ivan@gmail.com' });
    });

    it('answers 401 with an error code the front translates', async () => {
      const res = await signIn({
        credential: google.idToken({
          email: 'nobody@gmail.com',
          email_verified: true,
        }),
      }).expect(401);

      expect(res.body).toEqual({
        statusCode: 401,
        message: 'No account uses this Google address',
        error: 'GOOGLE_NO_ACCOUNT',
      });
    });

    it("answers 401 GOOGLE_TOKEN_INVALID for a token that is not Google's", async () => {
      const res = await signIn({ credential: 'not-a-token' }).expect(401);

      expect(res.body).toMatchObject({ error: 'GOOGLE_TOKEN_INVALID' });
    });

    it('answers 400 without a credential, or with unknown fields', async () => {
      for (const body of [
        {},
        { credential: '' },
        { credential: 42 },
        { credential: 'x'.repeat(4097) },
        { credential: 'token', email: 'ivan@gmail.com' },
      ]) {
        await signIn(body).expect(400);
      }
    });
  });
});
