/**
 * URL slugs for public content (articles, article categories), e.g.
 * "Как да започнем с КросФит" -> "kak-da-zapochnem-s-krosfit".
 *
 * Rules (theindex-web docs/decision-record.md, section 4):
 * - always Latin: Bulgarian Cyrillic is transliterated with the official
 *   Streamlined System (Закон за транслитерацията, 2009);
 * - lowercase letters and digits in hyphen-separated groups, at most 80 characters, cut at a
 *   word boundary;
 * - unique per language: a clash gets "-2", "-3", ... (see uniqueSlug).
 */

/** Longest slug we store (articles and categories keep slugs in varchar(80)). */
export const SLUG_MAX_LENGTH = 80;

/** A valid slug: lowercase Latin letters and digits in groups joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The Streamlined System table, lowercase (slugs are lowercased before transliteration). */
const BULGARIAN_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sht',
  ъ: 'a',
  ь: 'y',
  ю: 'yu',
  я: 'ya',
};

/** Matches when no letter or digit follows, i.e. at the end of a word. */
const WORD_END = '(?![\\p{L}\\p{N}])';
const WORD_START = '(?<![\\p{L}\\p{N}])';

/**
 * Turns a title or name into a slug. Returns '' when nothing usable is left (e.g. only emoji or
 * punctuation); uniqueSlug() then falls back to its `fallback`.
 *
 * Letters outside the Bulgarian alphabet and Latin are dropped (they act as word separators).
 */
export function slugify(text: string, maxLength = SLUG_MAX_LENGTH): string {
  const latin = Array.from(
    text
      // Compose first, so "й" typed as "и" + combining breve is one letter.
      .normalize('NFC')
      .toLowerCase()
      // The law's exceptions: the word "България" is "Bulgaria", and "ия" at the end of a
      // word is "ia" (София -> Sofia), not "iya".
      .replace(new RegExp(`${WORD_START}българия${WORD_END}`, 'gu'), 'bulgaria')
      .replace(new RegExp(`ия${WORD_END}`, 'gu'), 'ia'),
    (char) => BULGARIAN_TO_LATIN[char] ?? char,
  ).join('');

  const slug = latin
    // Strip accents from Latin letters (é -> e). Cyrillic is already transliterated above.
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // Apostrophes join a word instead of splitting it ("it's" -> "its").
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return truncateAtWord(slug, maxLength);
}

/** Whether `value` is a slug we accept, e.g. one an admin typed in. */
export function isValidSlug(
  value: string,
  maxLength = SLUG_MAX_LENGTH,
): boolean {
  return value.length <= maxLength && SLUG_PATTERN.test(value);
}

export interface UniqueSlugOptions {
  /** Used when `base` is empty (a title with no letters or digits). Must be a valid slug. */
  fallback: string;
  /** Slugs that can never be used, e.g. path segments of the site ("category"). */
  reserved?: readonly string[];
  maxLength?: number;
}

/**
 * The first free slug among `base`, `base-2`, `base-3`, ... given the slugs already in use
 * (callers pass the existing slugs for the same language that start with `base`). With a suffix,
 * the base is shortened at a word boundary so the result still fits `maxLength`.
 */
export function uniqueSlug(
  base: string,
  taken: Iterable<string>,
  { fallback, reserved = [], maxLength = SLUG_MAX_LENGTH }: UniqueSlugOptions,
): string {
  if (!isValidSlug(fallback, maxLength)) {
    throw new Error(`Invalid fallback slug: "${fallback}"`);
  }

  const stem = truncateAtWord(base, maxLength) || fallback;
  const unavailable = new Set([...taken, ...reserved]);
  if (!unavailable.has(stem)) return stem;

  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = truncateAtWord(stem, maxLength - suffix.length) + suffix;
    if (!unavailable.has(candidate)) return candidate;
  }
}

/** Shortens a slug to `maxLength`, at the last hyphen when there is one. */
function truncateAtWord(slug: string, maxLength: number): string {
  if (slug.length <= maxLength) return slug;
  // A hyphen at index maxLength means the first maxLength characters end on a whole word.
  const lastHyphen = slug.lastIndexOf('-', maxLength);
  return lastHyphen > 0 ? slug.slice(0, lastHyphen) : slug.slice(0, maxLength);
}
