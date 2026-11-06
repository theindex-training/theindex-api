/**
 * A `LIKE`/`ILIKE` pattern that matches `term` anywhere, with the wildcards in `term` escaped, so a
 * search for "100%" matches the text "100%". Use it with `ESCAPE '\'`.
 */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** Escapes LIKE wildcards (and the escape character itself). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
