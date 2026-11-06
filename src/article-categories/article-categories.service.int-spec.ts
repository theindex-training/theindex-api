import { ConflictException, NotFoundException } from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { ArticleCategoriesModule } from './article-categories.module';
import { ArticleCategoriesService } from './article-categories.service';
import { ArticleCategoryEntity } from './article-category.entity';

const UNKNOWN_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

describe('ArticleCategoriesService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [ArticleCategoriesModule],
  });
  const svc = (fx: Fixtures) => fx.moduleRef.get(ArticleCategoriesService);
  const rows = (fx: Fixtures) =>
    fx.ds
      .getRepository(ArticleCategoryEntity)
      .find({ order: { sortOrder: 'ASC' } });

  describe('create', () => {
    it('makes a Latin slug from the Bulgarian name and stores the category', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        name: 'Силова подготовка',
        description: 'Как да станем по-силни.',
      });

      expect(created).toMatchObject({
        language: 'bg',
        name: 'Силова подготовка',
        slug: 'silova-podgotovka',
        description: 'Как да станем по-силни.',
        sortOrder: 0,
      });
      expect(await rows(fx)).toHaveLength(1);
    });

    it('makes the slug unique with -2, -3 when another category already has it', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Хранене', slug: 'hranene' });
      await svc(fx).create({ name: 'Хранене и сън', slug: 'hranene-2' });

      // A different name whose slug would also be "hranene".
      const created = await svc(fx).create({ name: 'ХРАНЕНЕ!' });

      expect(created.slug).toBe('hranene-3');
    });

    it('uses "kategoria" when the name gives no slug', async () => {
      const fx = fixtures();

      expect((await svc(fx).create({ name: '💪' })).slug).toBe('kategoria');
      expect((await svc(fx).create({ name: '🔥' })).slug).toBe('kategoria-2');
    });

    it('uses a slug the admin chose', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        name: 'WOD',
        slug: 'wod-na-denya',
      });

      expect(created.slug).toBe('wod-na-denya');
    });

    it('rejects a chosen slug that is already in use', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Хранене' });

      const error = await rejectionOf(
        svc(fx).create({ name: 'Диета', slug: 'hranene' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe('The slug "hranene" is already in use');
      expect(await rows(fx)).toHaveLength(1);
    });

    it('rejects a name that already exists, ignoring case', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Мобилност' });

      const error = await rejectionOf(svc(fx).create({ name: 'МОБИЛНОСТ' }));

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe('A category named "Мобилност" already exists');
    });

    it('puts a new category after the last one unless told otherwise', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'A', sortOrder: 5 });

      const next = await svc(fx).create({ name: 'B' });
      const explicit = await svc(fx).create({ name: 'C', sortOrder: 2 });

      expect(next.sortOrder).toBe(6);
      expect(explicit.sortOrder).toBe(2);
    });

    it('stores an empty description as none', async () => {
      const fx = fixtures();

      expect(
        (await svc(fx).create({ name: 'A', description: '' })).description,
      ).toBeNull();
      expect((await svc(fx).create({ name: 'B' })).description).toBeNull();
    });
  });

  describe('list', () => {
    it('returns the categories in navigation order, then by name', async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Възстановяване', sortOrder: 1 });
      await svc(fx).create({ name: 'Тренировки', sortOrder: 0 });
      await svc(fx).create({ name: 'Общност', sortOrder: 1 });

      const names = (await svc(fx).list()).map((c) => c.name);

      expect(names).toEqual(['Тренировки', 'Възстановяване', 'Общност']);
    });
  });

  describe('update', () => {
    it('keeps the slug when the category is renamed', async () => {
      const fx = fixtures();
      const category = await svc(fx).create({ name: 'Хранене' });

      const updated = await svc(fx).update(category.id, {
        name: 'Хранене и добавки',
      });

      expect(updated).toMatchObject({
        name: 'Хранене и добавки',
        slug: 'hranene',
      });
    });

    it('changes the slug only when asked, and checks it is free', async () => {
      const fx = fixtures();
      const category = await svc(fx).create({ name: 'Хранене' });
      await svc(fx).create({ name: 'Сън' });

      const moved = await svc(fx).update(category.id, {
        slug: 'hranene-i-dobavki',
      });
      const clash = await rejectionOf(
        svc(fx).update(category.id, { slug: 'san' }),
      );

      expect(moved.slug).toBe('hranene-i-dobavki');
      expect(clash).toBeInstanceOf(ConflictException);
      expect((await svc(fx).get(category.id)).slug).toBe('hranene-i-dobavki');
    });

    it('accepts its own current name and slug', async () => {
      const fx = fixtures();
      const category = await svc(fx).create({ name: 'Хранене' });

      const updated = await svc(fx).update(category.id, {
        name: 'Хранене',
        slug: 'hranene',
        sortOrder: 3,
      });

      expect(updated).toMatchObject({ slug: 'hranene', sortOrder: 3 });
    });

    it("rejects renaming to another category's name, ignoring case", async () => {
      const fx = fixtures();
      await svc(fx).create({ name: 'Сън' });
      const category = await svc(fx).create({ name: 'Хранене' });

      const error = await rejectionOf(
        svc(fx).update(category.id, { name: 'сън' }),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((await svc(fx).get(category.id)).name).toBe('Хранене');
    });

    it('removes the description with null or an empty string, and leaves it when absent', async () => {
      const fx = fixtures();
      const a = await svc(fx).create({ name: 'A', description: 'Текст' });
      const b = await svc(fx).create({ name: 'B', description: 'Текст' });

      expect((await svc(fx).update(a.id, { sortOrder: 9 })).description).toBe(
        'Текст',
      );
      expect(
        (await svc(fx).update(a.id, { description: null })).description,
      ).toBeNull();
      expect(
        (await svc(fx).update(b.id, { description: '' })).description,
      ).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the category', async () => {
      const fx = fixtures();
      const category = await svc(fx).create({ name: 'Хранене' });

      expect(await svc(fx).delete(category.id)).toEqual({ deleted: true });
      expect(await rows(fx)).toHaveLength(0);
    });
  });

  it('answers 404 for an unknown id', async () => {
    const fx = fixtures();

    // One at a time: a promise that rejects before it is awaited would be reported as unhandled.
    for (const call of [
      () => svc(fx).get(UNKNOWN_ID),
      () => svc(fx).update(UNKNOWN_ID, { name: 'X' }),
      () => svc(fx).delete(UNKNOWN_ID),
    ]) {
      const error = await rejectionOf(call());
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Category not found');
    }
  });

  it('lets only one of two concurrent creates have the same slug (409 for the other)', async () => {
    const fx = fixtures();

    // Both can pass the "slug is free" check before either saves; the unique index on
    // (language, slug) then rejects the second save, which the service turns into a 409.
    const results = await Promise.allSettled([
      svc(fx).create({ name: 'Първа', slug: 'edna-i-sashta' }),
      svc(fx).create({ name: 'Втора', slug: 'edna-i-sashta' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((r) => r.status === 'rejected');
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect((rejected.reason as Error).message).toBe(
      'The slug "edna-i-sashta" is already in use',
    );
    expect(await rows(fx)).toHaveLength(1);
  });
});
