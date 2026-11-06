import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, ValidateIf } from 'class-validator';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug.util';
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CategoryDescription,
  CategoryName,
  CategorySlug,
  CategorySortOrder,
} from './category-fields';

/** Every field is optional. Renaming keeps the slug: change `slug` explicitly to move the page. */
export class UpdateArticleCategoryDto {
  @ApiPropertyOptional({ maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsOptional()
  @CategoryName()
  name?: string;

  @ApiPropertyOptional({ maxLength: SLUG_MAX_LENGTH })
  @IsOptional()
  @CategorySlug()
  slug?: string;

  @ApiPropertyOptional({
    maxLength: CATEGORY_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    description: 'null or "" removes the description',
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @CategoryDescription()
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @CategorySortOrder()
  sortOrder?: number;
}
