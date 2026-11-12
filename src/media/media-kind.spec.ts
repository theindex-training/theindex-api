import {
  MEDIA_KINDS,
  MediaKind,
  contentTypeOf,
  inlineDisposition,
  itemFolder,
} from './media-kind';

describe('media kinds', () => {
  it('keeps article images public and workout PDFs private, each in its own folder', () => {
    expect(MEDIA_KINDS[MediaKind.ARTICLE_IMAGE]).toEqual({
      area: 'public',
      folder: 'article-images',
    });
    expect(MEDIA_KINDS[MediaKind.WORKOUT_PDF]).toEqual({
      area: 'private',
      folder: 'workout-pdfs',
    });
    expect(itemFolder(MediaKind.WORKOUT_PDF, 'abc')).toBe('workout-pdfs/abc');
  });

  it('gives a stored file its content type from the extension', () => {
    expect(contentTypeOf('workout-pdfs/a/original.pdf')).toBe(
      'application/pdf',
    );
    expect(contentTypeOf('article-images/a/master.JPG')).toBe('image/jpeg');
    expect(contentTypeOf('a/w480.webp')).toBe('image/webp');
    expect(contentTypeOf('a/master.png')).toBe('image/png');
    expect(contentTypeOf('a/file')).toBe('application/octet-stream');
    expect(contentTypeOf('a/file.exe')).toBe('application/octet-stream');
  });
});

describe('inlineDisposition', () => {
  it('names the file as uploaded, with an ASCII fallback for Cyrillic names', () => {
    expect(inlineDisposition('261109.pdf')).toBe(
      `inline; filename="261109.pdf"; filename*=UTF-8''261109.pdf`,
    );
    expect(inlineDisposition('Тренировка 9.11.pdf')).toBe(
      `inline; filename="__________ 9.11.pdf"; filename*=UTF-8''%D0%A2%D1%80%D0%B5%D0%BD%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0%209.11.pdf`,
    );
  });

  it('drops quotes, slashes and control characters that could break the header', () => {
    expect(inlineDisposition('a"b\\c/d\r\ne.pdf')).toBe(
      `inline; filename="abcde.pdf"; filename*=UTF-8''abcde.pdf`,
    );
    expect(inlineDisposition("it's (1).pdf")).toBe(
      `inline; filename="it's (1).pdf"; filename*=UTF-8''it%27s%20%281%29.pdf`,
    );
    expect(inlineDisposition(' "" ')).toBe(
      `inline; filename="file"; filename*=UTF-8''file`,
    );
  });
});
