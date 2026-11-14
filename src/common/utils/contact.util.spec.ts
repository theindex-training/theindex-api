import {
  normalizeEmail,
  normalizePhone,
  optionalText,
  PHONE_PATTERN,
  socialLinksPatch,
} from './contact.util';

describe('contact.util', () => {
  describe('PHONE_PATTERN', () => {
    it.each([
      '0888123456',
      '+359 88 123 4567',
      '0888/123-456',
      '(02) 987 65 43',
      ' 0888.123.456 ',
    ])('accepts %p', (phone) => {
      expect(PHONE_PATTERN.test(phone)).toBe(true);
    });

    it.each([
      '',
      '   ',
      '12345',
      'call me',
      '0888 123 abc',
      '++359888123456',
      '1234567890123456',
      '0888-123-456 ext',
    ])('rejects %p', (phone) => {
      expect(PHONE_PATTERN.test(phone)).toBe(false);
    });

    it('runs in linear time on a long run of separators (public endpoint)', () => {
      const spaces = ' '.repeat(200_000);
      const started = performance.now();
      for (const value of [spaces, `${spaces}x`, `+${spaces}`, `(${spaces}`]) {
        expect(PHONE_PATTERN.test(value)).toBe(false);
      }
      // The old pattern took about 0.6 s for 20 000 spaces; this one stays in milliseconds.
      expect(performance.now() - started).toBeLessThan(100);
    });
  });

  it('normalizePhone trims and collapses whitespace', () => {
    expect(normalizePhone('  +359  88\t123   4567 ')).toBe('+359 88 123 4567');
  });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  Ivan.Petrov@Example.COM ')).toBe(
      'ivan.petrov@example.com',
    );
  });

  describe('optionalText', () => {
    it('keeps undefined (not sent) apart from null (cleared)', () => {
      expect(optionalText(undefined)).toBeUndefined();
      expect(optionalText(null)).toBeNull();
    });

    it('trims, and stores an empty or blank value as null', () => {
      expect(optionalText('  @ivan ')).toBe('@ivan');
      expect(optionalText('')).toBeNull();
      expect(optionalText('   ')).toBeNull();
    });
  });

  it('socialLinksPatch keeps only the networks sent', () => {
    expect(
      socialLinksPatch({
        instagram: ' @ivan ',
        facebook: '',
        tiktok: undefined,
      }),
    ).toEqual({ instagram: '@ivan', facebook: null });
    expect(socialLinksPatch({})).toEqual({});
  });
});
