import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { MediaEntity } from '../media/media.entity';
import { ArticleCategoryLinkEntity } from './article-category-link.entity';
import { ArticlePublishingService } from './article-publishing.service';
import { ArticleEntity } from './article.entity';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';

@Module({
  // Media and categories: publishing checks that the images and categories an article uses
  // exist, and the published featured image and category links are foreign keys to them.
  imports: [
    TypeOrmModule.forFeature([
      ArticleEntity,
      ArticleCategoryLinkEntity,
      ArticleCategoryEntity,
      MediaEntity,
    ]),
  ],
  controllers: [ArticlesController],
  providers: [ArticlesService, ArticlePublishingService],
  exports: [ArticlesService, ArticlePublishingService],
})
export class ArticlesModule {}
