import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug.util';
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CategoryDescription,
  CategoryName,
  CategorySlug,
  CategorySortOrder,
} from './category-fields';

/** Fields that are sent are validated, so `null` is a 400 for them (not just skipped). */
const IfPresent = () => ValidateIf((_, value) => value !== undefined);

/**
 * Every field is optional. Renaming keeps the slug: change `slug` explicitly to move the page.
 * Only `description` can be `null` (to remove it).
 */
export class UpdateArticleCategoryDto {
  @ApiPropertyOptional({ maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IfPresent()
  @CategoryName()
  name?: string;

  @ApiPropertyOptional({ maxLength: SLUG_MAX_LENGTH })
  @IfPresent()
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
  @IfPresent()
  @CategorySortOrder()
  sortOrder?: number;
}
