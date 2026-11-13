/**
 * Contact details people type in themselves (self-registration, "My details"): an email, a phone
 * number and links to their social network profiles. Pure helpers, shared by the DTOs and services.
 */

/** Longest phone number stored (the profiles' `phone` column is varchar(30)). */
export const PHONE_MAX_LENGTH = 30;

/**
 * A phone number as people write it: an optional leading `+`, then 6 to 15 digits, which may be
 * grouped with spaces, hyphens, dots, slashes or parentheses ("+359 88 123 4567", "0888/123-456").
 */
export const PHONE_PATTERN = /^\s*\+?(?:[\s()\-./]*\d){6,15}[\s()\-./]*$/;

/** Longest social profile (a handle or a link) stored. */
export const SOCIAL_LINK_MAX_LENGTH = 200;

/** The social networks a person may give a profile of. */
export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'tiktok'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type SocialLinks = Record<SocialNetwork, string | null>;

/** An email as stored for a new account: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A phone number as stored: trimmed, with runs of whitespace collapsed to one space. */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, ' ');
}

/**
 * An optional text field as stored: trimmed, and null when empty. `undefined` stays `undefined`
 * ("not sent"), so a PATCH can tell "leave it" from "clear it".
 */
export function optionalText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The social links sent in a body, each through `optionalText`; networks not sent are left out,
 * so the result can be spread over a stored row.
 */
export function socialLinksPatch(
  dto: Partial<Record<SocialNetwork, string | null>>,
): Partial<SocialLinks> {
  const patch: Partial<SocialLinks> = {};
  for (const network of SOCIAL_NETWORKS) {
    const value = optionalText(dto[network]);
    if (value !== undefined) patch[network] = value;
  }
  return patch;
}
