/** A YouTube video id: 11 characters of letters, digits, "-" and "_". */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
]);

/**
 * The video id of a YouTube link, in any of the forms people paste: watch?v=, youtu.be/,
 * embed/, shorts/, live/ and v/. Null for anything else (another site, a channel, a playlist).
 */
export function youtubeVideoId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const path = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    id = path[0] ?? null;
  } else if (path[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (['embed', 'shorts', 'live', 'v'].includes(path[0])) {
    id = path[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The one form links are stored in: https://www.youtube.com/watch?v=<id>. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
