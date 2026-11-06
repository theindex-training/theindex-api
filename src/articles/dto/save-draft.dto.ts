import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../common/utils/slug.util';
import {
  EXCERPT_MAX_LENGTH,
  IfPresent,
  IfSet,
  MAX_CATEGORIES,
  SEO_DESCRIPTION_MAX_LENGTH,
  SEO_TITLE_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  Trim,
} from './article-fields';

/**
 * Autosave: the fields that changed, plus the revision the client last saw. Only the structure
 * is checked here, so incomplete work can always be saved (an empty title, no blocks); the rules
 * for going live are checked on publish. `null` clears an optional field.
 */
export class SaveDraftDto {
  @ApiProperty({
    description:
      'The draftRevision the client last loaded or saved. A different current revision answers 409.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  baseRevision!: number;

  @ApiPropertyOptional({ maxLength: TITLE_MAX_LENGTH })
  @IfPresent()
  @Trim()
  @IsString()
  @MaxLength(TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: EXCERPT_MAX_LENGTH, nullable: true })
  @IfSet()
  @Trim()
  @IsString()
  @MaxLength(EXCERPT_MAX_LENGTH)
  excerpt?: string | null;

  @ApiPropertyOptional({
    description:
      'Editor.js output ({ time, blocks, version }). Checked and sanitized; see article-content.ts.',
    type: 'object',
    additionalProperties: true,
  })
  @IfPresent()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IfSet()
  @IsUUID()
  featuredMediaId?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_CATEGORIES })
  @IfPresent()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ maxLength: SEO_TITLE_MAX_LENGTH, nullable: true })
  @IfSet()
  @Trim()
  @IsString()
  @MaxLength(SEO_TITLE_MAX_LENGTH)
  seoTitle?: string | null;

  @ApiPropertyOptional({
    maxLength: SEO_DESCRIPTION_MAX_LENGTH,
    nullable: true,
  })
  @IfSet()
  @Trim()
  @IsString()
  @MaxLength(SEO_DESCRIPTION_MAX_LENGTH)
  seoDescription?: string | null;

  @ApiPropertyOptional({
    maxLength: SLUG_MAX_LENGTH,
    nullable: true,
    description:
      'A chosen slug, before the first publish only. null: generate it from the title when publishing.',
  })
  @IfSet()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  @Matches(SLUG_PATTERN, {
    message:
      'slug must be lowercase Latin letters and digits joined by single hyphens, e.g. "kak-da-zapochnem"',
  })
  slug?: string | null;
}
