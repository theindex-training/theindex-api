/**
 * Which Google sign-ins may open an account: the email Google vouches for is the account's key
 * (Google sign-in is only a shortcut to an existing account, matched by email), so it is accepted
 * only where Google is in charge of the address, as Google's own guidance puts it:
 * - a Gmail address (`@gmail.com`, `@googlemail.com`), which only exists as a Google account;
 * - a Google Workspace account (the `hd` claim names its domain), whose domain's admin manages it.
 *
 * Any other Google account (one created with, say, a Yahoo address) is refused: Google checked
 * that address only once, when the account was created, and its owner may have lost it since.
 */

/** The claims of a Google ID token this rule reads (already verified: signature, audience, expiry). */
export interface GoogleIdentityClaims {
  email?: string;
  email_verified?: boolean;
  /** The Google Workspace domain of the account; absent for personal Google accounts. */
  hd?: string;
}

export type GoogleSignInEmail =
  | { email: string }
  | { problem: 'UNVERIFIED_EMAIL' | 'NOT_GMAIL_OR_WORKSPACE' };

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** The email to look the account up by, or why this Google account can't sign in. */
export function googleSignInEmail(
  claims: GoogleIdentityClaims,
): GoogleSignInEmail {
  const email = claims.email?.trim() ?? '';
  if (!email || claims.email_verified !== true) {
    return { problem: 'UNVERIFIED_EMAIL' };
  }

  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const workspace = Boolean(claims.hd?.trim());
  if (!GMAIL_DOMAINS.has(domain) && !workspace) {
    return { problem: 'NOT_GMAIL_OR_WORKSPACE' };
  }

  return { email };
}
