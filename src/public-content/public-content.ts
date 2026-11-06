import type { ArticleBlock, ArticleContent } from '../articles/article-content';
import type { ArticleStatus } from '../articles/article.entity';
import type { PublicMedia } from '../media/media.service';

/**
 * What the public site (theindex-web) gets from `/api/public/...`: published content only, with
 * image URLs resolved, and nothing the back office keeps for itself (drafts, revisions, account
 * ids, file names). Pure helpers; the queries are in PublicContentService.
 */

/** Length of the excerpt made from the text when the article has none (cards, lists). */
export const EXCERPT_FALLBACK_LENGTH = 200;
/** Length of a meta description made from the excerpt or the text. */
export const DESCRIPTION_LENGTH = 160;

export interface PublicCategoryRef {
  slug: string;
  name: string;
}

export interface PublicCategory extends PublicCategoryRef {
  description: string | null;
  /** Published articles in the category; always 1 or more. */
  articleCount: number;
}

/** A content block as the site renders it: no editor ids, images resolved. */
export type PublicBlock =
  | StripId<Exclude<ArticleBlock, { type: 'image' }>>
  | { type: 'image'; data: { image: PublicMedia; caption: string } };

type StripId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface PublicArticleSummary {
  slug: string;
  title: string;
  /** The article's excerpt, or the start of its text when it has none ('' without text). */
  excerpt: string;
  featuredImage: PublicMedia | null;
  categories: PublicCategoryRef[];
  /** First publish: `datePublished`. Republishing an update doesn't change it. */
  publishedAt: Date;
  /** Last publish (first publish or an update): `dateModified`. */
  updatedAt: Date;
}

export interface PublicArticle extends PublicArticleSummary {
  language: string;
  /** The SEO title, or the title. */
  seoTitle: string;
  /** The SEO description, else the excerpt, else the start of the text (≤160 characters). */
  description: string;
  content: { blocks: PublicBlock[] };
}

export interface PublicArticlePage {
  items: PublicArticleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicSitemapEntry {
  slug: string;
  lastmod: Date;
}

export interface PublicSitemap {
  /** Published articles, newest first; `lastmod` is the last publish. */
  articles: PublicSitemapEntry[];
  /**
   * Categories with a published article, in navigation order; `lastmod` is the later of the
   * category's own last change and the last publish of one of its articles.
   */
  categories: PublicSitemapEntry[];
}

/**
 * The draft of any article, as the public site's `/preview` renders it. Shaped like
 * PublicArticle, but the draft may be unfinished: no slug or dates before the first publish, and
 * an empty title is possible.
 */
export interface ArticlePreview extends Omit<
  PublicArticle,
  'slug' | 'publishedAt' | 'updatedAt'
> {
  preview: true;
  status: ArticleStatus;
  /** The published slug, else the one chosen in the draft, else null (made at the first publish). */
  slug: string | null;
  publishedAt: Date | null;
  /** When the draft was last saved. */
  updatedAt: Date;
}

/** Media ids an article's text and featured image need, for one lookup. */
export function mediaIdsOf(
  content: ArticleContent | null,
  featuredMediaId: string | null,
): string[] {
  const ids = (content?.blocks ?? []).flatMap((b) =>
    b.type === 'image' ? [b.data.mediaId] : [],
  );
  return featuredMediaId ? [featuredMediaId, ...ids] : ids;
}

/**
 * The blocks as the site renders them. Image blocks get their image; one whose image no longer
 * exists is left out rather than rendered broken. Editor ids are dropped.
 */
export function toPublicBlocks(
  content: ArticleContent | null,
  media: ReadonlyMap<string, PublicMedia>,
): PublicBlock[] {
  return (content?.blocks ?? []).flatMap((block): PublicBlock[] => {
    if (block.type === 'image') {
      const image = media.get(block.data.mediaId);
      return image
        ? [{ type: 'image', data: { image, caption: block.data.caption } }]
        : [];
    }
    const { type, data } = block;
    return [{ type, data } as PublicBlock];
  });
}

/**
 * `text` with whitespace collapsed, cut to at most `maxLength` characters at a word boundary
 * and ended with "…" when it was longer.
 */
export function textSummary(text: string | null, maxLength: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const room = clean.slice(0, maxLength - 1);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > maxLength / 2 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s.,;:!?…–—-]+$/, '')}…`;
}

export interface ArticleText {
  title: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  plainText: string;
}

/** The excerpt, or the start of the text. */
export function excerptOf(a: Pick<ArticleText, 'excerpt' | 'plainText'>) {
  return a.excerpt?.trim() || textSummary(a.plainText, EXCERPT_FALLBACK_LENGTH);
}

/** The title and description for the page's `<head>`, with the fallbacks applied. */
export function seoOf(a: ArticleText): {
  seoTitle: string;
  description: string;
} {
  return {
    seoTitle: a.seoTitle?.trim() || a.title,
    description:
      a.seoDescription?.trim() ||
      textSummary(a.excerpt?.trim() || a.plainText, DESCRIPTION_LENGTH),
  };
}
