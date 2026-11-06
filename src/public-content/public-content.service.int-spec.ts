import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { freezeTime } from '../../test/int/clock';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ArticleCategoryEntity } from '../article-categories/article-category.entity';
import { ArticlePublishingService } from '../articles/article-publishing.service';
import { ArticleEntity } from '../articles/article.entity';
import { ArticlesModule } from '../articles/articles.module';
import { ArticlesService } from '../articles/articles.service';
import { signPreviewToken } from '../articles/preview-token';
import { MediaEntity } from '../media/media.entity';
import { MediaService } from '../media/media.service';
import { PublicContentModule } from './public-content.module';
import { PublicContentService } from './public-content.service';

const MEDIA_URL = 'https://media.example.test';
const SECRET = 'public-content-int-secret';
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

describe('PublicContentService (integration)', () => {
  const env = { ...process.env };
  // Media settings are read on first use; the preview token is signed with JWT_SECRET.
  beforeAll(() => {
    process.env.MEDIA_PUBLIC_URL = MEDIA_URL;
    process.env.JWT_SECRET = SECRET;
  });
  afterAll(() => {
    process.env = env;
  });

  const fixtures = setupIntegrationSuite({
    extraImports: [ArticlesModule, PublicContentModule],
  });
  const svc = (fx: Fixtures) => fx.moduleRef.get(PublicContentService);
  const articles = (fx: Fixtures) => fx.moduleRef.get(ArticlesService);
  const publishing = (fx: Fixtures) =>
    fx.moduleRef.get(ArticlePublishingService);

  function media(fx: Fixtures, altText = 'Снимка') {
    const id = randomUUID();
    return fx.ds.getRepository(MediaEntity).save({
      id,
      altText,
      masterPath: `${id}/master.jpg`,
      width: 1600,
      height: 900,
      variants: [{ path: `${id}/w480.webp`, width: 480, height: 270 }],
      ogPath: `${id}/og.jpg`,
      originalFilename: 'secret-name.jpg',
      sizeBytes: 1,
      uploadedByAccountId: null,
    });
  }

  function category(
    fx: Fixtures,
    name: string,
    slug: string,
    sortOrder = 0,
    description: string | null = null,
  ) {
    return fx.ds.getRepository(ArticleCategoryEntity).save({
      language: 'bg',
      name,
      nameKey: name.toLowerCase(),
      slug,
      description,
      sortOrder,
    });
  }

  const paragraph = (text: string) => ({
    blocks: [{ type: 'paragraph', data: { text } }],
  });

  /** A draft with a title and text, plus any other fields; not published. */
  async function draft(fx: Fixtures, title: string, extra: object = {}) {
    const created = await articles(fx).create({ title }, null);
    return articles(fx).saveDraft(
      created.id,
      { baseRevision: 0, content: paragraph('Текст'), ...extra },
      null,
    );
  }

  /** Publishes a new article at `at` (first publish time). */
  async function published(
    fx: Fixtures,
    title: string,
    at: string,
    extra: object = {},
  ) {
    const d = await draft(fx, title, extra);
    freezeTime(at);
    return publishing(fx).publish(d.id, d.draftRevision, null);
  }

  const publicImage = (m: MediaEntity) => ({
    url: `${MEDIA_URL}/${m.id}/master.jpg`,
    width: 1600,
    height: 900,
    altText: m.altText,
    variants: [
      { url: `${MEDIA_URL}/${m.id}/w480.webp`, width: 480, height: 270 },
    ],
    ogImage: { url: `${MEDIA_URL}/${m.id}/og.jpg`, width: 1200, height: 630 },
  });

  describe('listArticles', () => {
    it('lists only published articles, newest first publish first', async () => {
      const fx = fixtures();
      const older = await published(fx, 'По-стара', '2026-11-01T10:00:00Z');
      await published(fx, 'По-нова', '2026-11-03T10:00:00Z');
      const down = await published(fx, 'Свалена', '2026-11-04T10:00:00Z');
      await publishing(fx).unpublish(down.id, null);
      await draft(fx, 'Чернова');
      // Republishing an update changes updatedAt, not the order.
      freezeTime('2026-11-05T10:00:00Z');
      const edited = await articles(fx).saveDraft(
        older.id,
        { baseRevision: older.draftRevision, excerpt: 'Обновено' },
        null,
      );
      await publishing(fx).publish(older.id, edited.draftRevision, null);

      const page = await svc(fx).listArticles({});

      expect(page.items.map((a) => a.title)).toEqual(['По-нова', 'По-стара']);
      expect(page).toMatchObject({ total: 2, page: 1, pageSize: 12 });
      expect(page.items[1]).toMatchObject({
        slug: 'po-stara',
        excerpt: 'Обновено',
        publishedAt: new Date('2026-11-01T10:00:00Z'),
        updatedAt: new Date('2026-11-05T10:00:00Z'),
      });
    });

    it('gives the published version with its image and categories, and nothing internal', async () => {
      const fx = fixtures();
      const cover = await media(fx, 'Атлет с щанга');
      const later = await category(fx, 'Хранене', 'hranene', 2);
      const first = await category(fx, 'Сила', 'sila', 1);
      const article = await published(
        fx,
        'Сила и хранене',
        '2026-11-01T10:00:00Z',
        {
          excerpt: 'Кратко',
          featuredMediaId: cover.id,
          categoryIds: [later.id, first.id],
        },
      );
      // Unpublished changes in the draft stay out of the public view.
      await articles(fx).saveDraft(
        article.id,
        {
          baseRevision: article.draftRevision,
          title: 'Недовършено',
          excerpt: 'Чернова',
          categoryIds: [],
        },
        null,
      );

      const [item] = (await svc(fx).listArticles({})).items;

      expect(item).toEqual({
        slug: 'sila-i-hranene',
        title: 'Сила и хранене',
        excerpt: 'Кратко',
        featuredImage: publicImage(cover),
        categories: [
          { slug: 'sila', name: 'Сила' },
          { slug: 'hranene', name: 'Хранене' },
        ],
        publishedAt: new Date('2026-11-01T10:00:00Z'),
        updatedAt: new Date('2026-11-01T10:00:00Z'),
      });
    });

    it('uses the start of the text when there is no excerpt', async () => {
      const fx = fixtures();
      const text = 'Загрейте добре. '.repeat(30);
      await published(fx, 'Загрявка', '2026-11-01T10:00:00Z', {
        content: paragraph(text),
      });

      const [item] = (await svc(fx).listArticles({})).items;

      expect(item.excerpt.length).toBeLessThanOrEqual(200);
      expect(item.excerpt).toMatch(/^Загрейте добре\. Загрейте.*…$/);
    });

    it('pages through the articles', async () => {
      const fx = fixtures();
      for (let day = 1; day <= 5; day++) {
        await published(fx, `Статия ${day}`, `2026-11-0${day}T10:00:00Z`);
      }

      const page = await svc(fx).listArticles({ page: 2, pageSize: 2 });

      expect(page.items.map((a) => a.title)).toEqual(['Статия 3', 'Статия 2']);
      expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    });

    it('filters by category slug', async () => {
      const fx = fixtures();
      const strength = await category(fx, 'Сила', 'sila');
      const food = await category(fx, 'Хранене', 'hranene');
      await published(fx, 'Клек', '2026-11-01T10:00:00Z', {
        categoryIds: [strength.id],
      });
      await published(fx, 'Протеин', '2026-11-02T10:00:00Z', {
        categoryIds: [food.id],
      });
      await published(fx, 'Двете', '2026-11-03T10:00:00Z', {
        categoryIds: [strength.id, food.id],
      });
      // In the draft only: the published categories decide.
      const pending = await published(
        fx,
        'Без категория',
        '2026-11-04T10:00:00Z',
      );
      await articles(fx).saveDraft(
        pending.id,
        { baseRevision: pending.draftRevision, categoryIds: [strength.id] },
        null,
      );

      const titles = async (category: string) =>
        (await svc(fx).listArticles({ category })).items.map((a) => a.title);

      expect(await titles('sila')).toEqual(['Двете', 'Клек']);
      expect(await titles('hranene')).toEqual(['Двете', 'Протеин']);
      expect(await titles('nyama-takava')).toEqual([]);
      expect((await svc(fx).listArticles({ category: 'sila' })).total).toBe(2);
    });

    it('searches title, excerpt and text, ignoring case, published only', async () => {
      const fx = fixtures();
      await published(fx, 'Клекът е крал', '2026-11-01T10:00:00Z');
      await published(fx, 'Втора', '2026-11-02T10:00:00Z', {
        excerpt: 'За КЛЕКОВЕТЕ накратко',
      });
      await published(fx, 'Трета', '2026-11-03T10:00:00Z', {
        content: paragraph('Дълбок <b>клек</b> с пауза'),
      });
      await published(fx, 'Без връзка', '2026-11-04T10:00:00Z');
      const down = await published(fx, 'Клек, свален', '2026-11-05T10:00:00Z');
      await publishing(fx).unpublish(down.id, null);
      await draft(fx, 'Клек в чернова');

      const titles = async (q: string) =>
        (await svc(fx).listArticles({ q })).items.map((a) => a.title);

      expect(await titles('клек')).toEqual(['Трета', 'Втора', 'Клекът е крал']);
      expect(await titles('КЛЕК С ПАУЗА')).toEqual(['Трета']);
      expect(await titles('нищо такова')).toEqual([]);
    });

    it('takes LIKE wildcards in a search literally', async () => {
      const fx = fixtures();
      await published(fx, '100% усилие', '2026-11-01T10:00:00Z');
      await published(fx, '100 повторения', '2026-11-02T10:00:00Z');

      const titles = async (q: string) =>
        (await svc(fx).listArticles({ q })).items.map((a) => a.title);

      expect(await titles('100%')).toEqual(['100% усилие']);
      expect(await titles('1_0')).toEqual([]);
    });
  });

  describe('getArticle', () => {
    it('gives the published article with its blocks and SEO fields', async () => {
      const fx = fixtures();
      const cover = await media(fx, 'Корица');
      const inline = await media(fx, 'Клек отстрани');
      const strength = await category(fx, 'Сила', 'sila');
      await published(fx, 'Как да клекнем', '2026-11-01T10:00:00Z', {
        excerpt: 'Кратко за клека',
        seoTitle: 'Клек: ръководство',
        featuredMediaId: cover.id,
        categoryIds: [strength.id],
        content: {
          blocks: [
            { id: 'a1', type: 'header', data: { text: 'Стойка', level: 2 } },
            {
              id: 'a2',
              type: 'paragraph',
              data: { text: 'Краката <b>широко</b>.' },
            },
            {
              id: 'a3',
              type: 'image',
              data: { mediaId: inline.id, caption: 'Отстрани' },
            },
            {
              type: 'embed',
              data: {
                service: 'youtube',
                source: 'https://youtu.be/dQw4w9WgXcQ',
              },
            },
          ],
        },
      });

      const article = await svc(fx).getArticle('kak-da-kleknem');

      expect(article).toEqual({
        slug: 'kak-da-kleknem',
        language: 'bg',
        title: 'Как да клекнем',
        excerpt: 'Кратко за клека',
        seoTitle: 'Клек: ръководство',
        description: 'Кратко за клека',
        featuredImage: publicImage(cover),
        categories: [{ slug: 'sila', name: 'Сила' }],
        publishedAt: new Date('2026-11-01T10:00:00Z'),
        updatedAt: new Date('2026-11-01T10:00:00Z'),
        content: {
          blocks: [
            { type: 'header', data: { text: 'Стойка', level: 2 } },
            { type: 'paragraph', data: { text: 'Краката <b>широко</b>.' } },
            {
              type: 'image',
              data: { image: publicImage(inline), caption: 'Отстрани' },
            },
            {
              type: 'embed',
              data: { service: 'youtube', videoId: 'dQw4w9WgXcQ', caption: '' },
            },
          ],
        },
      });
    });

    it('answers 404 for an unpublished, unknown or draft-only slug', async () => {
      const fx = fixtures();
      const down = await published(fx, 'Свалена', '2026-11-01T10:00:00Z');
      await publishing(fx).unpublish(down.id, null);
      await draft(fx, 'Чернова', { slug: 'chernova' });

      for (const slug of ['svalena', 'chernova', 'nyama']) {
        const error = await rejectionOf(svc(fx).getArticle(slug));
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Article not found');
      }
    });

    it('needs the media settings only for articles with images', async () => {
      const fx = fixtures();
      const cover = await media(fx);
      await published(fx, 'Само текст', '2026-11-01T10:00:00Z');
      await published(fx, 'Със снимка', '2026-11-02T10:00:00Z', {
        featuredMediaId: cover.id,
      });
      process.env.NODE_ENV = 'production';
      delete process.env.MEDIA_PUBLIC_URL;
      try {
        // A service that hasn't read the media settings yet, as after a deploy without them.
        const fresh = new PublicContentService(
          fx.ds.getRepository(ArticleEntity),
          fx.ds.getRepository(ArticleCategoryEntity),
          new MediaService(fx.ds.getRepository(MediaEntity)),
        );

        expect((await fresh.getArticle('samo-tekst')).title).toBe('Само текст');
        expect(
          await rejectionOf(fresh.getArticle('sas-snimka')),
        ).toBeInstanceOf(ServiceUnavailableException);
      } finally {
        process.env.NODE_ENV = env.NODE_ENV;
        process.env.MEDIA_PUBLIC_URL = MEDIA_URL;
      }
    });
  });

  describe('categories', () => {
    it('lists categories with a published article, in navigation order, with counts', async () => {
      const fx = fixtures();
      const food = await category(fx, 'Хранене', 'hranene', 2, 'За храната');
      const strength = await category(fx, 'Сила', 'sila', 1);
      const empty = await category(fx, 'Празна', 'prazna', 0);
      const onlyDown = await category(fx, 'Само свалени', 'samo-svaleni', 0);
      const onlyDraft = await category(
        fx,
        'Само в чернова',
        'samo-v-chernova',
        0,
      );
      await published(fx, 'Едно', '2026-11-01T10:00:00Z', {
        categoryIds: [strength.id, food.id],
      });
      await published(fx, 'Две', '2026-11-02T10:00:00Z', {
        categoryIds: [strength.id],
      });
      const down = await published(fx, 'Свалена', '2026-11-03T10:00:00Z', {
        categoryIds: [onlyDown.id, strength.id],
      });
      await publishing(fx).unpublish(down.id, null);
      await draft(fx, 'Чернова', { categoryIds: [onlyDraft.id] });

      expect(await svc(fx).listCategories()).toEqual([
        { slug: 'sila', name: 'Сила', description: null, articleCount: 2 },
        {
          slug: 'hranene',
          name: 'Хранене',
          description: 'За храната',
          articleCount: 1,
        },
      ]);
      expect(await svc(fx).getCategory('hranene')).toEqual({
        slug: 'hranene',
        name: 'Хранене',
        description: 'За храната',
        articleCount: 1,
      });
      for (const slug of [empty.slug, onlyDown.slug, onlyDraft.slug, 'nyama']) {
        const error = await rejectionOf(svc(fx).getCategory(slug));
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Category not found');
      }
    });
  });

  describe('sitemap', () => {
    it('lists published articles and their categories with last changes', async () => {
      const fx = fixtures();
      const strength = await category(fx, 'Сила', 'sila', 1);
      const food = await category(fx, 'Хранене', 'hranene', 2);
      await category(fx, 'Празна', 'prazna', 0);
      const first = await published(fx, 'Първа', '2026-11-01T10:00:00Z', {
        categoryIds: [strength.id, food.id],
      });
      await published(fx, 'Втора', '2026-11-02T10:00:00Z', {
        categoryIds: [strength.id],
      });
      const down = await published(fx, 'Свалена', '2026-11-04T10:00:00Z', {
        categoryIds: [strength.id],
      });
      await publishing(fx).unpublish(down.id, null);
      freezeTime('2026-11-03T10:00:00Z');
      await publishing(fx).publish(first.id, first.draftRevision, null);
      // updatedAt comes from the database clock; pin it: an old change for "Сила", a recent
      // rename for "Хранене".
      const setUpdatedAt = (id: string, at: string) =>
        fx.ds.query(
          `UPDATE "article_categories" SET "updatedAt" = $1 WHERE "id" = $2`,
          [at, id],
        );
      await setUpdatedAt(strength.id, '2026-10-01T10:00:00Z');
      await setUpdatedAt(food.id, '2026-11-05T10:00:00Z');

      expect(await svc(fx).sitemap()).toEqual({
        articles: [
          { slug: 'vtora', lastmod: new Date('2026-11-02T10:00:00Z') },
          { slug: 'parva', lastmod: new Date('2026-11-03T10:00:00Z') },
        ],
        categories: [
          // The last publish of its published articles; the unpublished one doesn't count.
          { slug: 'sila', lastmod: new Date('2026-11-03T10:00:00Z') },
          // Its own change is later than its article's publish.
          { slug: 'hranene', lastmod: new Date('2026-11-05T10:00:00Z') },
        ],
      });
    });
  });

  describe('preview', () => {
    it('shows the current draft of a published article', async () => {
      const fx = fixtures();
      const cover = await media(fx);
      const strength = await category(fx, 'Сила', 'sila');
      const article = await published(
        fx,
        'Публикувана',
        '2026-11-01T10:00:00Z',
      );
      freezeTime('2026-11-02T10:00:00Z');
      const { token } = await articles(fx).createPreviewToken(article.id);
      await articles(fx).saveDraft(
        article.id,
        {
          baseRevision: article.draftRevision,
          title: 'Ново заглавие',
          featuredMediaId: cover.id,
          categoryIds: [strength.id],
          seoDescription: 'Описание',
        },
        null,
      );

      const preview = await svc(fx).preview(token);

      expect(preview).toMatchObject({
        preview: true,
        status: 'PUBLISHED',
        slug: 'publikuvana',
        title: 'Ново заглавие',
        description: 'Описание',
        featuredImage: publicImage(cover),
        categories: [{ slug: 'sila', name: 'Сила' }],
        publishedAt: new Date('2026-11-01T10:00:00Z'),
        content: { blocks: [{ type: 'paragraph', data: { text: 'Текст' } }] },
      });
      // The published version is untouched.
      expect((await svc(fx).getArticle('publikuvana')).title).toBe(
        'Публикувана',
      );
    });

    it('shows a draft that was never published, unfinished parts included', async () => {
      const fx = fixtures();
      const created = await articles(fx).create({ title: 'Нова' }, null);
      await articles(fx).saveDraft(
        created.id,
        { baseRevision: 0, title: '', slug: 'izbran' },
        null,
      );
      const { token } = await articles(fx).createPreviewToken(created.id);

      expect(await svc(fx).preview(token)).toMatchObject({
        preview: true,
        status: 'DRAFT',
        slug: 'izbran',
        title: '',
        excerpt: '',
        seoTitle: '',
        description: '',
        featuredImage: null,
        categories: [],
        publishedAt: null,
        content: { blocks: [] },
      });
    });

    it('answers 401 for a bad or expired token and 404 for a deleted article', async () => {
      const fx = fixtures();
      const created = await articles(fx).create({ title: 'Нова' }, null);
      freezeTime('2026-11-01T10:00:00Z');
      const { token } = await articles(fx).createPreviewToken(created.id);

      freezeTime('2026-11-01T10:31:00Z');
      const expired = await rejectionOf(svc(fx).preview(token));
      expect(expired).toBeInstanceOf(UnauthorizedException);
      expect(expired.message).toBe(
        'The preview link is invalid or has expired',
      );

      const forged = signPreviewToken(created.id, 'another-secret').token;
      expect(await rejectionOf(svc(fx).preview(forged))).toBeInstanceOf(
        UnauthorizedException,
      );

      const fresh = await articles(fx).createPreviewToken(created.id);
      await publishing(fx).delete(created.id);
      const gone = await rejectionOf(svc(fx).preview(fresh.token));
      expect(gone).toBeInstanceOf(NotFoundException);
    });

    it('issues tokens only for articles that exist', async () => {
      const fx = fixtures();
      const error = await rejectionOf(
        articles(fx).createPreviewToken(UNKNOWN_ID),
      );
      expect(error).toBeInstanceOf(NotFoundException);
    });
  });
});
