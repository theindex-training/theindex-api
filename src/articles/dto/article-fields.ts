import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

export const TITLE_MAX_LENGTH = 200;
export const EXCERPT_MAX_LENGTH = 300;
export const SEO_TITLE_MAX_LENGTH = 70;
export const SEO_DESCRIPTION_MAX_LENGTH = 160;
export const MAX_CATEGORIES = 10;

/** Trims strings; leaves everything else for the validators to judge. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** Validate when sent: a field that is present (null included) must pass. */
export const IfPresent = () => ValidateIf((_, value) => value !== undefined);

/** Validate when sent and not null: null clears the field. */
export const IfSet = () =>
  ValidateIf((_, value) => value !== undefined && value !== null);
