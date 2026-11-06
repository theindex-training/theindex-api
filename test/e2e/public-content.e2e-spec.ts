import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * The public site's endpoints over HTTP: no auth needed, query validation, and the preview token
 * round trip (admin issues it, anyone with it reads the draft, and it never works as a login
 * token). What each endpoint returns is covered in
 * `src/public-content/public-content.service.int-spec.ts`; access is in the role matrix.
 */
describe('Public content (e2e)', () => {
  const ctx = setupE2eSuite();

  async function adminAuth() {
    return { Authorization: `Bearer ${await ctx().loginAsAdmin()}` };
  }

  /** Creates and publishes an article through the admin API; returns its id. */
  async function publishArticle(auth: object, title: string) {
    const http = () => ctx().http();
    const created = await http()
      .post('/api/articles')
      .set(auth)
      .send({ title })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await http()
      .patch(`/api/articles/${id}/draft`)
      .set(auth)
      .send({
        baseRevision: 0,
        content: { blocks: [{ type: 'paragraph', data: { text: 'Текст' } }] },
      })
      .expect(200);
    await http()
      .post(`/api/articles/${id}/publish`)
      .set(auth)
      .send({ baseRevision: 1 })
      .expect(200);
    return id;
  }

  it('serves published articles without a token', async () => {
    const auth = await adminAuth();
    await publishArticle(auth, 'Как да започнем');
    await ctx()
      .http()
      .post('/api/articles')
      .set(auth)
      .send({ title: 'Чернова' })
      .expect(201);

    const list = await ctx().http().get('/api/public/articles').expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 12,
      items: [{ slug: 'kak-da-zapochnem', title: 'Как да започнем' }],
    });
    const items = (list.body as { items: object[] }).items;
    expect(Object.keys(items[0]).sort()).toEqual([
      'categories',
      'excerpt',
      'featuredImage',
      'publishedAt',
      'slug',
      'title',
      'updatedAt',
    ]);

    const article = await ctx()
      .http()
      .get('/api/public/articles/kak-da-zapochnem')
      .expect(200);
    expect(article.body).toMatchObject({
      slug: 'kak-da-zapochnem',
      content: { blocks: [{ type: 'paragraph', data: { text: 'Текст' } }] },
    });
    expect(article.body).not.toHaveProperty('draft');
    expect(article.body).not.toHaveProperty('id');

    await ctx().http().get('/api/public/articles/nyama').expect(404);
    expect(
      (await ctx().http().get('/api/public/sitemap').expect(200)).body,
    ).toMatchObject({
      articles: [{ slug: 'kak-da-zapochnem' }],
      categories: [],
    });
    expect(
      (await ctx().http().get('/api/public/article-categories').expect(200))
        .body,
    ).toEqual([]);
    await ctx().http().get('/api/public/article-categories/nyama').expect(404);
  });

  it('validates the list query', async () => {
    const get = (query: string) =>
      ctx().http().get(`/api/public/articles?${query}`).expect(400);

    expect(messageOf((await get('pageSize=51')).body)).toEqual([
      'pageSize must not be greater than 50',
    ]);
    expect(messageOf((await get('page=0')).body)).toEqual([
      'page must not be less than 1',
    ]);
    expect(messageOf((await get('page=10001')).body)).toEqual([
      'page must not be greater than 10000',
    ]);
    expect(messageOf((await get(`q=${'а'.repeat(101)}`)).body)).toEqual([
      'q must be shorter than or equal to 100 characters',
    ]);
    expect(messageOf((await get('status=DRAFT')).body)).toEqual([
      'property status should not exist',
    ]);

    // A blank search is no search.
    await ctx().http().get('/api/public/articles?q=%20%20').expect(200);
  });

  it('previews a draft with a token from the back office, not with a login token', async () => {
    const auth = await adminAuth();
    const created = await ctx()
      .http()
      .post('/api/articles')
      .set(auth)
      .send({ title: 'Чернова за преглед' })
      .expect(201);
    const id = (created.body as { id: string }).id;

    const issued = await ctx()
      .http()
      .post(`/api/articles/${id}/preview-token`)
      .set(auth)
      .expect(201);
    const { token, expiresAt } = issued.body as {
      token: string;
      expiresAt: string;
    };
    const minutesLeft = (Date.parse(expiresAt) - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(29);
    expect(minutesLeft).toBeLessThanOrEqual(30);

    const preview = await ctx()
      .http()
      .get('/api/public/preview')
      .query({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      preview: true,
      status: 'DRAFT',
      title: 'Чернова за преглед',
      slug: null,
    });
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['x-robots-tag']).toBe('noindex');

    // Neither token works as the other.
    const loginToken = auth.Authorization.slice('Bearer '.length);
    const refused = await ctx()
      .http()
      .get('/api/public/preview')
      .query({ token: loginToken })
      .expect(401);
    expect(messageOf(refused.body)).toBe(
      'The preview link is invalid or has expired',
    );
    await ctx()
      .http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    const missing = await ctx().http().get('/api/public/preview').expect(400);
    expect(messageOf(missing.body)).toContain('token should not be empty');
  });
});
