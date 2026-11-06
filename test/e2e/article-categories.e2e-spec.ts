import { messageOf, setupE2eSuite } from './e2e-app';

/**
 * Article categories over HTTP: request validation (trimming, slug format, unknown fields, ids)
 * and the status codes of the service rules. The rules themselves (slug generation and
 * uniqueness, name clashes, ordering) are covered in
 * `src/article-categories/article-categories.service.int-spec.ts`; access is in the role matrix.
 */
const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

type CategoryBody = {
  id: string;
  language: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
};

describe('Article categories (e2e)', () => {
  const ctx = setupE2eSuite();

  async function adminAuth() {
    return { Authorization: `Bearer ${await ctx().loginAsAdmin()}` };
  }

  it('creates a category with a slug from its trimmed Bulgarian name', async () => {
    const auth = await adminAuth();

    const res = await ctx()
      .http()
      .post('/api/article-categories')
      .set(auth)
      .send({
        name: '  Силова подготовка  ',
        description: '  Как да станем по-силни.  ',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      language: 'bg',
      name: 'Силова подготовка',
      slug: 'silova-podgotovka',
      description: 'Как да станем по-силни.',
      sortOrder: 0,
    });
  });

  it('validates the fields', async () => {
    const auth = await adminAuth();
    const post = (body: object) =>
      ctx()
        .http()
        .post('/api/article-categories')
        .set(auth)
        .send(body)
        .expect(400);

    expect(messageOf((await post({ name: '   ' })).body)).toEqual([
      'name must not be empty',
    ]);
    expect(messageOf((await post({ name: 'А'.repeat(61) })).body)).toEqual([
      'name must be shorter than or equal to 60 characters',
    ]);
    expect(
      messageOf((await post({ name: 'Хранене', slug: 'Хранене' })).body),
    ).toEqual([
      'slug must be lowercase Latin letters and digits joined by single hyphens, e.g. "silova-podgotovka"',
    ]);
    expect(
      messageOf(
        (await post({ name: 'Хранене', description: 'x'.repeat(301) })).body,
      ),
    ).toEqual(['description must be shorter than or equal to 300 characters']);
    expect(
      messageOf((await post({ name: 'Хранене', sortOrder: -1 })).body),
    ).toEqual(['sortOrder must not be less than 0']);
    // Only Bulgarian for now: the language is not the client's to choose.
    expect(
      messageOf((await post({ name: 'Хранене', language: 'en' })).body),
    ).toEqual(['property language should not exist']);
  });

  it('answers 409 for a slug or a name that is taken', async () => {
    const c = ctx();
    const auth = await adminAuth();
    await c
      .http()
      .post('/api/article-categories')
      .set(auth)
      .send({ name: 'Хранене' })
      .expect(201);

    const slug = await c
      .http()
      .post('/api/article-categories')
      .set(auth)
      .send({ name: 'Диета', slug: 'hranene' })
      .expect(409);
    const name = await c
      .http()
      .post('/api/article-categories')
      .set(auth)
      .send({ name: 'хранене' })
      .expect(409);

    expect(messageOf(slug.body)).toBe('The slug "hranene" is already in use');
    expect(messageOf(name.body)).toBe(
      'A category named "Хранене" already exists',
    );
  });

  it('lists, gets, updates and deletes', async () => {
    const c = ctx();
    const auth = await adminAuth();
    const created = (
      await c
        .http()
        .post('/api/article-categories')
        .set(auth)
        .send({ name: 'Хранене' })
        .expect(201)
    ).body as CategoryBody;
    await c
      .http()
      .post('/api/article-categories')
      .set(auth)
      .send({ name: 'Сън' })
      .expect(201);

    const list = await c
      .http()
      .get('/api/article-categories')
      .set(auth)
      .expect(200);
    expect((list.body as CategoryBody[]).map((x) => x.name)).toEqual([
      'Хранене',
      'Сън',
    ]);

    const patched = await c
      .http()
      .patch(`/api/article-categories/${created.id}`)
      .set(auth)
      .send({ name: 'Хранене и добавки', description: null, sortOrder: 5 })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: 'Хранене и добавки',
      slug: 'hranene',
      description: null,
      sortOrder: 5,
    });

    const got = await c
      .http()
      .get(`/api/article-categories/${created.id}`)
      .set(auth)
      .expect(200);
    expect((got.body as CategoryBody).name).toBe('Хранене и добавки');

    const deleted = await c
      .http()
      .delete(`/api/article-categories/${created.id}`)
      .set(auth)
      .expect(200);
    expect(deleted.body).toEqual({ deleted: true });
    await c
      .http()
      .get(`/api/article-categories/${created.id}`)
      .set(auth)
      .expect(404);
  });

  it('rejects null for the fields that always have a value (description may be null)', async () => {
    const c = ctx();
    const auth = await adminAuth();
    const created = (
      await c
        .http()
        .post('/api/article-categories')
        .set(auth)
        .send({ name: 'Хранене' })
        .expect(201)
    ).body as CategoryBody;
    const patch = (body: object) =>
      c
        .http()
        .patch(`/api/article-categories/${created.id}`)
        .set(auth)
        .send(body);

    expect(messageOf((await patch({ name: null }).expect(400)).body)).toContain(
      'name must be a string',
    );
    expect(messageOf((await patch({ slug: null }).expect(400)).body)).toContain(
      'slug must be a string',
    );
    expect(
      messageOf((await patch({ sortOrder: null }).expect(400)).body),
    ).toContain('sortOrder must be an integer number');
    await patch({ description: null }).expect(200);
  });

  it('validates ids', async () => {
    const c = ctx();
    const auth = await adminAuth();

    await c
      .http()
      .get(`/api/article-categories/${UNKNOWN_ID}`)
      .set(auth)
      .expect(404);
    await c
      .http()
      .get('/api/article-categories/not-a-uuid')
      .set(auth)
      .expect(400);
    await c
      .http()
      .patch('/api/article-categories/not-a-uuid')
      .set(auth)
      .send({})
      .expect(400);
    await c
      .http()
      .delete('/api/article-categories/not-a-uuid')
      .set(auth)
      .expect(400);
  });
});
