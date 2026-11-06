import sharp from 'sharp';

/**
 * Turns an upload into the files we store (theindex-web docs/decision-record.md, section 6):
 * - a master: upright (EXIF orientation applied), at most MASTER_MAX_SIZE px on its longer side,
 *   in the upload's format, **without metadata** (phone photos carry GPS position, camera serial);
 * - WebP variants at VARIANT_WIDTHS (only those not wider than the master) for `srcset`;
 * - a 1200×630 JPEG crop for social previews (Open Graph), used when it is a featured image.
 *
 * sharp drops all metadata (EXIF, XMP, IPTC) from its output unless asked to keep it.
 */

export const SUPPORTED_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export const VARIANT_WIDTHS = [480, 960, 1600, 2400] as const;
export const MASTER_MAX_SIZE = 4096;
export const OG_SIZE = { width: 1200, height: 630 } as const;

const MASTER_EXTENSION: Record<SupportedFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

export interface ProcessedFile {
  /** File name inside the media item's folder, e.g. "w480.webp". */
  name: string;
  data: Buffer;
  width: number;
  height: number;
}

export interface ProcessedImage {
  format: SupportedFormat;
  master: ProcessedFile;
  variants: ProcessedFile[];
  og: ProcessedFile;
}

/** The upload isn't an image we accept (not decodable, or not JPEG/PNG/WebP). */
export class UnsupportedImageError extends Error {}

/** Variant widths for a master `width` px wide: the standard widths that fit, or the width itself. */
export function variantWidths(width: number): number[] {
  const fitting = VARIANT_WIDTHS.filter((w) => w <= width);
  return fitting.length ? fitting : [width];
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input).metadata());
  } catch {
    throw new UnsupportedImageError('The file is not a readable image');
  }
  if (!isSupported(format)) {
    throw new UnsupportedImageError(
      `Unsupported image format "${format}"; upload a JPEG, PNG or WebP image`,
    );
  }

  const upright = sharp(input).autoOrient().resize({
    width: MASTER_MAX_SIZE,
    height: MASTER_MAX_SIZE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const encoded =
    format === 'jpeg'
      ? upright.jpeg({ quality: 90, mozjpeg: true })
      : format === 'png'
        ? upright.png()
        : upright.webp({ quality: 90 });
  const master = await toFile(`master.${MASTER_EXTENSION[format]}`, encoded);

  const variants: ProcessedFile[] = [];
  for (const width of variantWidths(master.width)) {
    variants.push(
      await toFile(
        `w${width}.webp`,
        sharp(master.data).resize({ width }).webp({ quality: 80 }),
      ),
    );
  }

  const og = await toFile(
    'og.jpg',
    sharp(master.data)
      .resize({
        ...OG_SIZE,
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      // JPEG has no transparency; put transparent areas on white instead of black.
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 85, mozjpeg: true }),
  );

  return { format, master, variants, og };
}

function isSupported(format: string | undefined): format is SupportedFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(format ?? '');
}

async function toFile(
  name: string,
  image: sharp.Sharp,
): Promise<ProcessedFile> {
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  return { name, data, width: info.width, height: info.height };
}
