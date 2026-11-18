/**
 * What a media item is for. Every kind is stored the same way (a row in `media`, its files in a
 * folder of the media storage); the kind decides which storage area and folder, and who may read
 * the files.
 *
 * - `public` files are served as they are, by nginx at MEDIA_PUBLIC_URL (article images for the
 *   public site).
 * - `private` files are never served by nginx: only the API reads them, behind a guard (lesson
 *   plans are CrossFit's copyrighted material and must not be on the web).
 *
 * To add a kind: add it here with its area and folder; the database enum
 * gets the value through `synchronize`.
 */
export enum MediaKind {
  /** An image for the public site's articles: processed into a master, WebP variants and an OG crop. */
  ARTICLE_IMAGE = 'ARTICLE_IMAGE',
  /** A lesson-plan PDF a workout was imported from, kept as uploaded for reference. */
  WORKOUT_PDF = 'WORKOUT_PDF',
  /**
   * A profile picture as people see it: square WebP crops of a PROFILE_PHOTO_ORIGINAL. Public
   * (shown next to names, e.g. on leaderboards) under a new random id each time the crop changes,
   * so a URL never changes content and caches for good.
   */
  PROFILE_PHOTO = 'PROFILE_PHOTO',
  /**
   * The picture a profile photo was cropped from (upright, metadata removed, at most 2048 px),
   * kept so its owner can change the crop later. Private: only its owner gets it, from the API.
   */
  PROFILE_PHOTO_ORIGINAL = 'PROFILE_PHOTO_ORIGINAL',
}

export type MediaArea = 'public' | 'private';

export interface MediaKindSettings {
  area: MediaArea;
  /** Folder in the area's storage; each item gets `<folder>/<id>/`. */
  folder: string;
}

export const MEDIA_KINDS: Record<MediaKind, MediaKindSettings> = {
  [MediaKind.ARTICLE_IMAGE]: { area: 'public', folder: 'article-images' },
  [MediaKind.WORKOUT_PDF]: { area: 'private', folder: 'workout-pdfs' },
  [MediaKind.PROFILE_PHOTO]: { area: 'public', folder: 'profile-photos' },
  [MediaKind.PROFILE_PHOTO_ORIGINAL]: {
    area: 'private',
    folder: 'profile-photo-originals',
  },
};

/** The folder of one item, e.g. "workout-pdfs/<id>". */
export function itemFolder(kind: MediaKind, id: string): string {
  return `${MEDIA_KINDS[kind].folder}/${id}`;
}

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** The content type of a stored file, from its extension. */
export function contentTypeOf(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * A `Content-Disposition` header that shows the file in the browser under its original name:
 * an ASCII fallback for old clients plus the UTF-8 name (RFC 6266), e.g. Cyrillic file names.
 */
export function inlineDisposition(filename: string): string {
  // Control characters, path separators and quotes have no place in a header's file name.
  // eslint-disable-next-line no-control-regex
  const clean = filename.replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim();
  const name = clean || 'file';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
