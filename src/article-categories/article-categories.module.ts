import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleCategoryLinkEntity } from '../articles/article-category-link.entity';
import { ArticleEntity } from '../articles/article.entity';
import { ArticleCategoriesController } from './article-categories.controller';
import { ArticleCategoriesService } from './article-categories.service';
import { ArticleCategoryEntity } from './article-category.entity';

@Module({
  // Articles and their category links: the slug lock and the cleanup on delete look at them.
  imports: [
    TypeOrmModule.forFeature([
      ArticleCategoryEntity,
      ArticleCategoryLinkEntity,
      ArticleEntity,
    ]),
  ],
  controllers: [ArticleCategoriesController],
  providers: [ArticleCategoriesService],
  exports: [ArticleCategoriesService],
})
export class ArticleCategoriesModule {}
