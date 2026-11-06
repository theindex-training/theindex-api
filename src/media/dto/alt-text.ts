import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const ALT_TEXT_MAX_LENGTH = 250;

/** Alt text: trimmed, 1-250 characters. */
export function AltText() {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    IsNotEmpty({ message: 'altText must not be empty' }),
    MaxLength(ALT_TEXT_MAX_LENGTH),
  );
}
