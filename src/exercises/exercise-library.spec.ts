import { exerciseKey } from './exercise-key';
import { EXERCISE_LIBRARY } from './exercise-library';
import { youtubeVideoId, youtubeWatchUrl } from './youtube-url';

const entries = EXERCISE_LIBRARY;

describe('EXERCISE_LIBRARY', () => {
  it('has the 118 crossfit.com movements, each with its own video', () => {
    const videos = entries.flatMap((e) => (e.videoId ? [e.videoId] : []));

    expect(videos).toHaveLength(118);
    expect(new Set(videos).size).toBe(videos.length);
    for (const id of videos) {
      expect(youtubeVideoId(youtubeWatchUrl(id))).toBe(id);
    }
  });

  it('names movements without crossfit.com\'s leading "The"', () => {
    expect(entries.filter((e) => /^the\s/i.test(e.name))).toEqual([]);
  });

  it('no two spellings clash, so every one can be saved', () => {
    const keys = entries.flatMap((e) =>
      [e.name, ...(e.aliases ?? [])].map(exerciseKey),
    );

    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(keys.every(Boolean)).toBe(true);
    // Aliases that repeat their own name would be dropped on save.
    for (const e of entries) {
      for (const alias of e.aliases ?? []) {
        expect(exerciseKey(alias)).not.toBe(exerciseKey(e.name));
      }
    }
  });

  it('names fit the 80 characters an exercise allows', () => {
    expect(entries.filter((e) => e.name.length > 80)).toEqual([]);
  });
});
