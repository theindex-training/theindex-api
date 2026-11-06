import sanitizeHtml from 'sanitize-html';

/**
 * The body of an article: Editor.js output, checked and normalized before it is stored
 * (theindex-web docs/decision-record.md, section 7). Only the block types below are accepted;
 * anything else is rejected, never passed through. Inline HTML is cut down to an allowlist, so
 * what reaches readers (and digest emails) can't carry scripts or styles.
 *
 * Image and YouTube blocks are stored as references (`mediaId`, `videoId`), not URLs: the site
 * builds the URLs itself, and the back office maps them back to the editor's tool data.
 */

export const MAX_BLOCKS = 1000;
export const MAX_TEXT_LENGTH = 10_000;
export const MAX_CAPTION_LENGTH = 500;
export const MAX_LIST_DEPTH = 3;

export type ArticleBlock =
  | { id?: string; type: 'paragraph'; data: { text: string } }
  | { id?: string; type: 'header'; data: { text: string; level: 2 | 3 } }
  | {
      id?: string;
      type: 'list';
      data: { style: 'ordered' | 'unordered'; items: ListItem[] };
    }
  | { id?: string; type: 'quote'; data: { text: string; caption: string } }
  | { id?: string; type: 'image'; data: { mediaId: string; caption: string } }
  | {
      id?: string;
      type: 'embed';
      data: { service: 'youtube'; videoId: string; caption: string };
    }
  | { id?: string; type: 'delimiter'; data: Record<string, never> };

export interface ListItem {
  content: string;
  items: ListItem[];
}

export interface ArticleContent {
  /** Editor.js keeps these; we store them so the editor can load the content back. */
  time?: number;
  version?: string;
  blocks: ArticleBlock[];
}

export const EMPTY_CONTENT: ArticleContent = { blocks: [] };

/** The content is not something we accept; the message says which block and why. */
export class InvalidContentError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const BLOCK_ID = /^[A-Za-z0-9_-]{1,64}$/;

const INLINE_HTML: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'i', 'a', 'br'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // Other editors and pasted text use these for the same thing.
  transformTags: { strong: 'b', em: 'i' },
  // sanitize-html's defaults also drop the contents of script, style and similar tags.
};

/** Inline HTML reduced to <b>, <i>, <a href> (http, https, mailto) and <br>. */
export function sanitizeInline(html: string): string {
  return sanitizeHtml(html, INLINE_HTML).trim();
}

/**
 * Checks Editor.js output and returns what we store. Throws InvalidContentError (a 400 for the
 * client) for anything outside the allowlist or the limits.
 */
export function normalizeContent(input: unknown): ArticleContent {
  if (!isObject(input) || !Array.isArray(input.blocks)) {
    throw new InvalidContentError(
      'content must be an object with a blocks array',
    );
  }
  if (input.blocks.length > MAX_BLOCKS) {
    throw new InvalidContentError(
      `content can have at most ${MAX_BLOCKS} blocks`,
    );
  }

  const content: ArticleContent = {
    blocks: input.blocks.map((block, index) => normalizeBlock(block, index)),
  };
  if (typeof input.time === 'number' && Number.isFinite(input.time)) {
    content.time = input.time;
  }
  if (typeof input.version === 'string' && input.version.length <= 32) {
    content.version = input.version;
  }
  return content;
}

