import { googleSignInEmail } from './google-sign-in';

describe('googleSignInEmail', () => {
  it('accepts a verified Gmail address as Google gives it', () => {
    expect(
      googleSignInEmail({
        email: 'Ivan.Petrov@gmail.com',
        email_verified: true,
      }),
    ).toEqual({ email: 'Ivan.Petrov@gmail.com' });
  });

  it('accepts the googlemail.com spelling of Gmail, in any case', () => {
    expect(
      googleSignInEmail({ email: 'ivan@GoogleMail.com', email_verified: true }),
    ).toEqual({ email: 'ivan@GoogleMail.com' });
  });

  it('accepts a verified Google Workspace account (hd claim) on its own domain', () => {
    expect(
      googleSignInEmail({
        email: 'coach@example-gym.bg',
        email_verified: true,
        hd: 'example-gym.bg',
      }),
    ).toEqual({ email: 'coach@example-gym.bg' });
  });

  it('refuses a personal Google account with a non-Gmail address', () => {
    expect(
      googleSignInEmail({ email: 'ivan@yahoo.com', email_verified: true }),
    ).toEqual({ problem: 'NOT_GMAIL_OR_WORKSPACE' });
  });

  it('refuses an empty hd claim as if there were none', () => {
    expect(
      googleSignInEmail({
        email: 'ivan@yahoo.com',
        email_verified: true,
        hd: ' ',
      }),
    ).toEqual({ problem: 'NOT_GMAIL_OR_WORKSPACE' });
  });

  it('refuses an email Google has not verified, Gmail and Workspace included', () => {
    for (const claims of [
      { email: 'ivan@gmail.com', email_verified: false },
      { email: 'ivan@gmail.com' },
      { email: 'coach@example-gym.bg', hd: 'example-gym.bg' },
    ]) {
      expect(googleSignInEmail(claims)).toEqual({
        problem: 'UNVERIFIED_EMAIL',
      });
    }
  });

  it('refuses a token without an email', () => {
    expect(googleSignInEmail({ email_verified: true })).toEqual({
      problem: 'UNVERIFIED_EMAIL',
    });
    expect(googleSignInEmail({ email: '  ', email_verified: true })).toEqual({
      problem: 'UNVERIFIED_EMAIL',
    });
  });
});
