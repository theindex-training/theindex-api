import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../articles/dto/article-fields';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug.util';

export const PUBLIC_ARTICLES_PAGE_SIZE_DEFAULT = 12;
export const PUBLIC_ARTICLES_PAGE_SIZE_MAX = 50;
/** Far beyond any real page; keeps the offset a sane number for Postgres. */
export const PUBLIC_ARTICLES_PAGE_MAX = 10_000;
export const SEARCH_MAX_LENGTH = 100;

export class ListPublicArticlesQueryDto {
  @ApiPropertyOptional({
    description:
      'Slug of a category: only its articles. An unknown slug gives an empty page.',
    maxLength: SLUG_MAX_LENGTH,
    example: 'trenirovki',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SLUG_MAX_LENGTH)
  category?: string;

  @ApiPropertyOptional({
    description:
      'Search: part of the title, excerpt or text, ignoring case. Blank means no search.',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PUBLIC_ARTICLES_PAGE_MAX,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_ARTICLES_PAGE_MAX)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PUBLIC_ARTICLES_PAGE_SIZE_MAX,
    default: PUBLIC_ARTICLES_PAGE_SIZE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PUBLIC_ARTICLES_PAGE_SIZE_MAX)
  pageSize?: number;
}
