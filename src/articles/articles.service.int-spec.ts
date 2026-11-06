import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ArticleEntity, ArticleStatus } from './article.entity';
import { ArticlesModule } from './articles.module';
import { ArticlesService } from './articles.service';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';
const CATEGORY_A = '11111111-1111-4111-8111-111111111111';
const CATEGORY_B = 'bbbbbbbb-2222-4222-8222-22222222abcd';
const MEDIA_ID = '3aaf0a13-2e90-4392-a840-42e0b70ec513';

describe('ArticlesService (integration)', () => {
  const fixtures = setupIntegrationSuite({ extraImports: [ArticlesModule] });
  const svc = (fx: Fixtures) => fx.moduleRef.get(ArticlesService);
  const repo = (fx: Fixtures) => fx.ds.getRepository(ArticleEntity);

  function admin(fx: Fixtures, email = 'admin@example.com') {
    return fx.ds.getRepository(AccountEntity).save({
      email,
      passwordHash: null,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
    });
  }

  describe('create', () => {
    it('starts a draft from the title, with nothing published and no slug yet', async () => {
      const fx = fixtures();
      const account = await admin(fx);

      const article = await svc(fx).create(
        { title: 'Как да започнем с КросФит' },
        account.id,
      );

      expect(article).toMatchObject({
        language: 'bg',
        status: ArticleStatus.DRAFT,
        slug: null,
        published: null,
        draft: {
          title: 'Как да започнем с КросФит',
          excerpt: null,
          content: { blocks: [] },
          featuredMediaId: null,
          categoryIds: [],
          seoTitle: null,
          seoDescription: null,
          slug: null,
        },
        draftRevision: 0,
        hasUnpublishedChanges: true,
        firstPublishedAt: null,
        createdByAccountId: account.id,
        updatedByAccountId: account.id,
      });
      const [row] = await repo(fx).find();
      expect(row.title).toBeNull();
      expect(row.content).toBeNull();
    });
  });

  describe('saveDraft', () => {
    it('merges the sent fields into the draft and moves to the next revision', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);

      const saved = await svc(fx).saveDraft(
        created.id,
        {
          baseRevision: 0,
          excerpt: 'Кратко описание',
          content: {
            time: 1,
            blocks: [{ type: 'paragraph', data: { text: '<b>Сила</b>' } }],
          },
          categoryIds: [CATEGORY_A, CATEGORY_B],
          featuredMediaId: MEDIA_ID,
          slug: 'kak-da-zapochnem',
        },
        null,
      );

      expect(saved.draftRevision).toBe(1);
      expect(saved.draft).toEqual({
        title: 'Заглавие',
        excerpt: 'Кратко описание',
        content: {
          time: 1,
          blocks: [{ type: 'paragraph', data: { text: '<b>Сила</b>' } }],
        },
        featuredMediaId: MEDIA_ID,
        categoryIds: [CATEGORY_A, CATEGORY_B],
        seoTitle: null,
        seoDescription: null,
        slug: 'kak-da-zapochnem',
      });
      expect(saved.draftUpdatedAt.getTime()).toBeGreaterThanOrEqual(
        created.draftUpdatedAt.getTime(),
      );
    });

    it('keeps fields that were not sent, and clears optional ones with null', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);
      await svc(fx).saveDraft(
        created.id,
        { baseRevision: 0, excerpt: 'Текст', seoTitle: 'SEO' },
        null,
      );

      const saved = await svc(fx).saveDraft(
        created.id,
        { baseRevision: 1, excerpt: null, seoTitle: '' },
        null,
      );

      expect(saved.draft).toMatchObject({
        title: 'Заглавие',
        excerpt: null,
        seoTitle: null,
      });
    });

    it('saves incomplete work: an empty title is fine in a draft', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);

      const saved = await svc(fx).saveDraft(
        created.id,
        { baseRevision: 0, title: '' },
        null,
      );

      expect(saved.draft.title).toBe('');
    });

    it('stores the content normalized and sanitized', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);

      await svc(fx).saveDraft(
        created.id,
        {
          baseRevision: 0,
          content: {
            blocks: [
              { type: 'paragraph', data: { text: 'a<script>x()</script>' } },
              {
                type: 'image',
                data: {
                  file: { url: 'https://x.test/a.jpg', mediaId: MEDIA_ID },
                },
              },
            ],
          },
        },
        null,
      );

      const [row] = await repo(fx).find();
      expect(row.draft.content.blocks).toEqual([
        { type: 'paragraph', data: { text: 'a' } },
        { type: 'image', data: { mediaId: MEDIA_ID, caption: '' } },
      ]);
    });

    it('rejects content outside the allowlist with 400 and keeps the draft', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);

      const error = await rejectionOf(
        svc(fx).saveDraft(
          created.id,
          { baseRevision: 0, content: { blocks: [{ type: 'raw', data: {} }] } },
          null,
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('block 1: unsupported block type "raw"');
      expect((await svc(fx).get(created.id)).draftRevision).toBe(0);
    });

    it('refuses a save based on an old revision (409 with the current one)', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);
      await svc(fx).saveDraft(
        created.id,
        { baseRevision: 0, title: 'Таб 1' },
        null,
      );

      const error = await rejectionOf(
        svc(fx).saveDraft(
          created.id,
          { baseRevision: 0, title: 'Таб 2' },
          null,
        ),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        currentRevision: 1,
      });
      expect((await svc(fx).get(created.id)).draft.title).toBe('Таб 1');
    });

    it('lets only one of two concurrent saves from the same revision win', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);

      const results = await Promise.allSettled([
        svc(fx).saveDraft(created.id, { baseRevision: 0, title: 'А' }, null),
        svc(fx).saveDraft(created.id, { baseRevision: 0, title: 'Б' }, null),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      const article = await svc(fx).get(created.id);
      expect(article.draftRevision).toBe(1);
      const [won] = results.filter((r) => r.status === 'fulfilled');
      expect(article.draft.title).toBe(won.value.draft.title);
    });

    it('records who saved last', async () => {
      const fx = fixtures();
      const first = await admin(fx, 'first@example.com');
      const second = await admin(fx, 'second@example.com');
      const created = await svc(fx).create({ title: 'Заглавие' }, first.id);

      const saved = await svc(fx).saveDraft(
        created.id,
        { baseRevision: 0, title: 'Ново' },
        second.id,
      );

      expect(saved).toMatchObject({
        createdByAccountId: first.id,
        updatedByAccountId: second.id,
      });
    });

    it('never touches the published version', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Чернова' }, null);
      // A published article, as the publish step (next PR) will leave it.
      await repo(fx).update(created.id, {
        status: ArticleStatus.PUBLISHED,
        slug: 'publikuvana',
        title: 'Публикувана',
        content: { blocks: [] },
        firstPublishedAt: new Date('2026-11-01T10:00:00Z'),
        lastPublishedAt: new Date('2026-11-01T10:00:00Z'),
        hasUnpublishedChanges: false,
      });

      const saved = await svc(fx).saveDraft(
        created.id,
        { baseRevision: 0, title: 'Нова версия' },
        null,
      );

      expect(saved).toMatchObject({
        status: ArticleStatus.PUBLISHED,
        slug: 'publikuvana',
        published: { title: 'Публикувана' },
        draft: { title: 'Нова версия' },
        hasUnpublishedChanges: true,
      });
    });

    it('refuses to change the slug once the article has been published', async () => {
      const fx = fixtures();
      const created = await svc(fx).create({ title: 'Заглавие' }, null);
      await repo(fx).update(created.id, {
        status: ArticleStatus.UNPUBLISHED,
        slug: 'zaglavie',
        firstPublishedAt: new Date('2026-11-01T10:00:00Z'),
      });

      const error = await rejectionOf(
        svc(fx).saveDraft(created.id, { baseRevision: 0, slug: 'drugo' }, null),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'The slug is fixed once the article has been published',
      );
      expect((await svc(fx).get(created.id)).draftRevision).toBe(0);
    });

    it('keeps the article when the account that wrote it is deleted', async () => {
      const fx = fixtures();
      const account = await admin(fx);
      const created = await svc(fx).create({ title: 'Заглавие' }, account.id);

      await fx.ds.getRepository(AccountEntity).delete(account.id);

      expect(await svc(fx).get(created.id)).toMatchObject({
        createdByAccountId: null,
        updatedByAccountId: null,
      });
    });
  });

  describe('list', () => {
    async function seed(fx: Fixtures) {
      const make = async (title: string, extra: object = {}) => {
        const a = await svc(fx).create({ title }, null);
        if (Object.keys(extra).length) {
          await svc(fx).saveDraft(a.id, { baseRevision: 0, ...extra }, null);
        }
        return a;
      };
      const squat = await make('Клек с щанга', { categoryIds: [CATEGORY_A] });
      const food = await make('Хранене преди тренировка', {
        categoryIds: [CATEGORY_B],
      });
      const percent = await make('100% усилие', {
        categoryIds: [CATEGORY_A, CATEGORY_B],
      });
      return { squat, food, percent };
    }

    it('lists the most recently changed first, a page at a time', async () => {
      const fx = fixtures();
      const { squat } = await seed(fx);
      await svc(fx).saveDraft(
        squat.id,
        { baseRevision: 1, title: 'Клек с щанга!' },
        null,
      );

      const page1 = await svc(fx).list({ page: 1, pageSize: 2 });
      const page2 = await svc(fx).list({ page: 2, pageSize: 2 });

      expect(page1).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(page1.items.map((a) => a.title)).toEqual([
        'Клек с щанга!',
        '100% усилие',
      ]);
      expect(page2.items.map((a) => a.title)).toEqual([
        'Хранене преди тренировка',
      ]);
    });

    it("filters by the draft's category", async () => {
      const fx = fixtures();
      await seed(fx);

      const titles = (await svc(fx).list({ categoryId: CATEGORY_B })).items
        .map((a) => a.title)
        .sort();

      expect(titles).toEqual(['100% усилие', 'Хранене преди тренировка']);
    });

    it('matches the category however the UUID is cased', async () => {
      const fx = fixtures();
      await seed(fx);

      const upper = await svc(fx).list({
        categoryId: CATEGORY_B.toUpperCase(),
      });

      expect(upper.total).toBe(2);
    });

    it('searches the draft title ignoring case, with % and _ taken literally', async () => {
      const fx = fixtures();
      await seed(fx);

      const byWord = await svc(fx).list({ search: 'КЛЕК' });
      const byPercent = await svc(fx).list({ search: '100%' });
      const wildcard = await svc(fx).list({ search: '%' });
      const underscore = await svc(fx).list({ search: '_' });

      expect(byWord.items.map((a) => a.title)).toEqual(['Клек с щанга']);
      expect(byPercent.items.map((a) => a.title)).toEqual(['100% усилие']);
      expect(wildcard.items.map((a) => a.title)).toEqual(['100% усилие']);
      expect(underscore.total).toBe(0);
    });

    it('filters by status', async () => {
      const fx = fixtures();
      const { food } = await seed(fx);
      await repo(fx).update(food.id, { status: ArticleStatus.PUBLISHED });

      const drafts = await svc(fx).list({ status: ArticleStatus.DRAFT });
      const published = await svc(fx).list({ status: ArticleStatus.PUBLISHED });

      expect(drafts.total).toBe(2);
      expect(published.items.map((a) => a.id)).toEqual([food.id]);
    });

    it('returns summaries without the content, 20 per page by default', async () => {
      const fx = fixtures();
      await seed(fx);

      const page = await svc(fx).list({});

      expect(page.pageSize).toBe(20);
      expect(Object.keys(page.items[0]).sort()).toEqual(
        [
          'categoryIds',
          'createdAt',
          'draftUpdatedAt',
          'featuredMediaId',
          'firstPublishedAt',
          'hasUnpublishedChanges',
          'id',
          'lastPublishedAt',
          'publishedTitle',
          'slug',
          'status',
          'title',
          'updatedAt',
        ].sort(),
      );
    });
  });

  it('answers 404 for an unknown id', async () => {
    const fx = fixtures();

    for (const call of [
      () => svc(fx).get(UNKNOWN_ID),
      () =>
        svc(fx).saveDraft(UNKNOWN_ID, { baseRevision: 0, title: 'x' }, null),
    ]) {
      const error = await rejectionOf(call());
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Article not found');
    }
  });
});
