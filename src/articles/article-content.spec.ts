import {
  InvalidContentError,
  MAX_BLOCKS,
  MAX_LIST_DEPTH,
  normalizeContent,
  sanitizeInline,
  youtubeVideoId,
} from './article-content';

const MEDIA_ID = '3aaf0a13-2e90-4392-a840-42e0b70ec513';

function blocks(...list: unknown[]) {
  return { time: 1762400000000, version: '2.31.0', blocks: list };
}

function rejects(input: unknown, message: string | RegExp) {
  expect(() => normalizeContent(input)).toThrow(InvalidContentError);
  expect(() => normalizeContent(input)).toThrow(message);
}

describe('sanitizeInline', () => {
  it('keeps bold, italic, line breaks and http(s)/mailto links', () => {
    expect(
      sanitizeInline(
        'Сила <b>и</b> <i>техника</i><br><a href="https://theindex.training">тук</a> <a href="mailto:a@b.bg">поща</a>',
      ),
    ).toBe(
      'Сила <b>и</b> <i>техника</i><br /><a href="https://theindex.training">тук</a> <a href="mailto:a@b.bg">поща</a>',
    );
  });

  it('turns strong/em into b/i', () => {
    expect(sanitizeInline('<strong>a</strong><em>b</em>')).toBe(
      '<b>a</b><i>b</i>',
    );
  });

  it('removes scripts, styles, event handlers and other tags', () => {
    expect(
      sanitizeInline(
        '<script>alert(1)</script><style>p{}</style><span style="color:red" onclick="x()">текст</span><img src=x onerror=y>',
      ),
    ).toBe('текст');
  });

  it('drops javascript: and protocol-relative links but keeps their text', () => {
    expect(sanitizeInline('<a href="javascript:alert(1)">a</a>')).toBe(
      '<a>a</a>',
    );
    expect(sanitizeInline('<a href="//evil.test">b</a>')).toBe('<a>b</a>');
    expect(
      sanitizeInline('<a href="https://x.test" target="_blank" rel="x">c</a>'),
    ).toBe('<a href="https://x.test">c</a>');
  });
});

