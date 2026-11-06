import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { ArticleEntity } from './article.entity';

/**
 * The **published** categories of an article (theindex-web docs/decision-record.md, section 6);
 * the draft keeps its own `categoryIds` until the next publish. Deleting either side removes the
 * link and nothing else.
 */
@Entity('article_category_links')
@Index(['categoryId'])
export class ArticleCategoryLinkEntity {
  @PrimaryColumn('uuid')
  articleId!: string;

  @PrimaryColumn('uuid')
  categoryId!: string;

  @ManyToOne(() => ArticleEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'articleId' })
  article?: ArticleEntity;

  @ManyToOne(() => ArticleCategoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'categoryId' })
  category?: ArticleCategoryEntity;
}
