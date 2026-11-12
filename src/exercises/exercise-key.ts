/**
 * The key two spellings of one movement share: "Pull-ups", "pull up" and "PULL-UP" all give
 * "pull up"; "KB swings" and "Kettlebell swing" both give "kettlebell swing". Exercise names and
 * aliases are unique by this key, and the PDF import looks movements up by it.
 */
const ABBREVIATIONS: Record<string, string> = {
  kb: 'kettlebell',
  db: 'dumbbell',
  bb: 'barbell',
  ohs: 'overhead squat',
  hspu: 'handstand push up',
  t2b: 'toe to bar',
  ttb: 'toe to bar',
  c2b: 'chest to bar',
  ctb: 'chest to bar',
  k2e: 'knee to elbow',
  du: 'double under',
  ghd: 'ghd',
  mu: 'muscle up',
  cal: 'calorie',
};

/** Words that end in "s" in the singular. */
const KEEP_S = new Set(['press', 'cross', 'bus', 'abs', 'plus', 'atlas']);

export function singular(word: string): string {
  if (word.length <= 2 || KEEP_S.has(word) || word.endsWith('ss')) return word;
  if (/(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function exerciseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? singular(word))
    .join(' ');
}
