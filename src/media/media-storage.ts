import { mkdir, open, rm, writeFile } from 'fs/promises';
import { dirname, relative, resolve, sep } from 'path';
import { Readable } from 'stream';

/**
 * Where media files live. Today a folder on the VPS per storage area (media-kind.ts): the public
 * one is a Docker volume served by nginx at media.theindex.training, the private one a volume
 * nothing serves. An S3-compatible implementation can replace it later without touching the
 * service (theindex-web docs/decision-record.md, D9).
 *
 * Paths are relative and use "/" (e.g. "article-images/<media id>/w480.webp"); in the public
 * area the URL is `${MEDIA_PUBLIC_URL}/${path}`.
 */
export interface MediaStorage {
  write(path: string, data: Buffer): Promise<void>;
  /** A stored file, to stream it; null if it doesn't exist. */
  open(path: string): Promise<{ stream: Readable; size: number } | null>;
  /** Removes a media item's folder and everything in it; no error if it doesn't exist. */
  removeFolder(folder: string): Promise<void>;
}

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly rootDir: string) {}

  async write(path: string, data: Buffer): Promise<void> {
    const target = this.resolveInside(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async open(path: string): Promise<{ stream: Readable; size: number } | null> {
    const target = this.resolveInside(path);
    // Opened now, not when the stream is first read, so a file that is there is read whole even
    // if it is removed meanwhile; the stream closes the handle when it ends or is destroyed.
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(target, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const info = await handle.stat();
    if (!info.isFile()) {
      await handle.close();
      return null;
    }
    return { stream: handle.createReadStream(), size: info.size };
  }

  async removeFolder(folder: string): Promise<void> {
    await rm(this.resolveInside(folder), { recursive: true, force: true });
  }

  /** Absolute path for `path`; refuses anything that would leave the root folder. */
  private resolveInside(path: string): string {
    const root = resolve(this.rootDir);
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error(`Media path escapes the storage folder: "${path}"`);
    }
    return target;
  }
}
