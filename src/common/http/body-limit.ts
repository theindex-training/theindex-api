/**
 * Largest JSON request body (Express's default is 100 kB). Article drafts carry the whole
 * Editor.js document (theindex-web docs/decision-record.md, section 7), which can pass 100 kB for
 * a long article. Set in main.ts and in the e2e app, which mirrors main.ts.
 */
export const JSON_BODY_LIMIT = '1mb';
