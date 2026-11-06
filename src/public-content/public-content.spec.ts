import type { ArticleContent } from '../articles/article-content';
import type { PublicMedia } from '../media/media.service';
import {
  excerptOf,
  mediaIdsOf,
  seoOf,
  textSummary,
  toPublicBlocks,
} from './public-content';

const IMAGE_ID = '0b9e3c1a-5d2f-4e6a-8b7c-9d0e1f2a3b4c';
const GONE_ID = '11111111-1111-4111-8111-111111111111';
const COVER_ID = '22222222-2222-4222-8222-222222222222';

const image: PublicMedia = {
  url: `https://media.test/${IMAGE_ID}/master.jpg`,
  width: 1600,
  height: 900,
  altText: 'Клек',
  variants: [
    {
      url: `https://media.test/${IMAGE_ID}/w480.webp`,
      width: 480,
      height: 270,
    },
  ],
  ogImage: {
    url: `https://media.test/${IMAGE_ID}/og.jpg`,
    width: 1200,
    height: 630,
  },
};

describe('public content helpers', () => {
  describe('toPublicBlocks', () => {
    const content: ArticleContent = {
      time: 1,
      version: '2.31.0',
      blocks: [
        { id: 'h1', type: 'header', data: { text: 'Първо', level: 2 } },
        { id: 'p1', type: 'paragraph', data: { text: 'Текст <b>смел</b>' } },
        {
          id: 'i1',
          type: 'image',
          data: { mediaId: IMAGE_ID, caption: 'Подпис' },
        },
        {
          id: 'i2',
          type: 'image',
          data: { mediaId: GONE_ID, caption: 'Няма' },
        },
        {
          type: 'embed',
          data: { service: 'youtube', videoId: 'dQw4w9WgXcQ', caption: '' },
        },
        { type: 'delimiter', data: {} },
      ],
    };

    it('resolves images, drops ones that no longer exist and the editor ids', () => {
      expect(toPublicBlocks(content, new Map([[IMAGE_ID, image]]))).toEqual([
        { type: 'header', data: { text: 'Първо', level: 2 } },
        { type: 'paragraph', data: { text: 'Текст <b>смел</b>' } },
        { type: 'image', data: { image, caption: 'Подпис' } },
        {
          type: 'embed',
          data: { service: 'youtube', videoId: 'dQw4w9WgXcQ', caption: '' },
        },
        { type: 'delimiter', data: {} },
      ]);
    });

    it('gives no blocks for no content', () => {
      expect(toPublicBlocks(null, new Map())).toEqual([]);
    });
  });

  it('collects the featured image and the image blocks for one lookup', () => {
    const content: ArticleContent = {
      blocks: [
        { type: 'paragraph', data: { text: 'x' } },
        { type: 'image', data: { mediaId: IMAGE_ID, caption: '' } },
      ],
    };
    expect(mediaIdsOf(content, COVER_ID)).toEqual([COVER_ID, IMAGE_ID]);
    expect(mediaIdsOf(content, null)).toEqual([IMAGE_ID]);
    expect(mediaIdsOf(null, null)).toEqual([]);
  });

  describe('textSummary', () => {
    it('keeps short text and collapses whitespace', () => {
      expect(textSummary('  Кратък\n\nтекст  ', 20)).toBe('Кратък текст');
      expect(textSummary(null, 20)).toBe('');
    });

    it('cuts long text at a word and ends it with an ellipsis', () => {
      const text = 'Загрейте добре, преди да вдигате тежко.';
      const summary = textSummary(text, 20);
      expect(summary).toBe('Загрейте добре…');
      expect(summary.length).toBeLessThanOrEqual(20);
    });

    it('cuts a single long word where it has to', () => {
      expect(textSummary('а'.repeat(30), 10)).toBe(`${'а'.repeat(9)}…`);
    });

    it('is exactly the limit at most', () => {
      const text = 'дума '.repeat(100);
      expect(textSummary(text, 160).length).toBeLessThanOrEqual(160);
      expect(textSummary(text, 160)).toMatch(/^дума( дума)*…$/);
    });
  });

  describe('excerpt and SEO fallbacks', () => {
    const longText = `${'Дълъг текст за тренировките. '.repeat(20)}Край.`;
    const base = {
      title: 'Заглавие',
      excerpt: null,
      seoTitle: null,
      seoDescription: null,
      plainText: longText,
    };

    it('uses the excerpt, else the start of the text', () => {
      expect(excerptOf({ ...base, excerpt: 'Кратко' })).toBe('Кратко');
      const fallback = excerptOf(base);
      expect(fallback.length).toBeLessThanOrEqual(200);
      expect(longText.startsWith(fallback.slice(0, -1))).toBe(true);
      expect(fallback.endsWith('…')).toBe(true);
      expect(excerptOf({ ...base, plainText: '' })).toBe('');
    });

    it('prefers the SEO fields, then the title and excerpt, then the text', () => {
      expect(
        seoOf({ ...base, seoTitle: 'SEO', seoDescription: 'Описание' }),
      ).toEqual({ seoTitle: 'SEO', description: 'Описание' });
      expect(seoOf({ ...base, excerpt: 'Кратко' })).toEqual({
        seoTitle: 'Заглавие',
        description: 'Кратко',
      });
      const { description } = seoOf(base);
      expect(description.length).toBeLessThanOrEqual(160);
      expect(longText.startsWith(description.slice(0, -1))).toBe(true);
    });

    it('treats blank SEO fields as missing', () => {
      expect(
        seoOf({
          ...base,
          seoTitle: ' ',
          seoDescription: ' ',
          excerpt: 'Кратко',
        }),
      ).toEqual({ seoTitle: 'Заглавие', description: 'Кратко' });
    });
  });
});