describe('normalizeContent', () => {
  it('keeps every allowed block, normalized', () => {
    const content = normalizeContent(
      blocks(
        { id: 'p1', type: 'paragraph', data: { text: '<b>Клек</b>' } },
        { id: 'h1', type: 'header', data: { text: 'Защо', level: 2 } },
        {
          type: 'list',
          data: {
            style: 'unordered',
            meta: {},
            items: [
              {
                content: 'Едно',
                meta: {},
                items: [{ content: 'Под', items: [] }],
              },
              'Две',
            ],
          },
        },
        {
          type: 'quote',
          data: { text: 'Цитат', caption: 'Автор', alignment: 'left' },
        },
        {
          type: 'image',
          data: {
            file: {
              url: 'https://evil.test/x.jpg',
              mediaId: MEDIA_ID.toUpperCase(),
            },
            caption: 'Надпис',
            withBorder: true,
            stretched: false,
          },
        },
        {
          type: 'embed',
          data: {
            service: 'youtube',
            source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
            embed: 'https://evil.test/embed',
            width: 580,
            height: 320,
            caption: 'Видео',
          },
        },
        { type: 'delimiter', data: {} },
      ),
    );

    expect(content).toEqual({
      time: 1762400000000,
      version: '2.31.0',
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: '<b>Клек</b>' } },
        { id: 'h1', type: 'header', data: { text: 'Защо', level: 2 } },
        {
          type: 'list',
          data: {
            style: 'unordered',
            items: [
              { content: 'Едно', items: [{ content: 'Под', items: [] }] },
              { content: 'Две', items: [] },
            ],
          },
        },
        { type: 'quote', data: { text: 'Цитат', caption: 'Автор' } },
        { type: 'image', data: { mediaId: MEDIA_ID, caption: 'Надпис' } },
        {
          type: 'embed',
          data: {
            service: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            caption: 'Видео',
          },
        },
        { type: 'delimiter', data: {} },
      ],
    });
  });

  it('sanitizes text in every block, captions included', () => {
    const content = normalizeContent(
      blocks(
        { type: 'paragraph', data: { text: 'a<script>x</script>' } },
        {
          type: 'quote',
          data: { text: '<img src=x onerror=y>b', caption: '<b>c</b><u>d</u>' },
        },
        {
          type: 'list',
          data: { style: 'ordered', items: ['<a href="javascript:x">e</a>'] },
        },
        {
          type: 'image',
          data: { mediaId: MEDIA_ID, caption: '<span>f</span>' },
        },
      ),
    );

    expect(JSON.stringify(content)).not.toMatch(
      /script|onerror|<img|<u>|<span|javascript/,
    );
    expect(content.blocks[1]).toEqual({
      type: 'quote',
      data: { text: 'b', caption: '<b>c</b>d' },
    });
  });

  it('accepts empty content', () => {
    expect(normalizeContent({ blocks: [] })).toEqual({ blocks: [] });
  });

  it('drops a time, version or block id it cannot trust', () => {
    expect(
      normalizeContent({
        time: 'yesterday',
        version: 'x'.repeat(40),
        blocks: [{ id: '<b>', type: 'delimiter', data: {} }],
      }),
    ).toEqual({ blocks: [{ type: 'delimiter', data: {} }] });
  });

  it('rejects content that is not an Editor.js document', () => {
    rejects(null, 'content must be an object with a blocks array');
    rejects([], 'content must be an object with a blocks array');
    rejects({ blocks: 'x' }, 'content must be an object with a blocks array');
    rejects(blocks('text'), 'block 1 must have a type and a data object');
  });

  it(`rejects more than ${MAX_BLOCKS} blocks`, () => {
    const many = Array.from({ length: MAX_BLOCKS + 1 }, () => ({
      type: 'delimiter',
      data: {},
    }));
    rejects({ blocks: many }, `content can have at most ${MAX_BLOCKS} blocks`);
  });

  it('rejects block types outside the allowlist, naming the block', () => {
    rejects(
      blocks(
        { type: 'delimiter', data: {} },
        { type: 'raw', data: { html: '<iframe>' } },
      ),
      'block 2: unsupported block type "raw"',
    );
    rejects(
      blocks({ type: 'table', data: { content: [] } }),
      'unsupported block type "table"',
    );
  });

  it('accepts headings of level 2 and 3 only (the title is the h1)', () => {
    rejects(
      blocks({ type: 'header', data: { text: 'x', level: 1 } }),
      'heading level must be 2 or 3',
    );
    rejects(
      blocks({ type: 'header', data: { text: 'x', level: 4 } }),
      'heading level must be 2 or 3',
    );
    expect(
      normalizeContent(
        blocks({ type: 'header', data: { text: 'x', level: 3 } }),
      ).blocks[0],
    ).toEqual({ type: 'header', data: { text: 'x', level: 3 } });
  });

  it('rejects checklists and lists nested too deeply', () => {
    rejects(
      blocks({ type: 'list', data: { style: 'checklist', items: [] } }),
      'list style must be ordered or unordered',
    );
    let item: unknown = { content: 'дъно', items: [] };
    for (let i = 0; i < MAX_LIST_DEPTH; i++)
      item = { content: 'ниво', items: [item] };
    rejects(
      blocks({ type: 'list', data: { style: 'ordered', items: [item] } }),
      `lists can be nested at most ${MAX_LIST_DEPTH} levels deep`,
    );
  });

  it('requires an uploaded image (a media id), never a bare URL', () => {
    rejects(
      blocks({
        type: 'image',
        data: { file: { url: 'https://x.test/a.jpg' }, caption: '' },
      }),
      'an image needs the mediaId of an uploaded image',
    );
    rejects(
      blocks({ type: 'image', data: { mediaId: 'not-a-uuid' } }),
      'an image needs the mediaId of an uploaded image',
    );
  });

  it('embeds YouTube only, from the link and never from the client embed URL', () => {
    rejects(
      blocks({
        type: 'embed',
        data: { service: 'vimeo', source: 'https://vimeo.com/1' },
      }),
      'only YouTube videos can be embedded',
    );
    rejects(
      blocks({
        type: 'embed',
        data: {
          service: 'youtube',
          source: 'https://evil.test/watch?v=dQw4w9WgXcQ',
        },
      }),
      'not a YouTube video link',
    );
    expect(
      normalizeContent(
        blocks({
          type: 'embed',
          data: { service: 'youtube', videoId: 'dQw4w9WgXcQ' },
        }),
      ).blocks[0],
    ).toEqual({
      type: 'embed',
      data: { service: 'youtube', videoId: 'dQw4w9WgXcQ', caption: '' },
    });
  });

  it('rejects missing text and over-long text or captions', () => {
    rejects(
      blocks({ type: 'paragraph', data: {} }),
      'block 1: text is missing',
    );
    rejects(
      blocks({ type: 'paragraph', data: { text: 'x'.repeat(10_001) } }),
      'text can be at most 10000 characters',
    );
    rejects(
      blocks({ type: 'quote', data: { text: 'x', caption: 'x'.repeat(501) } }),
      'a caption can be at most 500 characters',
    );
  });
});

describe('youtubeVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=5', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('reads the id from %s', (link, id) => {
    expect(youtubeVideoId(link)).toBe(id);
  });

  it.each([
    'https://www.youtube.com/watch?v=short',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/channel/UC123',
    'javascript:alert(1)',
    'not a url',
    42,
  ])('finds no video in %s', (link) => {
    expect(youtubeVideoId(link)).toBeUndefined();
  });
});
