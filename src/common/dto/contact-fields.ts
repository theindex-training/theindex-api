import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  PHONE_MAX_LENGTH,
  PHONE_PATTERN,
  SOCIAL_LINK_MAX_LENGTH,
  SocialNetwork,
} from '../utils/contact.util';

const PHONE_MESSAGE =
  'phone must be a phone number: 6 to 15 digits, optionally starting with +';

/**
 * A phone number field (`PHONE_PATTERN`):
 * - `required`: must be sent;
 * - `optional`: may be left out, or null to clear it;
 * - `keep`: may be left out (kept as it is), but never cleared (null is a 400).
 */
export function PhoneField(mode: 'required' | 'optional' | 'keep') {
  const doc = {
    example: '+359 88 123 4567',
    maxLength: PHONE_MAX_LENGTH,
    description: '6 to 15 digits, optionally starting with +',
  };
  const checks = [
    IsString(),
    MaxLength(PHONE_MAX_LENGTH),
    Matches(PHONE_PATTERN, { message: PHONE_MESSAGE }),
  ];
  switch (mode) {
    case 'required':
      return applyDecorators(ApiProperty(doc), ...checks);
    case 'optional':
      return applyDecorators(
        ApiPropertyOptional({ ...doc, nullable: true }),
        IsOptional(),
        ...checks,
      );
    case 'keep':
      return applyDecorators(
        ApiPropertyOptional(doc),
        ValidateIf((_, value) => value !== undefined),
        ...checks,
      );
  }
}

/** A social network profile: a handle or a link, as typed; empty or null clears it. */
export function SocialLinkField(network: SocialNetwork) {
  return applyDecorators(
    ApiPropertyOptional({
      example: network === 'facebook' ? 'https://facebook.com/ivan' : '@ivan',
      maxLength: SOCIAL_LINK_MAX_LENGTH,
      nullable: true,
      description: `The person's ${network} profile: a handle or a link`,
    }),
    IsOptional(),
    IsString(),
    MaxLength(SOCIAL_LINK_MAX_LENGTH),
  );
}
