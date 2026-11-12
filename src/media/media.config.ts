import { isAbsolute, relative, resolve, sep } from 'path';

/**
 * Where uploaded media are stored and from where readers load them
 * (theindex-web docs/decision-record.md, D9 and section 11). There are two storage areas
 * (media-kind.ts): the public one, served by nginx at MEDIA_PUBLIC_URL, and the private one,
 * which only the API reads (MEDIA_PRIVATE_STORAGE_DIR, see loadPrivateMediaConfig).
 *
 * In production both MEDIA_STORAGE_DIR and MEDIA_PUBLIC_URL are required, but only media
 * requests fail without them (503): the API itself must keep starting, so a deploy that comes
 * before the compose file has the media settings can't take the gym app down.
 */
export interface MediaConfig {
  /** Folder the API writes files to, e.g. /data/media (a Docker volume). */
  storageDir: string;
  /** Public base URL of that folder, without a trailing slash, e.g. https://media.theindex.training */
  publicUrl: string;
  /** Largest accepted upload, in bytes. */
  maxUploadBytes: number;
}

export const DEFAULT_MAX_UPLOAD_MB = 15;

/** URL path under which the API serves the storage folder in development (see main.ts). */
export const DEV_MEDIA_ROUTE = '/media-files';

const DEV_STORAGE_DIR = 'media-storage';
const DEV_PRIVATE_STORAGE_DIR = 'media-storage-private';
const DEV_PUBLIC_URL = `http://localhost:3000${DEV_MEDIA_ROUTE}`;

type Env = Record<string, string | undefined>;

/**
 * Reads the media settings from `env`. Throws an Error naming every problem. In development,
 * storage defaults to ./media-storage, served by the API itself at /media-files.
 */
export function loadMediaConfig(
  env: Env,
  { production }: { production: boolean },
): MediaConfig {
  const problems: string[] = [];

  const storageDir =
    env.MEDIA_STORAGE_DIR?.trim() || (production ? '' : DEV_STORAGE_DIR);
  if (!storageDir) problems.push('MEDIA_STORAGE_DIR is required');

  const rawUrl =
    env.MEDIA_PUBLIC_URL?.trim() || (production ? '' : DEV_PUBLIC_URL);
  let publicUrl = '';
  if (!rawUrl) {
    problems.push('MEDIA_PUBLIC_URL is required');
  } else {
    publicUrl = parseHttpUrl(rawUrl) ?? '';
    if (!publicUrl) {
      problems.push(
        `MEDIA_PUBLIC_URL must be an absolute http(s) URL, got "${rawUrl}"`,
      );
    }
  }

  const rawMax = env.MEDIA_MAX_UPLOAD_MB?.trim();
  const maxMb = rawMax ? Number(rawMax) : DEFAULT_MAX_UPLOAD_MB;
  if (!Number.isInteger(maxMb) || maxMb < 1) {
    problems.push(
      `MEDIA_MAX_UPLOAD_MB must be a whole number of megabytes, 1 or more, got "${rawMax}"`,
    );
  }

  if (problems.length) {
    throw new Error(`Invalid media configuration: ${problems.join('; ')}`);
  }

  return {
    storageDir: resolve(storageDir),
    publicUrl,
    maxUploadBytes: maxMb * 1024 * 1024,
  };
}

/** The private storage area: files the API serves itself, behind a guard. */
export interface PrivateMediaConfig {
  /** Folder the API writes private files to, e.g. /data/media-private (a Docker volume). */
  storageDir: string;
}

/**
 * Reads the private area's setting. Throws an Error naming the problem. Required in production;
 * in development it defaults to ./media-storage-private.
 *
 * The folder must be outside the public one (and not contain it): anything inside the public
 * folder is on the web. This is checked against MEDIA_STORAGE_DIR (or its development default).
 */
export function loadPrivateMediaConfig(
  env: Env,
  { production }: { production: boolean },
): PrivateMediaConfig {
  const dir =
    env.MEDIA_PRIVATE_STORAGE_DIR?.trim() ||
    (production ? '' : DEV_PRIVATE_STORAGE_DIR);
  if (!dir) {
    throw new Error(
      'Invalid media configuration: MEDIA_PRIVATE_STORAGE_DIR is required',
    );
  }
  const storageDir = resolve(dir);

  const publicDir =
    env.MEDIA_STORAGE_DIR?.trim() || (production ? '' : DEV_STORAGE_DIR);
  if (publicDir && overlaps(storageDir, resolve(publicDir))) {
    throw new Error(
      'Invalid media configuration: MEDIA_PRIVATE_STORAGE_DIR must be outside MEDIA_STORAGE_DIR (and not contain it): files in MEDIA_STORAGE_DIR are public',
    );
  }
  return { storageDir };
}

/** One folder is the other or inside it. */
function overlaps(a: string, b: string): boolean {
  const inside = (child: string, parent: string) => {
    const rel = relative(parent, child);
    return (
      rel === '' ||
      (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    );
  };
  return inside(a, b) || inside(b, a);
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

/** The URL without a trailing slash, or undefined if it isn't an absolute http(s) URL. */
function parseHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
