import sharp from 'sharp';
import { UnsupportedImageError } from './media-processing';
import {
  PROFILE_ORIGINAL_MAX_SIZE,
  cropArea,
  profileOriginal,
  profilePhotoFiles,
} from './profile-photo-processing';

describe('cropArea', () => {
  it('turns fractions of the picture into a square in pixels', () => {
    expect(
      cropArea(1000, 500, {
        x: 0.25,
        y: 0.1,
        width: 0.4,
        height: 0.8,
        rotation: 0,
      }),
    ).toEqual({ area: { left: 250, top: 50, size: 400 } });
  });

  it('measures a turned picture: a quarter turn swaps its width and height', () => {
    // 1000×500 turned by 90° is 500×1000: the square is 0.8 × 500 = 400 wide.
    expect(
      cropArea(1000, 500, {
        x: 0.1,
        y: 0.5,
        width: 0.8,
        height: 0.4,
        rotation: 90,
      }),
    ).toEqual({ area: { left: 50, top: 500, size: 400 } });
    expect(
      cropArea(1000, 500, {
        x: 0.25,
        y: 0.1,
        width: 0.4,
        height: 0.8,
        rotation: 180,
      }),
    ).toEqual({ area: { left: 250, top: 50, size: 400 } });
  });

  it("accepts the browser's rounding and keeps the square inside the picture", () => {
    // 401 × 400 px, ending a hair past the right edge.
    expect(
      cropArea(1000, 1000, {
        x: 0.6,
        y: 0,
        width: 0.401,
        height: 0.4,
        rotation: 0,
      }),
    ).toEqual({ area: { left: 600, top: 0, size: 400 } });
    expect(
      cropArea(1000, 1000, {
        x: 0.602,
        y: 0,
        width: 0.4,
        height: 0.4,
        rotation: 0,
      }),
    ).toEqual({ area: { left: 600, top: 0, size: 400 } });
  });

  it('refuses an area that is not square, outside the picture or too small', () => {
    const base = { x: 0, y: 0, rotation: 0 as const };
    expect(cropArea(1000, 500, { ...base, width: 0.5, height: 0.5 })).toEqual({
      error: 'The selected area must be square',
    });
    expect(
      cropArea(1000, 1000, { ...base, x: 0.7, width: 0.4, height: 0.4 }),
    ).toEqual({ error: 'The selected area must be inside the picture' });
    expect(cropArea(1000, 1000, { ...base, width: 0, height: 0 })).toEqual({
      error: 'The selected area must be inside the picture',
    });
    expect(
      cropArea(1000, 1000, { ...base, width: 0.063, height: 0.063 }),
    ).toEqual({
      error: 'The selected area is too small: choose at least 64×64 pixels',
    });
  });
});

describe('profile photo images', () => {
  /** A picture whose left half is red and right half blue, to see which part was cut. */
  async function halves(
    width: number,
    height: number,
    { sideways }: { sideways: boolean },
  ): Promise<Buffer> {
    const half = (color: string) =>
      sharp({
        create: {
          width: width / 2,
          height,
          channels: 3,
          background: color,
        },
      })
        .png()
        .toBuffer();
    const image = sharp({
      create: { width, height, channels: 3, background: '#000000' },
    })
      .composite([
        { input: await half('#ff0000'), left: 0, top: 0 },
        { input: await half('#0000ff'), left: width / 2, top: 0 },
      ])
      .jpeg({ quality: 95 });
    // Orientation 6: stored sideways, shown turned 90° clockwise.
    return (
      sideways
        ? image
            .withMetadata({ orientation: 6 })
            .withExifMerge({ IFD0: { Copyright: 'Someone' } })
        : image
    ).toBuffer();
  }

  async function averageColor(image: Buffer) {
    const { channels } = await sharp(image).stats();
    return channels.slice(0, 3).map((c) => Math.round(c.mean));
  }

  it('keeps an upright original without metadata, at most 2048 px', async () => {
    const original = await profileOriginal(
      await halves(4000, 2000, { sideways: true }),
    );
    const meta = await sharp(original.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect([original.width, original.height]).toEqual([
      PROFILE_ORIGINAL_MAX_SIZE / 2,
      PROFILE_ORIGINAL_MAX_SIZE,
    ]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('refuses anything but a readable JPEG, PNG or WebP', async () => {
    await expect(
      profileOriginal(Buffer.from('not an image')),
    ).rejects.toBeInstanceOf(UnsupportedImageError);
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    await expect(profileOriginal(gif)).rejects.toThrow(
      'Unsupported image format "gif"; upload a JPEG, PNG or WebP image',
    );
  });

  it('cuts the chosen square of the turned picture into 128 and 512 px WebPs', async () => {
    // 400×200, red on the left, blue on the right.
    const original = await halves(400, 200, { sideways: false });
    // Turned 180°, blue is on the left: the left square is blue.
    const files = await profilePhotoFiles(original, 180, {
      left: 0,
      top: 0,
      size: 200,
    });
    expect(files.map((f) => [f.name, f.width, f.height])).toEqual([
      ['s128.webp', 128, 128],
      ['s512.webp', 512, 512],
    ]);
    const [r, , b] = await averageColor(files[1].data);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(50);
    const meta = await sharp(files[0].data).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 128, 128]);
  });
});
