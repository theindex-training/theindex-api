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
import { MediaKind } from './media-kind';
import { MediaModule } from './media.module';
import { MediaService, UploadedMediaFile } from './media.service';

const PUBLIC_URL = 'https://media.example.test';

async function jpeg(width: number, height: number): Promise<UploadedMediaFile> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: '#aa3333' },
  })
    .jpeg()
    .toBuffer();
  return { buffer, originalname: 'photo.jpg', size: buffer.length };
}

function pdf(text = 'lesson plan'): UploadedMediaFile {
  const buffer = Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`);
  return { buffer, originalname: '261109.pdf', size: buffer.length };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

describe('MediaService (integration)', () => {
  const env = { ...process.env };
  let storageDir: string;
  let privateDir: string;

  // The service reads its settings on first use, so they are set before the suite's module runs.
  beforeAll(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'media-int-'));
    privateDir = mkdtempSync(join(tmpdir(), 'media-int-private-'));
    process.env.MEDIA_STORAGE_DIR = storageDir;
    process.env.MEDIA_PUBLIC_URL = PUBLIC_URL;
    process.env.MEDIA_PRIVATE_STORAGE_DIR = privateDir;
  });

  afterAll(() => {
    process.env = env;
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(privateDir, { recursive: true, force: true });
  });

  const fixtures = setupIntegrationSuite({ extraImports: [MediaModule] });

  beforeEach(() => {
    for (const dir of [storageDir, privateDir]) {
      for (const entry of readdirSync(dir)) {
        rmSync(join(dir, entry), { recursive: true, force: true });
      }
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

    expect(
      readdirSync(join(storageDir, 'article-images', media.id)).sort(),
    ).toEqual(['master.jpg', 'og.jpg', 'w480.webp', 'w960.webp']);
    const [row] = await rows(fx);
    const folder = `article-images/${media.id}`;
    expect(row).toMatchObject({
      id: media.id,
      kind: MediaKind.ARTICLE_IMAGE,
      altText: 'Щанга на пода',
      masterPath: `${folder}/master.jpg`,
      width: 1000,
      height: 500,
      variants: [
        { path: `${folder}/w480.webp`, width: 480, height: 240 },
        { path: `${folder}/w960.webp`, width: 960, height: 480 },
      ],
      ogPath: `${folder}/og.jpg`,
      originalFilename: 'photo.jpg',
      sha256: null,
      uploadedByAccountId: account.id,
    });
    // Nothing in the private area.
    expect(readdirSync(privateDir)).toEqual([]);
    expect(row.sizeBytes).toBeGreaterThan(0);
  });

  it('answers with public URLs built from MEDIA_PUBLIC_URL', async () => {
    const fx = fixtures();
    const media = await svc(fx).upload(
      await jpeg(1000, 500),
      { altText: 'Alt' },
      null,
    );

    const base = `${PUBLIC_URL}/article-images/${media.id}`;
    expect(media).toMatchObject({
      url: `${base}/master.jpg`,
      variants: [
        { url: `${base}/w480.webp`, width: 480, height: 240 },
        { url: `${base}/w960.webp`, width: 960, height: 480 },
      ],
      ogImage: {
        url: `${base}/og.jpg`,
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
    expect(readdirSync(join(storageDir, 'article-images'))).toEqual([]);
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
  it('still serves images uploaded before kinds existed, from their own paths', async () => {
    const fx = fixtures();
    // A row as the earlier schema wrote it: no kind given (the column default), files under <id>/.
    const id = '0b6d3f1e-2c4a-4b8e-9f10-1a2b3c4d5e6f';
    await fx.ds.query(
      `INSERT INTO "media" ("id", "altText", "masterPath", "width", "height", "variants", "ogPath", "sizeBytes")
       VALUES ($1, 'Old', $2, 800, 600, $3, $4, 1000)`,
      [
        id,
        `${id}/master.jpg`,
        JSON.stringify([{ path: `${id}/w480.webp`, width: 480, height: 360 }]),
        `${id}/og.jpg`,
      ],
    );

    const [old] = (await svc(fx).list({})).items;

    expect(old).toMatchObject({
      id,
      altText: 'Old',
      url: `${PUBLIC_URL}/${id}/master.jpg`,
      variants: [{ url: `${PUBLIC_URL}/${id}/w480.webp` }],
      ogImage: { url: `${PUBLIC_URL}/${id}/og.jpg` },
    });
  });

  describe('documents (private)', () => {
    it('stores a document as uploaded in the private area, never in the public one', async () => {
      const fx = fixtures();
      const account = await admin(fx);

      const doc = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        pdf(),
        account.id,
      );

      expect(doc).toEqual({
        id: doc.id,
        originalFilename: '261109.pdf',
        sizeBytes: pdf().buffer.length,
        uploadedAt: doc.uploadedAt,
      });
      expect(doc.uploadedAt).toBeInstanceOf(Date);
      expect(readdirSync(join(privateDir, 'workout-pdfs', doc.id))).toEqual([
        'original.pdf',
      ]);
      expect(readdirSync(storageDir)).toEqual([]);
      const [row] = await rows(fx);
      expect(row).toMatchObject({
        id: doc.id,
        kind: MediaKind.WORKOUT_PDF,
        masterPath: `workout-pdfs/${doc.id}/original.pdf`,
        altText: null,
        width: null,
        height: null,
        variants: null,
        ogPath: null,
        uploadedByAccountId: account.id,
      });
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('keeps the same file once, and a different one apart', async () => {
      const fx = fixtures();

      const first = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        pdf('Monday'),
        null,
      );
      const again = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        { ...pdf('Monday'), originalname: 'renamed.pdf' },
        null,
      );
      const other = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        pdf('Tuesday'),
        null,
      );

      expect(again).toEqual(first);
      expect(other.id).not.toBe(first.id);
      expect(await rows(fx)).toHaveLength(2);
      expect(readdirSync(join(privateDir, 'workout-pdfs')).sort()).toEqual(
        [first.id, other.id].sort(),
      );
    });

    it('opens a stored document with its type, name and size, by its own kind only', async () => {
      const fx = fixtures();
      const doc = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        pdf(),
        null,
      );
      const image = await svc(fx).upload(
        await jpeg(500, 500),
        { altText: 'Alt' },
        null,
      );

      const opened = await svc(fx).openDocument(MediaKind.WORKOUT_PDF, doc.id);

      expect(opened).toMatchObject({
        document: doc,
        contentType: 'application/pdf',
        filename: '261109.pdf',
        size: pdf().buffer.length,
      });
      expect(await readAll(opened.stream)).toBe(pdf().buffer.toString());
      // An article image is not a workout PDF.
      const wrongKind = await rejectionOf(
        svc(fx).openDocument(MediaKind.WORKOUT_PDF, image.id),
      );
      expect(wrongKind).toBeInstanceOf(NotFoundException);
      expect(wrongKind.message).toBe('File not found');
    });

    it('offers the id as the name when the upload had none, and answers 404 when the file is gone', async () => {
      const fx = fixtures();
      const doc = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        { ...pdf(), originalname: undefined },
        null,
      );

      const opened = await svc(fx).openDocument(MediaKind.WORKOUT_PDF, doc.id);
      expect(opened.filename).toBe(`${doc.id}.pdf`);
      opened.stream.destroy();

      rmSync(join(privateDir, 'workout-pdfs', doc.id), { recursive: true });
      expect(
        await rejectionOf(svc(fx).openDocument(MediaKind.WORKOUT_PDF, doc.id)),
      ).toBeInstanceOf(NotFoundException);
    });

    it('keeps documents out of the image library and the public site', async () => {
      const fx = fixtures();
      const doc = await svc(fx).storeDocument(
        MediaKind.WORKOUT_PDF,
        pdf(),
        null,
      );
      const image = await svc(fx).upload(
        await jpeg(500, 500),
        { altText: 'Alt' },
        null,
      );

      expect((await svc(fx).list({})).items.map((m) => m.id)).toEqual([
        image.id,
      ]);
      expect((await svc(fx).list({})).total).toBe(1);
      expect([
        ...(await svc(fx).publicMedia([doc.id, image.id])).keys(),
      ]).toEqual([image.id]);
      expect(await rejectionOf(svc(fx).get(doc.id))).toBeInstanceOf(
        NotFoundException,
      );
      expect(
        await rejectionOf(svc(fx).update(doc.id, { altText: 'x' })),
      ).toBeInstanceOf(NotFoundException);
    });

    it('answers 503 without the private folder in production, while images keep working', async () => {
      const fx = fixtures();
      process.env.NODE_ENV = 'production';
      delete process.env.MEDIA_PRIVATE_STORAGE_DIR;
      try {
        const unconfigured = new MediaService(fx.ds.getRepository(MediaEntity));

        const error = await rejectionOf(
          unconfigured.storeDocument(MediaKind.WORKOUT_PDF, pdf(), null),
        );
        const image = await unconfigured.upload(
          await jpeg(500, 500),
          { altText: 'Alt' },
          null,
        );

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.message).toBe('Media storage is not configured');
        expect((await rows(fx)).map((r) => r.id)).toEqual([image.id]);
        expect(readdirSync(privateDir)).toEqual([]);
        expect(existsSync(resolve('media-storage-private'))).toBe(false);
      } finally {
        process.env.NODE_ENV = env.NODE_ENV;
        process.env.MEDIA_PRIVATE_STORAGE_DIR = privateDir;
      }
    });
  });
});
