import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Media over HTTP: the multipart upload (file + altText), its validation and size limit, and the
 * library endpoints. Processing and storage rules are covered in
 * `src/media/media-processing.spec.ts` and `src/media/media.service.int-spec.ts`; who may call
 * which route is in the role matrix.
 *
 * The settings are set before the app is built: multer reads the size limit when the module
 * starts (1 MB here, so the 413 test stays small). Jest gives each test file its own process.env.
 */
const storageDir = mkdtempSync(join(tmpdir(), 'media-e2e-'));
process.env.MEDIA_STORAGE_DIR = storageDir;
process.env.MEDIA_PUBLIC_URL = 'https://media.e2e.test';
process.env.MEDIA_MAX_UPLOAD_MB = '1';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

function jpeg(width = 800, height = 600) {
  return sharp({
    create: { width, height, channels: 3, background: '#cc4444' },
  })
    .jpeg()
    .toBuffer();
}

type MediaBody = {
  id: string;
  altText: string;
  url: string;
  width: number;
  height: number;
  variants: { url: string; width: number; height: number }[];
  ogImage: { url: string; width: number; height: number };
  originalFilename: string | null;
};

describe('Media (e2e)', () => {
  const ctx = setupE2eSuite();

  let photo: Buffer;
  beforeAll(async () => {
    photo = await jpeg();
  });

  afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

  function upload(token: string, altText = 'Клек с щанга') {
    return ctx()
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${token}`)
      .field('altText', altText)
      .attach('file', photo, 'klek.jpg');
  }

  it('uploads an image as multipart and answers with its URLs', async () => {
    const admin = await ctx().loginAsAdmin();

    const res = await upload(admin).expect(201);
    const body = res.body as MediaBody;

    expect(body).toMatchObject({
      altText: 'Клек с щанга',
      width: 800,
      height: 600,
      url: `https://media.e2e.test/${body.id}/master.jpg`,
      variants: [
        {
          url: `https://media.e2e.test/${body.id}/w480.webp`,
          width: 480,
          height: 360,
        },
      ],
      ogImage: {
        url: `https://media.e2e.test/${body.id}/og.jpg`,
        width: 1200,
        height: 630,
      },
      originalFilename: 'klek.jpg',
    });
    expect(readdirSync(join(storageDir, body.id)).sort()).toEqual([
      'master.jpg',
      'og.jpg',
      'w480.webp',
    ]);
  });

  it('trims the alt text and requires it', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();

    const trimmed = await upload(admin, '  Набиране  ').expect(201);
    expect((trimmed.body as MediaBody).altText).toBe('Набиране');

    const blank = await upload(admin, '   ').expect(400);
    expect(messageOf(blank.body)).toEqual(['altText must not be empty']);

    const missing = await c
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', photo, 'klek.jpg')
      .expect(400);
    expect(messageOf(missing.body)).toContain('altText must be a string');
  });

  it('rejects an upload without a file, or with a file that is not an image', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();

    const noFile = await c
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .field('altText', 'Alt')
      .expect(400);
    expect(messageOf(noFile.body)).toBe('file is required');

    const notImage = await c
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .field('altText', 'Alt')
      .attach('file', Buffer.from('plain text'), 'notes.txt')
      .expect(400);
    expect(messageOf(notImage.body)).toBe('The file is not a readable image');

    const truncated = await c
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .field('altText', 'Alt')
      .attach('file', photo.subarray(0, photo.length / 2), 'cut.jpg')
      .expect(400);
    expect(messageOf(truncated.body)).toBe(
      'The image file is damaged or incomplete',
    );
  });

  it('rejects unknown form fields', async () => {
    const admin = await ctx().loginAsAdmin();

    const res = await ctx()
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .field('altText', 'Alt')
      .field('caption', 'Captions belong to the article')
      .attach('file', photo, 'klek.jpg')
      .expect(400);
    expect(messageOf(res.body)).toEqual(['property caption should not exist']);
  });

  it('answers 413 for a file over MEDIA_MAX_UPLOAD_MB', async () => {
    const admin = await ctx().loginAsAdmin();

    const res = await ctx()
      .http()
      .post('/api/media')
      .set('Authorization', `Bearer ${admin}`)
      .field('altText', 'Alt')
      .attach('file', Buffer.alloc(1024 * 1024 + 1), 'big.jpg')
      .expect(413);
    expect(messageOf(res.body)).toBe('File too large');
  });

  it('lists, gets and updates media', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const auth = { Authorization: `Bearer ${admin}` };
    const first = (await upload(admin, 'first').expect(201)).body as MediaBody;
    await upload(admin, 'second').expect(201);

    const list = await c
      .http()
      .get('/api/media?page=1&pageSize=1')
      .set(auth)
      .expect(200);
    expect(list.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(
      (list.body as { items: MediaBody[] }).items.map((m) => m.altText),
    ).toEqual(['second']);

    const patched = await c
      .http()
      .patch(`/api/media/${first.id}`)
      .set(auth)
      .send({ altText: ' Нов текст ' })
      .expect(200);
    expect((patched.body as MediaBody).altText).toBe('Нов текст');

    const got = await c
      .http()
      .get(`/api/media/${first.id}`)
      .set(auth)
      .expect(200);
    expect((got.body as MediaBody).altText).toBe('Нов текст');
  });

  it('validates ids and paging', async () => {
    const c = ctx();
    const admin = await c.loginAsAdmin();
    const auth = { Authorization: `Bearer ${admin}` };

    await c.http().get(`/api/media/${UNKNOWN_ID}`).set(auth).expect(404);
    await c.http().get('/api/media/not-a-uuid').set(auth).expect(400);
    await c.http().get('/api/media?pageSize=51').set(auth).expect(400);
    await c.http().get('/api/media?page=0').set(auth).expect(400);
  });
});
