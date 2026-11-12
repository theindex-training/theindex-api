import { resolve } from 'path';
import { loadMediaConfig, loadPrivateMediaConfig } from './media.config';

const PRODUCTION = {
  MEDIA_STORAGE_DIR: '/data/media',
  MEDIA_PUBLIC_URL: 'https://media.theindex.training',
};

describe('loadMediaConfig', () => {
  it('reads the production settings', () => {
    expect(loadMediaConfig(PRODUCTION, { production: true })).toEqual({
      storageDir: '/data/media',
      publicUrl: 'https://media.theindex.training',
      maxUploadBytes: 15 * 1024 * 1024,
    });
  });

  it('requires the folder and the public URL in production, naming each', () => {
    expect(() => loadMediaConfig({}, { production: true })).toThrow(
      'MEDIA_STORAGE_DIR is required; MEDIA_PUBLIC_URL is required',
    );
    expect(() =>
      loadMediaConfig(
        { ...PRODUCTION, MEDIA_PUBLIC_URL: '  ' },
        { production: true },
      ),
    ).toThrow('MEDIA_PUBLIC_URL is required');
  });

  it('uses a local folder served by the API in development', () => {
    expect(loadMediaConfig({}, { production: false })).toEqual({
      storageDir: resolve('media-storage'),
      publicUrl: 'http://localhost:3000/media-files',
      maxUploadBytes: 15 * 1024 * 1024,
    });
  });

  it('resolves a relative folder and drops a trailing slash from the URL', () => {
    const config = loadMediaConfig(
      {
        MEDIA_STORAGE_DIR: 'tmp/media',
        MEDIA_PUBLIC_URL: 'https://cdn.test/m/',
      },
      { production: true },
    );
    expect(config.storageDir).toBe(resolve('tmp/media'));
    expect(config.publicUrl).toBe('https://cdn.test/m');
  });

  it('rejects a public URL that is not absolute http(s)', () => {
    expect(() =>
      loadMediaConfig(
        { ...PRODUCTION, MEDIA_PUBLIC_URL: 'media.theindex.training' },
        { production: true },
      ),
    ).toThrow('MEDIA_PUBLIC_URL must be an absolute http(s) URL');
    expect(() =>
      loadMediaConfig(
        { ...PRODUCTION, MEDIA_PUBLIC_URL: 'ftp://media.theindex.training' },
        { production: true },
      ),
    ).toThrow('MEDIA_PUBLIC_URL must be an absolute http(s) URL');
  });

  it('reads the upload limit in whole megabytes', () => {
    expect(
      loadMediaConfig(
        { ...PRODUCTION, MEDIA_MAX_UPLOAD_MB: '5' },
        { production: true },
      ).maxUploadBytes,
    ).toBe(5 * 1024 * 1024);

    for (const bad of ['0', '-1', '2.5', 'ten']) {
      expect(() =>
        loadMediaConfig(
          { ...PRODUCTION, MEDIA_MAX_UPLOAD_MB: bad },
          { production: true },
        ),
      ).toThrow('MEDIA_MAX_UPLOAD_MB must be a whole number');
    }
  });
});

describe('loadPrivateMediaConfig', () => {
  it('reads the private folder in production', () => {
    expect(
      loadPrivateMediaConfig(
        { ...PRODUCTION, MEDIA_PRIVATE_STORAGE_DIR: '/data/media-private' },
        { production: true },
      ),
    ).toEqual({ storageDir: '/data/media-private' });
  });

  it('requires it in production, and defaults to a local folder in development', () => {
    expect(() =>
      loadPrivateMediaConfig(
        { ...PRODUCTION, MEDIA_PRIVATE_STORAGE_DIR: ' ' },
        { production: true },
      ),
    ).toThrow('MEDIA_PRIVATE_STORAGE_DIR is required');
    expect(loadPrivateMediaConfig({}, { production: false })).toEqual({
      storageDir: resolve('media-storage-private'),
    });
  });

  it('refuses a private folder inside the public one, the public one itself, or one containing it', () => {
    for (const dir of ['/data/media', '/data/media/private', '/data', '/']) {
      expect(() =>
        loadPrivateMediaConfig(
          { ...PRODUCTION, MEDIA_PRIVATE_STORAGE_DIR: dir },
          { production: true },
        ),
      ).toThrow('MEDIA_PRIVATE_STORAGE_DIR must be outside MEDIA_STORAGE_DIR');
    }
    // Development: checked against the public default (./media-storage) too.
    expect(() =>
      loadPrivateMediaConfig(
        { MEDIA_PRIVATE_STORAGE_DIR: 'media-storage/private' },
        { production: false },
      ),
    ).toThrow('MEDIA_PRIVATE_STORAGE_DIR must be outside MEDIA_STORAGE_DIR');
  });

  it('accepts a sibling whose name starts like the public folder', () => {
    expect(
      loadPrivateMediaConfig(
        { ...PRODUCTION, MEDIA_PRIVATE_STORAGE_DIR: '/data/media-private' },
        { production: true },
      ).storageDir,
    ).toBe('/data/media-private');
    expect(
      loadPrivateMediaConfig(
        { MEDIA_PRIVATE_STORAGE_DIR: '/srv/private' },
        { production: true },
      ).storageDir,
    ).toBe('/srv/private');
  });
});
