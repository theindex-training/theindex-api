import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, relative, resolve, sep } from 'path';

/**
 * Where media files live. Today a folder on the VPS (a Docker volume served by nginx at
 * media.theindex.training); an S3-compatible implementation can replace it later without
 * touching the service (theindex-web docs/decision-record.md, D9).
 *
 * Paths are relative and use "/" (e.g. "<media id>/w480.webp"); the public URL is
 * `${MEDIA_PUBLIC_URL}/${path}`.
 */
export interface MediaStorage {
  write(path: string, data: Buffer): Promise<void>;
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
