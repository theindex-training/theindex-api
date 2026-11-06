import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ListPublicArticlesQueryDto } from './dto/list-public-articles.query.dto';
import { PublicContentService } from './public-content.service';

/**
 * Published articles for the public site. No guard on purpose: these routes only ever read
 * published content (see PublicContentService), and they live apart from the admin controllers
 * so a missing guard there can never expose a draft.
 */
@ApiTags('public')
@Controller('public/articles')
export class PublicArticlesController {
  constructor(private readonly service: PublicContentService) {}

  @Get()
  list(@Query() q: ListPublicArticlesQueryDto) {
    return this.service.listArticles(q);
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.service.getArticle(slug);
  }
}
