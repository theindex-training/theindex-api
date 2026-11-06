import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleCategoriesController } from './article-categories.controller';
import { ArticleCategoriesService } from './article-categories.service';
import { ArticleCategoryEntity } from './article-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ArticleCategoryEntity])],
  controllers: [ArticleCategoriesController],
  providers: [ArticleCategoriesService],
  exports: [ArticleCategoriesService],
})
export class ArticleCategoriesModule {}
