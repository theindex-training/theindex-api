import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalMediaStorage } from './media-storage';

describe('LocalMediaStorage', () => {
  let root: string;
  let storage: LocalMediaStorage;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'media-storage-'));
    storage = new LocalMediaStorage(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes files into folders under the root, creating them', async () => {
    await storage.write('abc/w480.webp', Buffer.from('data'));
    expect(readFileSync(join(root, 'abc', 'w480.webp'), 'utf8')).toBe('data');
  });

  it('opens a stored file to stream it, and gives null for a missing one', async () => {
    await storage.write('workout-pdfs/abc/original.pdf', Buffer.from('%PDF-1'));

    const file = await storage.open('workout-pdfs/abc/original.pdf');
    const chunks: Buffer[] = [];
    for await (const chunk of file!.stream) chunks.push(chunk as Buffer);

    expect(file!.size).toBe(6);
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1');
    expect(await storage.open('workout-pdfs/abc/missing.pdf')).toBeNull();
    // A folder is not a file.
    expect(await storage.open('workout-pdfs/abc')).toBeNull();
  });

  it('removes a folder with everything in it', async () => {
    await storage.write('abc/master.jpg', Buffer.from('a'));
    await storage.write('abc/og.jpg', Buffer.from('b'));
    await storage.write('other/og.jpg', Buffer.from('c'));

    await storage.removeFolder('abc');

    expect(existsSync(join(root, 'abc'))).toBe(false);
    expect(existsSync(join(root, 'other', 'og.jpg'))).toBe(true);
  });

  it('does not fail when removing a folder that does not exist', async () => {
    await expect(storage.removeFolder('missing')).resolves.toBeUndefined();
  });

  it('refuses paths outside the root, and the root itself', async () => {
    for (const path of ['../escape.jpg', 'abc/../../escape.jpg', '/etc/x']) {
      await expect(storage.write(path, Buffer.from('x'))).rejects.toThrow(
        'escapes the storage folder',
      );
    }
    await expect(storage.open('../escape.pdf')).rejects.toThrow(
      'escapes the storage folder',
    );
    await expect(storage.removeFolder('')).rejects.toThrow(
      'escapes the storage folder',
    );
    await expect(storage.removeFolder('.')).rejects.toThrow(
      'escapes the storage folder',
    );
    expect(existsSync(root)).toBe(true);
  });
});
