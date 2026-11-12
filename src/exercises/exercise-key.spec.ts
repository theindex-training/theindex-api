import { exerciseKey } from './exercise-key';

describe('exerciseKey', () => {
  it.each([
    ['Pull-ups', 'pull up'],
    ['pull up', 'pull up'],
    ['PULL-UP', 'pull up'],
    ['KB swings', 'kettlebell swing'],
    ['Kettlebell swing', 'kettlebell swing'],
    ['Snatches', 'snatch'],
    ['Skin-the-cats', 'skin the cat'],
    ['Toes-to-bars', 'toe to bar'],
    ['T2B', 'toe to bar'],
    ['Box jumps', 'box jump'],
    ['Burpees', 'burpee'],
    ['Bench press', 'bench press'],
    ['Clean & jerk', 'clean and jerk'],
    ['Double-unders', 'double under'],
    ['Farmer’s carry', 'farmer carry'],
    ['  Wall   ball  ', 'wall ball'],
    ['Клек', 'клек'],
  ])('%s -> %s', (name, key) => {
    expect(exerciseKey(name)).toBe(key);
  });

  it('gives an empty key for a name without letters or digits', () => {
    expect(exerciseKey(' - / ')).toBe('');
  });
});
