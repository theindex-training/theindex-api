import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';
import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Profile photos over HTTP (`/api/my-profile/photo`): the multipart upload with the crop as form
 * fields, the JSON re-crop, the kept picture and removal. Processing, storage and replacement are
 * covered in `src/profile-photos/profile-photos.service.int-spec.ts`; who may call which route is
 * in the role matrix.
 */
const storageDir = mkdtempSync(join(tmpdir(), 'photos-e2e-'));
const privateDir = mkdtempSync(join(tmpdir(), 'photos-e2e-private-'));
process.env.MEDIA_STORAGE_DIR = storageDir;
process.env.MEDIA_PUBLIC_URL = 'https://media.e2e.test';
process.env.MEDIA_PRIVATE_STORAGE_DIR = privateDir;

type PhotoBody = {
  url: string;
  thumbnailUrl: string;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
};

describe('Profile photos (e2e)', () => {
  const ctx = setupE2eSuite();

  let picture: Buffer;
  beforeAll(async () => {
    picture = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#2255aa' },
    })
      .jpeg()
      .toBuffer();
  });

  afterAll(() => {
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(privateDir, { recursive: true, force: true });
  });

  async function trainee() {
    const c = ctx();
    const profile = await c.trainee('Ivan Petrov');
    return c.provisionAndLogin('trainee', profile.id);
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('takes a picture with the chosen square as form fields, and shows it in My details', async () => {
    const c = ctx();
    const token = await trainee();

    const res = await c
      .http()
      .put('/api/my-profile/photo')
      .set(auth(token))
      .field('x', '0.25')
      .field('y', '0')
      .field('width', '0.6666')
      .field('height', '1')
      .field('rotation', '0')
      .attach('file', picture, 'me.jpg')
      .expect(200);
    const photo = res.body as PhotoBody;

    expect(photo).toMatchObject({
      url: expect.stringMatching(
        /^https:\/\/media\.e2e\.test\/profile-photos\/[0-9a-f-]{36}\/s512\.webp$/,
      ) as string,
      thumbnailUrl: expect.stringMatching(/\/s128\.webp$/) as string,
      crop: { x: 0.25, y: 0, width: 0.6666, height: 1, rotation: 0 },
    });

    const me = await c
      .http()
      .get('/api/my-profile')
      .set(auth(token))
      .expect(200);
    expect((me.body as { photo: PhotoBody }).photo).toEqual(photo);
  });

  it('re-crops with JSON, gives the kept picture back uncached, and removes the photo', async () => {
    const c = ctx();
    const token = await trainee();
    await c
      .http()
      .put('/api/my-profile/photo')
      .set(auth(token))
      .field('x', '0')
      .field('y', '0')
      .field('width', '0.6666')
      .field('height', '1')
      .field('rotation', '0')
      .attach('file', picture, 'me.jpg')
      .expect(200);

    const turned = await c
      .http()
      .patch('/api/my-profile/photo')
      .set(auth(token))
      .send({ x: 0, y: 0.25, width: 1, height: 0.6666, rotation: 90 })
      .expect(200);
    expect((turned.body as PhotoBody).crop.rotation).toBe(90);

    const original = await c
      .http()
      .get('/api/my-profile/photo/original')
      .set(auth(token))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (chunk: Buffer) => chunks.push(chunk));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(original.headers['content-type']).toBe('image/jpeg');
    expect(original.headers['cache-control']).toBe('private, no-store');
    const meta = await sharp(original.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([600, 400]);

    await c.http().delete('/api/my-profile/photo').set(auth(token)).expect(204);
    const me = await c.http().get('/api/my-profile').set(auth(token));
    expect((me.body as { photo: unknown }).photo).toBeNull();
    const gone = await c
      .http()
      .get('/api/my-profile/photo/original')
      .set(auth(token))
      .expect(404);
    expect(messageOf(gone.body)).toBe('You have no profile photo');
  });

  it('checks the crop fields (400)', async () => {
    const c = ctx();
    const token = await trainee();

    const res = await c
      .http()
      .put('/api/my-profile/photo')
      .set(auth(token))
      .field('x', '1.5')
      .field('y', 'top')
      .field('width', '0.5')
      .field('height', '0.5')
      .field('rotation', '45')
      .attach('file', picture, 'me.jpg')
      .expect(400);
    expect(messageOf(res.body)).toEqual(
      expect.arrayContaining([
        'x must not be greater than 1',
        'y must be a number conforming to the specified constraints',
        'rotation must be one of the following values: 0, 90, 180, 270',
      ]),
    );

    const unknown = await c
      .http()
      .patch('/api/my-profile/photo')
      .set(auth(token))
      .send({ x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 2 })
      .expect(400);
    expect(messageOf(unknown.body)).toEqual(['property zoom should not exist']);
  });
});
