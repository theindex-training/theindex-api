import sharp from 'sharp';
import {
  ProcessedFile,
  SUPPORTED_FORMATS,
  UnsupportedImageError,
} from './media-processing';

/**
 * Profile photos (media-kind.ts): the picture someone chose, kept privately as an "original",
 * and the square crops of it that people see.
 *
 * - The original is upright (EXIF orientation applied), at most PROFILE_ORIGINAL_MAX_SIZE px on
 *   its longer side, a JPEG **without metadata** (phone photos carry the GPS position). Its owner
 *   gets it back to change the crop.
 * - The crop is chosen in the browser as fractions of the picture after turning it by `rotation`
 *   degrees clockwise, so it doesn't depend on the size the browser showed it at. The server cuts
 *   it from the original itself (`cropArea`), so what is stored never depends on the client's
 *   canvas, and the same original can be cropped again.
 * - The crops are square WebPs at PROFILE_PHOTO_SIZES.
 */

export const PROFILE_ORIGINAL_MAX_SIZE = 2048;
/** Square sizes of a profile photo, smallest first: a thumbnail for lists, a large one. */
export const PROFILE_PHOTO_SIZES = [128, 512] as const;
/** The smallest area that can be chosen, in pixels of the original. */
export const PROFILE_PHOTO_MIN_CROP = 64;

export const PHOTO_ROTATIONS = [0, 90, 180, 270] as const;
export type PhotoRotation = (typeof PHOTO_ROTATIONS)[number];

/**
 * The chosen square: `x`, `y`, `width`, `height` are fractions (0–1) of the picture's width and
 * height after it is turned by `rotation` degrees clockwise.
 */
export interface PhotoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: PhotoRotation;
}

/** A square in pixels of the turned picture. */
export interface PixelSquare {
  left: number;
  top: number;
  size: number;
}

/** Rounding in the browser: a side may differ from the other by this much and still be square. */
const SQUARE_TOLERANCE = 0.02;
/** Fractions may overshoot 1 by this much (rounding); the square is moved back inside. */
const EDGE_TOLERANCE = 0.005;

/**
 * The square `crop` names on a picture of `width` × `height` px (before turning), or why it
 * can't be used: outside the picture, not square, or smaller than PROFILE_PHOTO_MIN_CROP.
 */
export function cropArea(
  width: number,
  height: number,
  crop: PhotoCrop,
): { area: PixelSquare } | { error: string } {
  const sideways = crop.rotation === 90 || crop.rotation === 270;
  const w = sideways ? height : width;
  const h = sideways ? width : height;

  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1 + EDGE_TOLERANCE ||
    crop.y + crop.height > 1 + EDGE_TOLERANCE
  ) {
    return { error: 'The selected area must be inside the picture' };
  }

  const areaWidth = crop.width * w;
  const areaHeight = crop.height * h;
  if (
    Math.abs(areaWidth - areaHeight) >
    Math.max(2, SQUARE_TOLERANCE * Math.max(areaWidth, areaHeight))
  ) {
    return { error: 'The selected area must be square' };
  }

  const size = Math.min(Math.round(Math.min(areaWidth, areaHeight)), w, h);
  if (size < PROFILE_PHOTO_MIN_CROP) {
    return {
      error: `The selected area is too small: choose at least ${PROFILE_PHOTO_MIN_CROP}×${PROFILE_PHOTO_MIN_CROP} pixels`,
    };
  }
  const left = Math.min(Math.round(crop.x * w), w - size);
  const top = Math.min(Math.round(crop.y * h), h - size);
  return { area: { left, top, size } };
}

/**
 * The private original of an uploaded picture: upright, at most PROFILE_ORIGINAL_MAX_SIZE px,
 * a JPEG without metadata (transparent areas on white). UnsupportedImageError for anything but
 * a readable JPEG, PNG or WebP.
 */
export async function profileOriginal(input: Buffer): Promise<ProcessedFile> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input).metadata());
  } catch {
    throw new UnsupportedImageError('The file is not a readable image');
  }
  if (!(SUPPORTED_FORMATS as readonly string[]).includes(format ?? '')) {
    throw new UnsupportedImageError(
      `Unsupported image format "${format}"; upload a JPEG, PNG or WebP image`,
    );
  }
  try {
    const { data, info } = await sharp(input)
      .autoOrient()
      .resize({
        width: PROFILE_ORIGINAL_MAX_SIZE,
        height: PROFILE_ORIGINAL_MAX_SIZE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      name: 'original.jpg',
      data,
      width: info.width,
      height: info.height,
    };
  } catch {
    // The header was fine but the pixels aren't: the client's file, not our error.
    throw new UnsupportedImageError('The image file is damaged or incomplete');
  }
}

/** The square WebPs of `area` of the original turned by `rotation`, smallest first. */
export async function profilePhotoFiles(
  original: Buffer,
  rotation: PhotoRotation,
  area: PixelSquare,
): Promise<ProcessedFile[]> {
  const turned = await sharp(original).rotate(rotation).toBuffer();
  const square = await sharp(turned)
    .extract({
      left: area.left,
      top: area.top,
      width: area.size,
      height: area.size,
    })
    .toBuffer();
  const files: ProcessedFile[] = [];
  for (const size of PROFILE_PHOTO_SIZES) {
    const data = await sharp(square)
      .resize({ width: size, height: size })
      .webp({ quality: 82 })
      .toBuffer();
    files.push({ name: `s${size}.webp`, data, width: size, height: size });
  }
  return files;
}
