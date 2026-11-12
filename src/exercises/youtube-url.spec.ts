import { youtubeVideoId, youtubeWatchUrl } from './youtube-url';

describe('youtubeVideoId', () => {
  it.each([
    'https://www.youtube.com/watch?v=rMvwVtlqjTE',
    'https://youtube.com/watch?v=rMvwVtlqjTE&t=42s',
    'https://m.youtube.com/watch?feature=share&v=rMvwVtlqjTE',
    'http://www.youtube.com/watch?v=rMvwVtlqjTE',
    'https://youtu.be/rMvwVtlqjTE',
    'https://youtu.be/rMvwVtlqjTE?si=abc123',
    'https://www.youtube.com/embed/rMvwVtlqjTE?autoplay=1&rel=0',
    'https://www.youtube-nocookie.com/embed/rMvwVtlqjTE',
    'https://www.youtube.com/shorts/rMvwVtlqjTE',
    'https://www.youtube.com/live/rMvwVtlqjTE',
    '  https://WWW.YOUTUBE.COM/watch?v=rMvwVtlqjTE  ',
  ])('%s -> rMvwVtlqjTE', (link) => {
    expect(youtubeVideoId(link)).toBe('rMvwVtlqjTE');
  });

  it('keeps ids with "-" and "_"', () => {
    expect(youtubeVideoId('https://youtu.be/_-9_46by2JI')).toBe('_-9_46by2JI');
  });

  it.each([
    'rMvwVtlqjTE',
    'not a link',
    'https://vimeo.com/123456789',
    'https://www.crossfit.com/essentials/the-air-squat',
    'https://www.youtube.com/channel/UCtcQ6TPwXAYgZ1Mcl3M1vng',
    'https://www.youtube.com/playlist?list=PL0123456789',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=rMvwVtlqjTEtoolong',
    'https://youtube.com.evil.example/watch?v=rMvwVtlqjTE',
    'javascript:alert(1)//youtu.be/rMvwVtlqjTE',
    'ftp://youtu.be/rMvwVtlqjTE',
  ])('refuses %s', (link) => {
    expect(youtubeVideoId(link)).toBeNull();
  });
});

describe('youtubeWatchUrl', () => {
  it('builds the watch link', () => {
    expect(youtubeWatchUrl('rMvwVtlqjTE')).toBe(
      'https://www.youtube.com/watch?v=rMvwVtlqjTE',
    );
  });
});
