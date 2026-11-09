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
