import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PreviewQueryDto } from './dto/preview.query.dto';
import { PublicContentService } from './public-content.service';

/** The sitemap feed and the draft preview of the public site. */
@ApiTags('public')
@Controller('public')
export class PublicSiteController {
  constructor(private readonly service: PublicContentService) {}

  @Get('sitemap')
  sitemap() {
    return this.service.sitemap();
  }

  /** The draft an admin is previewing; the token comes from POST /api/articles/:id/preview-token. */
  @Get('preview')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex')
  preview(@Query() q: PreviewQueryDto) {
    return this.service.preview(q.token);
  }
}
