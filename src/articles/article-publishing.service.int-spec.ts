import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { MediaEntity } from '../media/media.entity';
import { ArticleCategoryLinkEntity } from './article-category-link.entity';
import { ArticlePublishingService } from './article-publishing.service';
import { ArticleEntity, ArticleStatus } from './article.entity';
import { ArticlesModule } from './articles.module';
import { ArticlesService } from './articles.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

describe('ArticlePublishingService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [ArticlesModule] });
  const articles = (fx: Fixtures) => fx.moduleRef.get(ArticlesService);
  const publishing = (fx: Fixtures) =>
    fx.moduleRef.get(ArticlePublishingService);
  const row = (fx: Fixtures, id: string) =>
    fx.ds.getRepository(ArticleEntity).findOneByOrFail({ id });
  const linksOf = async (fx: Fixtures, articleId: string) =>
    (
      await fx.ds
        .getRepository(ArticleCategoryLinkEntity)
        .find({ where: { articleId } })
    )
      .map((l) => l.categoryId)
      .sort();

  function media(fx: Fixtures) {
    const id = randomUUID();
    return fx.ds.getRepository(MediaEntity).save({
      id,
      altText: 'Снимка',
      masterPath: `${id}/master.jpg`,
      width: 800,
      height: 600,
      variants: [],
      ogPath: `${id}/og.jpg`,
      originalFilename: null,
      sizeBytes: 1,
      uploadedByAccountId: null,
    });
  }

  function category(fx: Fixtures, name: string, slug: string) {
    return fx.ds.getRepository(ArticleCategoryEntity).save({
      language: 'bg',
      name,
      nameKey: name.toLowerCase(),
      slug,
      description: null,
      sortOrder: 0,
    });
  }

  const paragraph = (text: string) => ({
    blocks: [{ type: 'paragraph', data: { text } }],
  });

  /** A draft that can go live: a title and one paragraph, plus any other fields. */
  async function readyDraft(fx: Fixtures, title: string, extra: object = {}) {
    const created = await articles(fx).create({ title }, null);
    return articles(fx).saveDraft(
      created.id,
      { baseRevision: 0, content: paragraph('Текст'), ...extra },
      null,
    );
  }

  describe('publish', () => {
    it('copies the draft live, makes the slug from the title and links the categories', async () => {
      const fx = fixtures();
      const cover = await media(fx);
      const strength = await category(fx, 'Сила', 'sila');
      const draft = await readyDraft(fx, 'Как да започнем с КросФит', {
        excerpt: 'Кратко',
        content: {
          blocks: [
            { type: 'header', data: { text: 'Първо', level: 2 } },
            {
              type: 'paragraph',
              data: { text: 'Загрейте <b>добре</b> &amp; бавно.' },
            },
            { type: 'image', data: { mediaId: cover.id, caption: 'Клек' } },
          ],
        },
        featuredMediaId: cover.id,
        categoryIds: [strength.id],
        seoTitle: 'SEO заглавие',
      });

      const published = await publishing(fx).publish(draft.id, 1, null);

      expect(published).toMatchObject({
        status: ArticleStatus.PUBLISHED,
        slug: 'kak-da-zapochnem-s-krosfit',
        hasUnpublishedChanges: false,
        draftRevision: 1,
        published: {
          title: 'Как да започнем с КросФит',
          excerpt: 'Кратко',
          featuredMediaId: cover.id,
          seoTitle: 'SEO заглавие',
          categoryIds: [strength.id],
        },
      });
      expect(published.published?.content).toEqual(published.draft.content);
      expect(published.firstPublishedAt).toEqual(published.lastPublishedAt);
      expect(published.unpublishedAt).toBeNull();
      expect((await row(fx, draft.id)).plainText).toBe(
        'Първо\n\nЗагрейте добре & бавно.\n\nКлек',
      );
      expect(await linksOf(fx, draft.id)).toEqual([strength.id]);
    });

    it('uses the slug the admin chose', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие', { slug: 'moe-ime' });

      expect((await publishing(fx).publish(draft.id, 1, null)).slug).toBe(
        'moe-ime',
      );
    });

    it('makes a generated slug unique and avoids reserved and empty ones', async () => {
      const fx = fixtures();
      const first = await readyDraft(fx, 'Хранене');
      const second = await readyDraft(fx, 'Хранене');
      const reserved = await readyDraft(fx, 'Category');
      const emoji = await readyDraft(fx, '💪🔥');

      expect((await publishing(fx).publish(first.id, 1, null)).slug).toBe(
        'hranene',
      );
      expect((await publishing(fx).publish(second.id, 1, null)).slug).toBe(
        'hranene-2',
      );
      expect((await publishing(fx).publish(reserved.id, 1, null)).slug).toBe(
        'category-2',
      );
      expect((await publishing(fx).publish(emoji.id, 1, null)).slug).toBe(
        'statia',
      );
    });

    it('refuses a chosen slug that is reserved or taken', async () => {
      const fx = fixtures();
      const other = await readyDraft(fx, 'Друга', { slug: 'zaeto' });
      await publishing(fx).publish(other.id, 1, null);
      const taken = await readyDraft(fx, 'Заглавие', { slug: 'zaeto' });
      const reserved = await readyDraft(fx, 'Заглавие', { slug: 'category' });

      const takenError = await rejectionOf(
        publishing(fx).publish(taken.id, 1, null),
      );
      const reservedError = await rejectionOf(
        publishing(fx).publish(reserved.id, 1, null),
      );

      expect((takenError as BadRequestException).getResponse()).toMatchObject({
        message: ['The slug "zaeto" is already used by another article'],
      });
      expect(
        (reservedError as BadRequestException).getResponse(),
      ).toMatchObject({
        message: ['The slug "category" is reserved'],
      });
    });

    it('lists everything that stops a draft from going live, and changes nothing', async () => {
      const fx = fixtures();
      const created = await articles(fx).create({ title: 'Заглавие' }, null);
      await articles(fx).saveDraft(
        created.id,
        {
          baseRevision: 0,
          title: '',
          featuredMediaId: UNKNOWN_ID,
          categoryIds: [UNKNOWN_ID],
        },
        null,
      );

      const error = await rejectionOf(
        publishing(fx).publish(created.id, 1, null),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'The article needs a title',
          'The article needs some content',
          'The featured image no longer exists',
          'One of the categories no longer exists',
        ],
      });
      expect(await row(fx, created.id)).toMatchObject({
        status: ArticleStatus.DRAFT,
        slug: null,
        title: null,
      });
    });

    it('names the image block whose media is gone', async () => {
      const fx = fixtures();
      const kept = await media(fx);
      const draft = await readyDraft(fx, 'Заглавие', {
        content: {
          blocks: [
            { type: 'image', data: { mediaId: kept.id } },
            { type: 'paragraph', data: { text: 'Текст' } },
            { type: 'image', data: { mediaId: UNKNOWN_ID } },
          ],
        },
      });

      const error = await rejectionOf(
        publishing(fx).publish(draft.id, 1, null),
      );

      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: ['The image in block 3 no longer exists'],
      });
    });

    it('publishes only the revision the admin saw (409 otherwise)', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');

      const error = await rejectionOf(
        publishing(fx).publish(draft.id, 0, null),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        currentRevision: 1,
      });
      expect((await row(fx, draft.id)).status).toBe(ArticleStatus.DRAFT);
    });

    it('updates a published article: new content, same slug, first date kept', async () => {
      const fx = fixtures();
      const a = await category(fx, 'А', 'a');
      const b = await category(fx, 'Б', 'b');
      const draft = await readyDraft(fx, 'Първо заглавие', {
        categoryIds: [a.id],
      });
      const first = await publishing(fx).publish(draft.id, 1, null);
      await articles(fx).saveDraft(
        draft.id,
        { baseRevision: 1, title: 'Ново заглавие', categoryIds: [b.id] },
        null,
      );

      const updated = await publishing(fx).publish(draft.id, 2, null);

      expect(updated).toMatchObject({
        slug: 'parvo-zaglavie',
        published: { title: 'Ново заглавие', categoryIds: [b.id] },
        hasUnpublishedChanges: false,
      });
      expect(updated.firstPublishedAt).toEqual(first.firstPublishedAt);
      expect(updated.lastPublishedAt!.getTime()).toBeGreaterThanOrEqual(
        first.lastPublishedAt!.getTime(),
      );
      expect(await linksOf(fx, draft.id)).toEqual([b.id]);
    });

    it('never gives two articles the same slug, even when published at once', async () => {
      const fx = fixtures();
      const one = await readyDraft(fx, 'Едно и също');
      const two = await readyDraft(fx, 'Едно и също');

      const results = await Promise.allSettled([
        publishing(fx).publish(one.id, 1, null),
        publishing(fx).publish(two.id, 1, null),
      ]);

      for (const r of results) {
        if (r.status === 'rejected')
          expect(r.reason).toBeInstanceOf(ConflictException);
      }
      const slugs = (await fx.ds.getRepository(ArticleEntity).find())
        .map((x) => x.slug)
        .filter(Boolean);
      expect(slugs.length).toBeGreaterThanOrEqual(1);
      expect(new Set(slugs).size).toBe(slugs.length);
    });
  });

  describe('unpublish', () => {
    it('takes a published article down and keeps its published version', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');
      await publishing(fx).publish(draft.id, 1, null);

      const down = await publishing(fx).unpublish(draft.id, null);

      expect(down).toMatchObject({
        status: ArticleStatus.UNPUBLISHED,
        slug: 'zaglavie',
        published: { title: 'Заглавие' },
      });
      expect(down.unpublishedAt).toBeInstanceOf(Date);
    });

    it('refuses an article that is not published', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');

      const error = await rejectionOf(publishing(fx).unpublish(draft.id, null));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe('Only a published article can be unpublished');
    });

    it('can be published again, with the same slug', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');
      await publishing(fx).publish(draft.id, 1, null);
      await publishing(fx).unpublish(draft.id, null);

      const again = await publishing(fx).publish(draft.id, 1, null);

      expect(again).toMatchObject({
        status: ArticleStatus.PUBLISHED,
        slug: 'zaglavie',
        unpublishedAt: null,
      });
    });
  });

  describe('discardDraft', () => {
    it('puts the published version back into the draft', async () => {
      const fx = fixtures();
      const a = await category(fx, 'А', 'a');
      const draft = await readyDraft(fx, 'Публикувано', {
        categoryIds: [a.id],
      });
      await publishing(fx).publish(draft.id, 1, null);
      await articles(fx).saveDraft(
        draft.id,
        { baseRevision: 1, title: 'Недовършено', categoryIds: [] },
        null,
      );

      const discarded = await publishing(fx).discardDraft(draft.id, 2, null);

      expect(discarded).toMatchObject({
        draftRevision: 3,
        hasUnpublishedChanges: false,
        draft: {
          title: 'Публикувано',
          categoryIds: [a.id],
          content: paragraph('Текст'),
          slug: 'publikuvano',
        },
      });
    });

    it('refuses an article that was never published, and a stale revision', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');

      const never = await rejectionOf(
        publishing(fx).discardDraft(draft.id, 1, null),
      );
      const stale = await rejectionOf(
        publishing(fx).discardDraft(draft.id, 0, null),
      );

      expect(never).toBeInstanceOf(ConflictException);
      expect(never.message).toBe(
        'The article has never been published, so there is no version to go back to',
      );
      expect(stale).toBeInstanceOf(ConflictException);
      expect((stale as ConflictException).getResponse()).toMatchObject({
        currentRevision: 1,
      });
    });
  });

  describe('delete', () => {
    it('deletes a draft and an unpublished article, with their category links', async () => {
      const fx = fixtures();
      const a = await category(fx, 'А', 'a');
      const draft = await readyDraft(fx, 'Чернова');
      const unpublished = await readyDraft(fx, 'Свалена', {
        categoryIds: [a.id],
      });
      await publishing(fx).publish(unpublished.id, 1, null);
      await publishing(fx).unpublish(unpublished.id, null);

      expect(await publishing(fx).delete(draft.id)).toEqual({ deleted: true });
      expect(await publishing(fx).delete(unpublished.id)).toEqual({
        deleted: true,
      });

      expect(await fx.ds.getRepository(ArticleEntity).count()).toBe(0);
      expect(await fx.ds.getRepository(ArticleCategoryLinkEntity).count()).toBe(
        0,
      );
      expect(await fx.ds.getRepository(ArticleCategoryEntity).count()).toBe(1);
    });

    it('refuses to delete a published article', async () => {
      const fx = fixtures();
      const draft = await readyDraft(fx, 'Заглавие');
      await publishing(fx).publish(draft.id, 1, null);

      const error = await rejectionOf(publishing(fx).delete(draft.id));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(
        'Unpublish the article before deleting it permanently',
      );
      expect(await fx.ds.getRepository(ArticleEntity).count()).toBe(1);
    });
  });

  it('answers 404 for an unknown id', async () => {
    const fx = fixtures();

    for (const call of [
      () => publishing(fx).publish(UNKNOWN_ID, 0, null),
      () => publishing(fx).unpublish(UNKNOWN_ID, null),
      () => publishing(fx).discardDraft(UNKNOWN_ID, 0, null),
      () => publishing(fx).delete(UNKNOWN_ID),
    ]) {
      const error = await rejectionOf(call());
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Article not found');
    }
  });
});
