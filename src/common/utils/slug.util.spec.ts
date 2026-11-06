import { SLUG_MAX_LENGTH, isValidSlug, slugify, uniqueSlug } from './slug.util';

describe('slugify', () => {
  it('transliterates every Bulgarian letter with the Streamlined System', () => {
    expect(slugify('абвгдежзийклмнопрстуфхцчшщъьюя')).toBe(
      'abvgdezhziyklmnoprstufhtschshshtayyuya',
    );
    expect(slugify('АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЬЮЯ')).toBe(
      'abvgdezhziyklmnoprstufhtschshshtayyuya',
    );
  });

  it('turns titles into lowercase hyphenated slugs', () => {
    expect(slugify('Как да започнем с КросФит')).toBe(
      'kak-da-zapochnem-s-krosfit',
    );
    expect(slugify('Защо клековете са важни?')).toBe(
      'zashto-klekovete-sa-vazhni',
    );
  });

  it('writes "ия" at the end of a word as "ia", and as "iya" elsewhere', () => {
    expect(slugify('София')).toBe('sofia');
    expect(slugify('Мария и Илиян')).toBe('maria-i-iliyan');
    expect(slugify('Мария, тренировка')).toBe('maria-trenirovka');
  });

  it('writes the word "България" as "bulgaria" (the law\'s exception)', () => {
    expect(slugify('Кросфит в България')).toBe('krosfit-v-bulgaria');
    // Only the word itself: other forms follow the table.
    expect(slugify('Българията')).toBe('balgariyata');
    expect(slugify('български')).toBe('balgarski');
    expect(slugify('Минибългария')).toBe('minibalgaria');
  });

  it('keeps Latin letters and digits, and strips accents', () => {
    expect(slugify('5 съвета за 2027 г.')).toBe('5-saveta-za-2027-g');
    expect(slugify('WOD: Fran 21-15-9')).toBe('wod-fran-21-15-9');
    expect(slugify('Café Crème')).toBe('cafe-creme');
  });

  it('turns punctuation, quotes and dashes into single hyphens', () => {
    expect(slugify('„Мърфи“ – WOD-ът за Деня на паметта!')).toBe(
      'marfi-wod-at-za-denya-na-pametta',
    );
    expect(slugify('  много   --  интервали  ')).toBe('mnogo-intervali');
  });

  it('drops apostrophes instead of splitting the word', () => {
    expect(slugify('It’s Rock ’n’ Roll')).toBe('its-rock-n-roll');
  });

  it('treats a decomposed "й" (и + combining breve) like "й"', () => {
    expect(slugify('Чйт')).toBe('chyt');
    expect(slugify('Чйт')).toBe('chyt');
  });

  it('returns an empty slug when there are no letters or digits', () => {
    expect(slugify('💪🔥')).toBe('');
    expect(slugify(' ?! – ')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('drops letters outside the Bulgarian and Latin alphabets', () => {
    // Russian "ы" and "э" are not in the Bulgarian table.
    expect(slugify('рыба и эхо')).toBe('r-ba-i-ho');
  });

  it(`keeps slugs within ${SLUG_MAX_LENGTH} characters, ending on a whole word`, () => {
    const title =
      'Как да изградим сила, издръжливост и гъвкавост през първите шест месеца в залата';
    const slug = slugify(title);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toBe(
      'kak-da-izgradim-sila-izdrazhlivost-i-gavkavost-prez-parvite-shest-mesetsa-v',
    );
    expect(`${slugify(title, 1000)}-`.startsWith(`${slug}-`)).toBe(true);
  });

  it('cuts a single word longer than the limit at the limit', () => {
    expect(slugify('а'.repeat(100))).toBe('a'.repeat(SLUG_MAX_LENGTH));
  });

  it('keeps a slug that ends exactly at the limit', () => {
    const exact = `${'a'.repeat(39)} ${'b'.repeat(40)}`; // 39 + hyphen + 40 = 80
    expect(slugify(exact)).toBe(`${'a'.repeat(39)}-${'b'.repeat(40)}`);
    expect(slugify(`${exact} c`)).toBe(`${'a'.repeat(39)}-${'b'.repeat(40)}`);
  });

  it('always returns a valid slug or an empty string', () => {
    const titles = [
      'Как да започнем с КросФит',
      '„Цитат“ — тире, точка. И още!!!',
      '-- водещи и крайни тирета --',
      'Ёжик в тумане',
      'Тест_с_долни_черти',
      '100% усилие',
      '🏋️ Тежести 🏋️',
      'à la carte',
    ];
    for (const title of titles) {
      const slug = slugify(title);
      expect(slug === '' || isValidSlug(slug)).toBe(true);
    }
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase letters and digits joined by single hyphens', () => {
    expect(isValidSlug('kak-da-zapochnem')).toBe(true);
    expect(isValidSlug('wod-21-15-9')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of [
      '',
      'Kak-da',
      'как-да',
      '-kak',
      'kak-',
      'kak--da',
      'kak da',
      'kak_da',
      'kak.da',
    ]) {
      expect(isValidSlug(value)).toBe(false);
    }
  });

  it(`rejects slugs longer than ${SLUG_MAX_LENGTH} characters`, () => {
    expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('uniqueSlug', () => {
  const options = { fallback: 'statia' };

  it('returns the slug itself when it is free', () => {
    expect(uniqueSlug('sofia', ['sofia-2', 'plovdiv'], options)).toBe('sofia');
  });

  it('adds -2, -3, ... until the slug is free', () => {
    expect(uniqueSlug('sofia', ['sofia'], options)).toBe('sofia-2');
    expect(uniqueSlug('sofia', ['sofia', 'sofia-2', 'sofia-3'], options)).toBe(
      'sofia-4',
    );
  });

  it('fills the first gap', () => {
    expect(uniqueSlug('sofia', ['sofia', 'sofia-3'], options)).toBe('sofia-2');
  });

  it('never returns a reserved slug', () => {
    expect(
      uniqueSlug('category', [], { ...options, reserved: ['category'] }),
    ).toBe('category-2');
  });

  it('uses the fallback when the title gave no slug, and keeps it unique', () => {
    expect(uniqueSlug('', [], options)).toBe('statia');
    expect(uniqueSlug('', ['statia', 'statia-2'], options)).toBe('statia-3');
  });

  it('shortens the base at a word so the suffixed slug still fits', () => {
    const base = `${'a'.repeat(40)}-${'b'.repeat(39)}`; // exactly 80 characters
    const slug = uniqueSlug(base, [base], options);

    expect(slug).toBe(`${'a'.repeat(40)}-2`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it('shortens a base longer than the limit before checking it', () => {
    const base = `${'a'.repeat(70)}-${'b'.repeat(20)}`;
    expect(uniqueSlug(base, [], options)).toBe('a'.repeat(70));
  });

  it('rejects an invalid fallback', () => {
    expect(() => uniqueSlug('', [], { fallback: 'Статия' })).toThrow(
      'Invalid fallback slug',
    );
  });
});
