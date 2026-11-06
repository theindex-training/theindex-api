import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../common/utils/slug.util';

export const CATEGORY_NAME_MAX_LENGTH = 60;
export const CATEGORY_DESCRIPTION_MAX_LENGTH = 300;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

/** Name: trimmed, 1-60 characters. */
export function CategoryName() {
  return applyDecorators(
    trim,
    IsString(),
    IsNotEmpty({ message: 'name must not be empty' }),
    MaxLength(CATEGORY_NAME_MAX_LENGTH),
  );
}

/** Slug typed by an admin: lowercase Latin letters and digits joined by single hyphens. */
export function CategorySlug() {
  return applyDecorators(
    trim,
    IsString(),
    MaxLength(SLUG_MAX_LENGTH),
    Matches(SLUG_PATTERN, {
      message:
        'slug must be lowercase Latin letters and digits joined by single hyphens, e.g. "silova-podgotovka"',
    }),
  );
}

/** Description: trimmed, at most 300 characters; empty means none. */
export function CategoryDescription() {
  return applyDecorators(
    trim,
    IsString(),
    MaxLength(CATEGORY_DESCRIPTION_MAX_LENGTH),
  );
}

export function CategorySortOrder() {
  return applyDecorators(IsInt(), Min(0));
}