function normalizeBlock(block: unknown, index: number): ArticleBlock {
  const where = `block ${index + 1}`;
  if (
    !isObject(block) ||
    typeof block.type !== 'string' ||
    !isObject(block.data)
  ) {
    throw new InvalidContentError(
      `${where} must have a type and a data object`,
    );
  }
  const id =
    typeof block.id === 'string' && BLOCK_ID.test(block.id)
      ? block.id
      : undefined;
  const data = block.data;
  const withId = <T extends ArticleBlock>(b: T): T => (id ? { id, ...b } : b);

  switch (block.type) {
    case 'paragraph':
      return withId({
        type: 'paragraph',
        data: { text: inline(data.text, where) },
      });

    case 'header': {
      const level = data.level;
      if (level !== 2 && level !== 3) {
        throw new InvalidContentError(`${where}: heading level must be 2 or 3`);
      }
      return withId({
        type: 'header',
        data: { text: inline(data.text, where), level },
      });
    }

    case 'list': {
      const style = data.style;
      if (style !== 'ordered' && style !== 'unordered') {
        throw new InvalidContentError(
          `${where}: list style must be ordered or unordered`,
        );
      }
      if (!Array.isArray(data.items)) {
        throw new InvalidContentError(`${where}: list items must be an array`);
      }
      return withId({
        type: 'list',
        data: { style, items: listItems(data.items, where, 1) },
      });
    }

    case 'quote':
      return withId({
        type: 'quote',
        data: {
          text: inline(data.text, where),
          caption: caption(data.caption, where),
        },
      });

    case 'image': {
      // The image tool keeps what our uploader returned under `file`; only the id matters.
      const file = isObject(data.file) ? data.file : {};
      const mediaId = file.mediaId ?? data.mediaId;
      if (typeof mediaId !== 'string' || !UUID.test(mediaId)) {
        throw new InvalidContentError(
          `${where}: an image needs the mediaId of an uploaded image`,
        );
      }
      return withId({
        type: 'image',
        data: {
          mediaId: mediaId.toLowerCase(),
          caption: caption(data.caption, where),
        },
      });
    }

    case 'embed': {
      if (data.service !== 'youtube') {
        throw new InvalidContentError(
          `${where}: only YouTube videos can be embedded`,
        );
      }
      // The client's embed URL is never used: the video id is taken from the link, or given.
      const videoId =
        typeof data.videoId === 'string' && YOUTUBE_ID.test(data.videoId)
          ? data.videoId
          : youtubeVideoId(data.source);
      if (!videoId) {
        throw new InvalidContentError(`${where}: not a YouTube video link`);
      }
      return withId({
        type: 'embed',
        data: {
          service: 'youtube',
          videoId,
          caption: caption(data.caption, where),
        },
      });
    }

    case 'delimiter':
      return withId({ type: 'delimiter', data: {} });

    default:
      throw new InvalidContentError(
        `${where}: unsupported block type "${block.type}"`,
      );
  }
}

function listItems(items: unknown[], where: string, depth: number): ListItem[] {
  // Only actual items count: the deepest level's empty `items: []` is not another level.
  if (items.length && depth > MAX_LIST_DEPTH) {
    throw new InvalidContentError(
      `${where}: lists can be nested at most ${MAX_LIST_DEPTH} levels deep`,
    );
  }
  return items.map((item) => {
    // @editorjs/list 2.x: { content, items }; 1.x: plain strings.
    if (typeof item === 'string')
      return { content: inline(item, where), items: [] };
    if (!isObject(item)) {
      throw new InvalidContentError(`${where}: list items must be text`);
    }
    const children = Array.isArray(item.items) ? item.items : [];
    return {
      content: inline(item.content, where),
      items: listItems(children, where, depth + 1),
    };
  });
}

function inline(value: unknown, where: string): string {
  if (typeof value !== 'string') {
    throw new InvalidContentError(`${where}: text is missing`);
  }
  if (value.length > MAX_TEXT_LENGTH) {
    throw new InvalidContentError(
      `${where}: text can be at most ${MAX_TEXT_LENGTH} characters`,
    );
  }
  return sanitizeInline(value);
}

function caption(value: unknown, where: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_CAPTION_LENGTH) {
    throw new InvalidContentError(
      `${where}: a caption can be at most ${MAX_CAPTION_LENGTH} characters`,
    );
  }
  return sanitizeInline(value);
}

/** The video id from a YouTube link (watch, youtu.be, embed, shorts), or undefined. */
export function youtubeVideoId(link: unknown): string | undefined {
  if (typeof link !== 'string') return undefined;
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, value] = url.pathname.split('/');
    id =
      kind === 'watch'
        ? url.searchParams.get('v')
        : ['embed', 'shorts', 'live'].includes(kind)
          ? value
          : undefined;
  }
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
