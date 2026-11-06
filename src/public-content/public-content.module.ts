import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { ArticleCategoryLinkEntity } from '../articles/article-category-link.entity';
import { ArticleEntity } from '../articles/article.entity';
import { MediaModule } from '../media/media.module';
import { PublicArticleCategoriesController } from './public-article-categories.controller';
import { PublicArticlesController } from './public-articles.controller';
import { PublicContentService } from './public-content.service';
import { PublicSiteController } from './public-site.controller';

/**
 * `/api/public/...`: what the public site (theindex-web) reads, without auth. Published content
 * only, plus the draft preview behind a signed token (theindex-web docs/decision-record.md,
 * section 8).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ArticleEntity,
      ArticleCategoryEntity,
      ArticleCategoryLinkEntity,
    ]),
    MediaModule,
  ],
  controllers: [
    PublicArticlesController,
    PublicArticleCategoriesController,
    PublicSiteController,
  ],
  providers: [PublicContentService],
})
export class PublicContentModule {}
