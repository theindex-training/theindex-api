import sharp from 'sharp';
import {
  UnsupportedImageError,
  processImage,
  variantWidths,
} from './media-processing';

/** A plain JPEG like a phone photo: EXIF with the camera make, GPS position and an orientation. */
function phonePhoto(width: number, height: number, orientation = 1) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 180, g: 40, b: 40 },
    },
  })
    .jpeg()
    .withMetadata({ orientation })
    .withExif({
      IFD0: { Make: 'TestCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '42/1 41/1 0/1' },
    })
    .toBuffer();
}

async function metaOf(data: Buffer) {
  return sharp(data).metadata();
}

describe('variantWidths', () => {
  it('uses the standard widths that fit the image', () => {
    expect(variantWidths(5000)).toEqual([480, 960, 1600, 2400]);
    expect(variantWidths(2400)).toEqual([480, 960, 1600, 2400]);
    expect(variantWidths(2000)).toEqual([480, 960, 1600]);
    expect(variantWidths(480)).toEqual([480]);
  });

  it('uses the image width itself when it is narrower than every standard width', () => {
    expect(variantWidths(300)).toEqual([300]);
  });
});

describe('processImage', () => {
  it('turns a sideways phone photo upright and removes its metadata', async () => {
    // Stored as 3000x2000 with orientation 6: shown as 2000x3000 (portrait).
    const input = await phonePhoto(3000, 2000, 6);
    expect((await metaOf(input)).exif).toBeDefined();

    const result = await processImage(input);

    expect(result.format).toBe('jpeg');
    expect(result.master).toMatchObject({
      name: 'master.jpg',
      width: 2000,
      height: 3000,
    });

    for (const file of [result.master, ...result.variants, result.og]) {
      const meta = await metaOf(file.data);
      expect(meta.exif).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
    }
  });

  it('makes WebP variants at the standard widths that fit, keeping the aspect ratio', async () => {
    const result = await processImage(await phonePhoto(3000, 2000, 6));

    expect(
      result.variants.map(({ name, width, height }) => ({
        name,
        width,
        height,
      })),
    ).toEqual([
      { name: 'w480.webp', width: 480, height: 720 },
      { name: 'w960.webp', width: 960, height: 1440 },
      { name: 'w1600.webp', width: 1600, height: 2400 },
    ]);
    for (const variant of result.variants) {
      const meta = await metaOf(variant.data);
      expect(meta.format).toBe('webp');
      expect([meta.width, meta.height]).toEqual([
        variant.width,
        variant.height,
      ]);
    }
  });

  it('makes a 1200x630 JPEG crop for social previews', async () => {
    const result = await processImage(await phonePhoto(3000, 2000, 6));
    const meta = await metaOf(result.og.data);

    expect(result.og).toMatchObject({
      name: 'og.jpg',
      width: 1200,
      height: 630,
    });
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630]);
  });

  it('shrinks a very large image to 4096 px on its longer side', async () => {
    const input = await sharp({
      create: { width: 5000, height: 1000, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();

    const result = await processImage(input);

    expect(result.master).toMatchObject({
      name: 'master.png',
      width: 4096,
      height: 819,
    });
    expect(result.variants.map((v) => v.width)).toEqual([480, 960, 1600, 2400]);
  });

  it('keeps a small image at its size, with one variant of that width', async () => {
    const input = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#336699' },
    })
      .webp()
      .toBuffer();

    const result = await processImage(input);

    expect(result.master).toMatchObject({
      name: 'master.webp',
      width: 300,
      height: 200,
    });
    expect(result.variants.map((v) => [v.name, v.width])).toEqual([
      ['w300.webp', 300],
    ]);
  });

  it('puts transparent areas on white in the social preview', async () => {
    const transparent = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const { og } = await processImage(transparent);
    const stats = await sharp(og.data).stats();

    expect(stats.channels.slice(0, 3).map((c) => Math.round(c.mean))).toEqual([
      255, 255, 255,
    ]);
  });

  it('rejects formats other than JPEG, PNG and WebP', async () => {
    const gif = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000000' },
    })
      .gif()
      .toBuffer();

    await expect(processImage(gif)).rejects.toThrow(UnsupportedImageError);
    await expect(processImage(gif)).rejects.toThrow(
      'Unsupported image format "gif"',
    );
  });

  it('rejects files that are not images', async () => {
    await expect(
      processImage(Buffer.from('definitely not an image')),
    ).rejects.toThrow('The file is not a readable image');
  });
});
