import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { SLUG_MAX_LENGTH } from '../../common/utils/slug.util';
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CategoryDescription,
  CategoryName,
  CategorySlug,
  CategorySortOrder,
} from './category-fields';

export class CreateArticleCategoryDto {
  @ApiProperty({
    example: 'Силова подготовка',
    maxLength: CATEGORY_NAME_MAX_LENGTH,
  })
  @CategoryName()
  name!: string;

  @ApiPropertyOptional({
    example: 'silova-podgotovka',
    maxLength: SLUG_MAX_LENGTH,
    description:
      'Defaults to the transliterated name, made unique with -2, -3, ... if needed',
  })
  @IsOptional()
  @CategorySlug()
  slug?: string;

  @ApiPropertyOptional({ maxLength: CATEGORY_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @CategoryDescription()
  description?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Defaults to after the last category',
  })
  @IsOptional()
  @CategorySortOrder()
  sortOrder?: number;
}
