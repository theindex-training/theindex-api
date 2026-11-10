import sanitizeHtml from 'sanitize-html';

/**
 * The summary of a workout: the workout as the trainers write it (or as the lesson-plan PDF
 * has it in its RX column), for people to read. Editor.js output limited to paragraphs whose
 * text keeps only bold, italic and line breaks. The structured parts beside it are what results
 * and statistics use; this is the text.
 */

export const SUMMARY_MAX_BLOCKS = 60;
export const SUMMARY_MAX_TEXT_LENGTH = 3000;

export interface SummaryBlock {
  id?: string;
  type: 'paragraph';
  data: { text: string };
}

export interface WorkoutSummary {
  /** Editor.js keeps these; they are stored so the editor can load the summary back. */
  time?: number;
  version?: string;
  blocks: SummaryBlock[];
}

export const EMPTY_SUMMARY: WorkoutSummary = { blocks: [] };

/** The summary is not something we accept; the message says why. */
export class InvalidSummaryError extends Error {}

const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

const INLINE_HTML: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'i', 'br'],
  allowedAttributes: {},
  // Other editors and pasted text use these for the same thing.
  transformTags: { strong: 'b', em: 'i' },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Inline HTML reduced to <b>, <i> and <br>, without leading or trailing line breaks. */
export function sanitizeSummaryText(html: string): string {
  return sanitizeHtml(html, INLINE_HTML)
    .replace(/^(\s|<br\s*\/?>|&nbsp;)+|(\s|<br\s*\/?>|&nbsp;)+$/gi, '')
    .trim();
}

/**
 * Checks Editor.js output and returns what is stored: paragraphs only, sanitized, empty ones
 * dropped. Throws InvalidSummaryError for anything else, for an empty summary and for one over
 * the limits.
 */
export function normalizeSummary(input: unknown): WorkoutSummary {
  if (!isObject(input) || !Array.isArray(input.blocks)) {
    throw new InvalidSummaryError(
      'summary must be an object with a blocks array',
    );
  }
  if (input.blocks.length > SUMMARY_MAX_BLOCKS) {
    throw new InvalidSummaryError(
      `summary can have at most ${SUMMARY_MAX_BLOCKS} paragraphs`,
    );
  }
  const blocks: SummaryBlock[] = [];
  input.blocks.forEach((block: unknown, index) => {
    const where = `summary paragraph ${index + 1}`;
    if (!isObject(block) || block.type !== 'paragraph') {
      throw new InvalidSummaryError(
        `${where}: only paragraphs are allowed (bold and italic inside them)`,
      );
    }
    const data = block.data;
    if (!isObject(data) || typeof data.text !== 'string') {
      throw new InvalidSummaryError(`${where}: the text is missing`);
    }
    const text = sanitizeSummaryText(data.text);
    if (!summaryLineText(text)) return;
    const id =
      typeof block.id === 'string' && BLOCK_ID.test(block.id)
        ? block.id
        : undefined;
    blocks.push({ ...(id ? { id } : {}), type: 'paragraph', data: { text } });
  });

  const summary: WorkoutSummary = { blocks };
  if (typeof input.time === 'number' && Number.isFinite(input.time)) {
    summary.time = input.time;
  }
  if (typeof input.version === 'string' && input.version.length <= 20) {
    summary.version = input.version;
  }
  const length = summaryToPlainText(summary).length;
  if (!length) {
    throw new InvalidSummaryError('summary must not be empty');
  }
  if (length > SUMMARY_MAX_TEXT_LENGTH) {
    throw new InvalidSummaryError(
      `summary must be at most ${SUMMARY_MAX_TEXT_LENGTH} characters of text`,
    );
  }
  return summary;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

/** One paragraph's sanitized HTML as text: <br> becomes a new line, tags go. */
function summaryLineText(html: string): string {
  return sanitizeHtml(html.replace(/<br\s*\/?>/gi, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(
      /&(amp|lt|gt|quot|#39|nbsp);/g,
      (_, name: string) => ENTITIES[name],
    )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** The summary without markup, a line per paragraph or line break: for search, messages, etc. */
export function summaryToPlainText(summary: WorkoutSummary): string {
  return summary.blocks
    .map((block) => summaryLineText(block.data.text))
    .filter(Boolean)
    .join('\n');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A summary from lines of plain text (the RX column of a lesson plan): a paragraph per line,
 * the first in bold, as the lesson plans print the workout's heading line ("3 rounds for
 * time:", "AMRAP 12:", "Deadlift").
 */
export function summaryFromLines(lines: string[]): WorkoutSummary {
  return {
    blocks: lines
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        type: 'paragraph' as const,
        data: {
          text: index === 0 ? `<b>${escapeHtml(line)}</b>` : escapeHtml(line),
        },
      })),
  };
}
