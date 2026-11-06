import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Articles over HTTP: request validation (create, autosave, list query), the 409 body for a stale
 * revision, and the 1 MB JSON body limit long drafts need. The service rules (draft merging,
 * revisions, content normalization, list filters) are covered in
 * `src/articles/articles.service.int-spec.ts` and `src/articles/article-content.spec.ts`; access is
 * in the role matrix.
 */
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

type ArticleBody = {
  id: string;
  status: string;
  draftRevision: number;
  draft: { title: string; content: { blocks: unknown[] } };
};

describe('Articles (e2e)', () => {
  const ctx = setupE2eSuite();

  async function adminAuth() {
    return { Authorization: `Bearer ${await ctx().loginAsAdmin()}` };
  }

  async function createArticle(auth: object, title = 'Заглавие') {
    const res = await ctx()
      .http()
      .post('/api/articles')
      .set(auth)
      .send({ title })
      .expect(201);
    return res.body as ArticleBody;
  }

  it('creates a draft from a trimmed title', async () => {
    const auth = await adminAuth();

    const article = await createArticle(auth, '  Как да започнем  ');

    expect(article).toMatchObject({
      status: 'DRAFT',
      draftRevision: 0,
      draft: { title: 'Как да започнем', content: { blocks: [] } },
    });
  });

  it('validates the title on create', async () => {
    const auth = await adminAuth();
    const post = (body: object) =>
      ctx().http().post('/api/articles').set(auth).send(body).expect(400);

    expect(messageOf((await post({ title: '   ' })).body)).toEqual([
      'title must not be empty',
    ]);
    expect(messageOf((await post({ title: 'x'.repeat(201) })).body)).toEqual([
      'title must be shorter than or equal to 200 characters',
    ]);
    expect(
      messageOf((await post({ title: 'x', status: 'PUBLISHED' })).body),
    ).toEqual(['property status should not exist']);
  });

  it('autosaves the draft and answers with the next revision', async () => {
    const c = ctx();
    const auth = await adminAuth();
    const article = await createArticle(auth);

    const res = await c
      .http()
      .patch(`/api/articles/${article.id}/draft`)
      .set(auth)
      .send({
        baseRevision: 0,
        title: ' Ново заглавие ',
        content: { blocks: [{ type: 'paragraph', data: { text: 'Текст' } }] },
      })
      .expect(200);

    expect(res.body).toMatchObject({
      draftRevision: 1,
      draft: {
        title: 'Ново заглавие',
        content: { blocks: [{ type: 'paragraph', data: { text: 'Текст' } }] },
      },
    });
  });

  it('validates autosave fields', async () => {
    const c = ctx();
    const auth = await adminAuth();
    const article = await createArticle(auth);
    const patch = (body: object) =>
      c
        .http()
        .patch(`/api/articles/${article.id}/draft`)
        .set(auth)
        .send(body)
        .expect(400);

    expect(messageOf((await patch({ title: 'x' })).body)).toContain(
      'baseRevision must be an integer number',
    );
    expect(
      messageOf((await patch({ baseRevision: 0, title: null })).body),
    ).toContain('title must be a string');
    expect(
      messageOf((await patch({ baseRevision: 0, slug: 'Не-латиница' })).body),
    ).toEqual([
      'slug must be lowercase Latin letters and digits joined by single hyphens, e.g. "kak-da-zapochnem"',
    ]);
    expect(
      messageOf((await patch({ baseRevision: 0, categoryIds: ['x'] })).body),
    ).toEqual(['each value in categoryIds must be a UUID']);
    expect(
      messageOf(
        (
          await patch({
            baseRevision: 0,
            categoryIds: Array.from(
              { length: 11 },
              (_, i) =>
                `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
            ),
          })
        ).body,
      ),
    ).toEqual(['categoryIds must contain no more than 10 elements']);
    expect(
      messageOf(
        (await patch({ baseRevision: 0, seoDescription: 'x'.repeat(161) }))
          .body,
      ),
    ).toEqual([
      'seoDescription must be shorter than or equal to 160 characters',
    ]);
    expect(
      messageOf((await patch({ baseRevision: 0, status: 'PUBLISHED' })).body),
    ).toEqual(['property status should not exist']);
    expect(
      messageOf(
        (
          await patch({
            baseRevision: 0,
            content: { blocks: [{ type: 'raw', data: {} }] },
          })
        ).body,
      ),
    ).toBe('block 1: unsupported block type "raw"');

    // Optional fields can be cleared with null.
    await c
      .http()
      .patch(`/api/articles/${article.id}/draft`)
      .set(auth)
      .send({
        baseRevision: 0,
        excerpt: null,
        featuredMediaId: null,
        slug: null,
      })
      .expect(200);
  });

  it('answers 409 with the current revision for a stale save', async () => {
    const c = ctx();
    const auth = await adminAuth();
    const article = await createArticle(auth);
    const save = (title: string) =>
      c
        .http()
        .patch(`/api/articles/${article.id}/draft`)
        .set(auth)
        .send({ baseRevision: 0, title });

    await save('Таб 1').expect(200);
    const stale = await save('Таб 2').expect(409);

    expect(stale.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message:
        'The article was changed in another tab or by someone else. Reload it to continue.',
      currentRevision: 1,
    });
  });

  it("accepts drafts over Express's default 100 kB, up to 1 MB", async () => {
    const c = ctx();
    const auth = await adminAuth();
    const article = await createArticle(auth);
    // About 450 kB of JSON: 50 paragraphs of 9 000 characters.
    const paragraphs = (count: number) =>
      Array.from({ length: count }, () => ({
        type: 'paragraph',
        data: { text: 'клек '.repeat(1800) },
      }));

    const long = await c
      .http()
      .patch(`/api/articles/${article.id}/draft`)
      .set(auth)
      .send({ baseRevision: 0, content: { blocks: paragraphs(50) } })
      .expect(200);
    expect((long.body as ArticleBody).draft.content.blocks).toHaveLength(50);

    // About 2.2 MB: over the limit.
    await c
      .http()
      .patch(`/api/articles/${article.id}/draft`)
      .set(auth)
      .send({ baseRevision: 1, content: { blocks: paragraphs(250) } })
      .expect(413);
  });

  it('lists with filters and paging, and validates the query', async () => {
    const c = ctx();
    const auth = await adminAuth();
    await createArticle(auth, 'Клек');
    await createArticle(auth, 'Хранене');

    const list = await c
      .http()
      .get('/api/articles?search=клек&status=DRAFT&page=1&pageSize=10')
      .set(auth)
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });

    await c.http().get('/api/articles?status=LIVE').set(auth).expect(400);
    await c.http().get('/api/articles?categoryId=x').set(auth).expect(400);
    await c.http().get('/api/articles?pageSize=51').set(auth).expect(400);
  });

  it('validates ids', async () => {
    const c = ctx();
    const auth = await adminAuth();

    await c.http().get(`/api/articles/${UNKNOWN_ID}`).set(auth).expect(404);
    await c.http().get('/api/articles/not-a-uuid').set(auth).expect(400);
    await c
      .http()
      .patch(`/api/articles/${UNKNOWN_ID}/draft`)
      .set(auth)
      .send({ baseRevision: 0 })
      .expect(404);
  });
});
