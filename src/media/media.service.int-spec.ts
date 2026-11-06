import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { MediaEntity } from './media.entity';
import { MediaModule } from './media.module';
import { MediaService, UploadedImage } from './media.service';

const PUBLIC_URL = 'https://media.example.test';

async function jpeg(width: number, height: number): Promise<UploadedImage> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#aa3333' },
  })
    .jpeg()
    .toBuffer();
  return { buffer, originalname: 'photo.jpg', size: buffer.length };
}

describe('MediaService (integration)', () => {
  const env = { ...process.env };
  let storageDir: string;

  // The service reads its settings on first use, so they are set before the suite's module runs.
  beforeAll(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'media-int-'));
    process.env.MEDIA_STORAGE_DIR = storageDir;
    process.env.MEDIA_PUBLIC_URL = PUBLIC_URL;
  });

  afterAll(() => {
    process.env = env;
    rmSync(storageDir, { recursive: true, force: true });
  });

  const fixtures = setupIntegrationSuite({ extraImports: [MediaModule] });

  beforeEach(() => {
    for (const entry of readdirSync(storageDir)) {
      rmSync(join(storageDir, entry), { recursive: true, force: true });
    }
  });
  const svc = (fx: Fixtures) => fx.moduleRef.get(MediaService);
  const rows = (fx: Fixtures) => fx.ds.getRepository(MediaEntity).find();

  function admin(fx: Fixtures) {
    return fx.ds.getRepository(AccountEntity).save({
      email: 'admin@example.com',
      passwordHash: null,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
    });
  }

  it('stores the processed files under the new id and records them', async () => {
    const fx = fixtures();
    const account = await admin(fx);

    const media = await svc(fx).upload(
      await jpeg(1000, 500),
      { altText: 'Щанга на пода' },
      account.id,
    );

    expect(readdirSync(join(storageDir, media.id)).sort()).toEqual([
      'master.jpg',
      'og.jpg',
      'w480.webp',
      'w960.webp',
    ]);
    const [row] = await rows(fx);
    expect(row).toMatchObject({
      id: media.id,
      altText: 'Щанга на пода',
      masterPath: `${media.id}/master.jpg`,
      width: 1000,
      height: 500,
      variants: [
        { path: `${media.id}/w480.webp`, width: 480, height: 240 },
        { path: `${media.id}/w960.webp`, width: 960, height: 480 },
      ],
      ogPath: `${media.id}/og.jpg`,
      originalFilename: 'photo.jpg',
      uploadedByAccountId: account.id,
    });
    expect(row.sizeBytes).toBeGreaterThan(0);
  });

  it('answers with public URLs built from MEDIA_PUBLIC_URL', async () => {
    const fx = fixtures();
    const media = await svc(fx).upload(
      await jpeg(1000, 500),
      { altText: 'Alt' },
      null,
    );

    expect(media).toMatchObject({
      url: `${PUBLIC_URL}/${media.id}/master.jpg`,
      variants: [
        { url: `${PUBLIC_URL}/${media.id}/w480.webp`, width: 480, height: 240 },
        { url: `${PUBLIC_URL}/${media.id}/w960.webp`, width: 960, height: 480 },
      ],
      ogImage: {
        url: `${PUBLIC_URL}/${media.id}/og.jpg`,
        width: 1200,
        height: 630,
      },
      uploadedByAccountId: null,
    });
  });

  it('rejects a missing file and an unsupported one, writing nothing', async () => {
    const fx = fixtures();
    const text = Buffer.from('not an image');

    const missing = await rejectionOf(
      svc(fx).upload(undefined, { altText: 'Alt' }, null),
    );
    const notImage = await rejectionOf(
      svc(fx).upload(
        { buffer: text, size: text.length },
        { altText: 'Alt' },
        null,
      ),
    );

    expect(missing).toBeInstanceOf(BadRequestException);
    expect(missing.message).toBe('file is required');
    expect(notImage).toBeInstanceOf(BadRequestException);
    expect(notImage.message).toBe('The file is not a readable image');
    expect(await rows(fx)).toHaveLength(0);
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('removes the written files when the row cannot be saved', async () => {
    const fx = fixtures();
    // No such account: the foreign key makes the insert fail after the files are written.
    const missingAccount = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

    const error = await rejectionOf(
      svc(fx).upload(await jpeg(600, 400), { altText: 'Alt' }, missingAccount),
    );

    expect(error.message).toMatch(/foreign key/);
    expect(await rows(fx)).toHaveLength(0);
    expect(readdirSync(storageDir)).toEqual([]);
  });

  it('keeps the media when the uploading account is deleted', async () => {
    const fx = fixtures();
    const account = await admin(fx);
    const media = await svc(fx).upload(
      await jpeg(600, 400),
      { altText: 'Alt' },
      account.id,
    );

    await fx.ds.getRepository(AccountEntity).delete(account.id);

    const [row] = await rows(fx);
    expect(row).toMatchObject({ id: media.id, uploadedByAccountId: null });
  });

  it('lists the library newest first, a page at a time', async () => {
    const fx = fixtures();
    const uploaded: string[] = [];
    for (const alt of ['first', 'second', 'third']) {
      uploaded.push(
        (await svc(fx).upload(await jpeg(500, 500), { altText: alt }, null)).id,
      );
    }

    const page1 = await svc(fx).list({ page: 1, pageSize: 2 });
    const page2 = await svc(fx).list({ page: 2, pageSize: 2 });

    expect(page1).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page1.items.map((m) => m.altText)).toEqual(['third', 'second']);
    expect(page2.items.map((m) => m.altText)).toEqual(['first']);
    expect(page2.items[0].id).toBe(uploaded[0]);
  });

  it('uses page 1 and 24 items by default', async () => {
    const fx = fixtures();
    await svc(fx).upload(await jpeg(500, 500), { altText: 'only' }, null);

    expect(await svc(fx).list({})).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 24,
    });
  });

  it('gets one item and changes its alt text', async () => {
    const fx = fixtures();
    const media = await svc(fx).upload(
      await jpeg(500, 500),
      { altText: 'old' },
      null,
    );

    const updated = await svc(fx).update(media.id, { altText: 'new' });

    expect(updated.altText).toBe('new');
    expect((await svc(fx).get(media.id)).altText).toBe('new');
  });

  it('answers 404 for an unknown id', async () => {
    const fx = fixtures();
    const unknown = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

    expect(await rejectionOf(svc(fx).get(unknown))).toBeInstanceOf(
      NotFoundException,
    );
    expect(
      await rejectionOf(svc(fx).update(unknown, { altText: 'x' })),
    ).toBeInstanceOf(NotFoundException);
  });

  it('answers 503 without writing anything when production settings are missing', async () => {
    const fx = fixtures();
    process.env.NODE_ENV = 'production';
    delete process.env.MEDIA_STORAGE_DIR;
    delete process.env.MEDIA_PUBLIC_URL;
    try {
      // A fresh service: the suite's one has already read its settings.
      const unconfigured = new MediaService(fx.ds.getRepository(MediaEntity));

      const error = await rejectionOf(
        unconfigured.upload(await jpeg(500, 500), { altText: 'Alt' }, null),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toBe('Media storage is not configured');
      expect(await rows(fx)).toHaveLength(0);
      expect(readdirSync(storageDir)).toEqual([]);
      expect(existsSync(resolve('media-storage'))).toBe(false);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      process.env.MEDIA_STORAGE_DIR = storageDir;
      process.env.MEDIA_PUBLIC_URL = PUBLIC_URL;
    }
  });
});
