import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicContentService } from './public-content.service';

/** Categories that have a published article, for the site's navigation and category pages. */
@ApiTags('public')
@Controller('public/article-categories')
export class PublicArticleCategoriesController {
  constructor(private readonly service: PublicContentService) {}

  @Get()
  list() {
    return this.service.listCategories();
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.service.getCategory(slug);
  }
}
