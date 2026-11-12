import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export const EXERCISE_NAME_MAX_LENGTH = 80;
export const EXERCISE_ALIASES_MAX = 20;
export const EXERCISE_DESCRIPTION_MAX_LENGTH = 2000;
export const EXERCISE_VIDEO_URL_MAX_LENGTH = 300;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const trimEach = Transform(({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v: unknown) => (typeof v === 'string' ? v.trim() : v))
    : value,
);

/** Name: trimmed, 1-80 characters. */
export function ExerciseName() {
  return applyDecorators(
    trim,
    IsString(),
    IsNotEmpty({ message: 'name must not be empty' }),
    MaxLength(EXERCISE_NAME_MAX_LENGTH),
  );
}

/** Other spellings: up to 20, each trimmed, 1-80 characters. */
export function ExerciseAliases() {
  return applyDecorators(
    trimEach,
    IsArray(),
    ArrayMaxSize(EXERCISE_ALIASES_MAX),
    IsString({ each: true }),
    IsNotEmpty({ each: true, message: 'aliases must not be empty' }),
    MaxLength(EXERCISE_NAME_MAX_LENGTH, { each: true }),
  );
}

/** Description: trimmed, at most 2000 characters; empty or null removes it. */
export function ExerciseDescription() {
  return applyDecorators(
    trim,
    IsString(),
    MaxLength(EXERCISE_DESCRIPTION_MAX_LENGTH),
  );
}

/**
 * Video link: trimmed, at most 300 characters; empty or null removes it. That it is a YouTube
 * video is checked by the service (youtube-url.ts), which stores it in one form.
 */
export function ExerciseVideoUrl() {
  return applyDecorators(
    trim,
    IsString(),
    MaxLength(EXERCISE_VIDEO_URL_MAX_LENGTH),
  );
}
