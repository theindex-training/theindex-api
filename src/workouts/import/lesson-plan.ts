import { singular } from '../../exercises/exercise-key';
import { SheetText } from './sheet-layout';

/**
 * What the workouts take from a lesson plan's top band (sheet-layout.ts): the day and name in its
 * heading, the RX column's text as printed, and the movements that text names. The other columns
 * (Intermediate, Beginner, Skill) are not read.
 */
export type LessonPlan = {
  /** The plan's number, e.g. "261109". */
  sourceCode: string | null;
  /** The day the number stands for (YYMMDD), 'YYYY-MM-DD'. */
  date: string | null;
  /** A name when the heading has one ("261109 // HELEN" -> "Helen"). */
  title: string | null;
  /** The RX column, a line per printed line (wrapped lines joined). Empty when there is none. */
  summary: string;
  /** The movements the RX column names, in order, each once, as a new exercise would be named. */
  movements: string[];
};

export function readLessonPlan(sheet: SheetText): LessonPlan {
  const lines = rxLines(sheet.rx);
  return {
    ...parseHeading(sheet.heading),
    summary: lines.join('\n'),
    movements: movementNames(lines),
  };
}

/**
 * "261109 // HELEN | TASK PRIORITY" -> number, day and name. Some plans print the name without
 * the "//" ("261102 DEATH ZONE | TIME PRIORITY").
 */
export function parseHeading(
  heading: string,
): Pick<LessonPlan, 'sourceCode' | 'date' | 'title'> {
  const match =
    /^(\d{2})(\d{2})(\d{2})\b\s*(?:\/\/)?\s*([^|]*?)\s*(?:\|.*)?$/.exec(
      heading.trim(),
    );
  if (!match) return { sourceCode: null, date: null, title: null };
  const [, yy, mm, dd, name] = match;
  const date = `20${yy}-${mm}-${dd}`;
  const time = Date.parse(`${date}T00:00:00Z`);
  const real =
    !Number.isNaN(time) && new Date(time).toISOString().startsWith(date);
  return {
    sourceCode: `${yy}${mm}${dd}`,
    date: real ? date : null,
    title: name ? titleCase(name.trim()) : null,
  };
}

/**
 * The column's lines with spaces squeezed. A line that starts with a lowercase letter continues
 * the one before: the PDF wrapped it ("- 30-ft handstand walk after" / "each round.").
 */
export function rxLines(raw: string[]): string[] {
  const lines: string[] = [];
  for (const line of raw.map((l) => l.replace(/\s+/g, ' ').trim())) {
    if (!line) continue;
    if (lines.length && /^\p{Ll}/u.test(line)) {
      lines[lines.length - 1] += ` ${line}`;
    } else {
      lines.push(line);
    }
  }
  return lines;
}

/** The movements named in the lines, in order, each once (by their key). */
export function movementNames(lines: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const name of movementsInLine(line)) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
  }
  return names;
}

const AMOUNT =
  /^(?:\d[\d,.]*(?:\/\d[\d,.]*)?|\d*:\d\d)(?:[- ]?(?:m|meters?|metres?|km|ft|foot|feet|mi|miles?|yd|yards?|cal|calories?|sec|seconds?|min|minutes?|reps?)\b\.?)?\s+(?:of\s+)?/i;
const RANGE = /^\d+-\d+\s+/;
const MAX_EFFORT = /^max(?:imum)?[- ](?:effort\s+|reps\s+(?:of\s+)?)?/i;

/**
 * The movements a line names: "21 KB swings (35/53 lb)" -> ["KB swing"], "Min. 2 | :40 sit-ups"
 * -> ["Sit-up"], "4 power snatches + 4 squat snatches" -> two. Headings ("3 rounds for time:",
 * "AMRAP 12:"), rep schemes ("5-3-1") and remarks ("- Score is total reps.") name none; a remark
 * "- 30-ft handstand walk after each round." names its movement.
 */
export function movementsInLine(line: string): string[] {
  let text = line.trim();
  if (text.endsWith(':') || /^[\d\s-]+$/.test(text)) return [];
  if (text.startsWith('-')) {
    const after = /^-\s*(.+?)\s+after each round\.?$/i.exec(text);
    if (!after) return [];
    text = after[1];
  }
  text = text.replace(/^min(?:ute)?\.?\s*\d+\s*\|\s*/i, '');
  return text.split(/\s+\+\s+/).flatMap((piece) => {
    const name = movementName(piece);
    return name ? [name] : [];
  });
}

function movementName(piece: string): string | null {
  let rest = piece
    .replace(/\([^)]*\)/g, ' ')
    .replace(/@\s*\d+\s*%(?:\s+of\s+\S+)?/gi, ' ')
    .replace(/\/(?:side|leg|arm|hand)\b/gi, ' ')
    .replace(
      /\s+for\s+(?:max(?:imum)?\s+)?(?:calories|reps|distance|meters|metres)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
  rest = rest
    .replace(RANGE, '')
    .replace(AMOUNT, '')
    .replace(MAX_EFFORT, '')
    .trim();
  // A name is a few words: it starts with a letter and has no sentence punctuation.
  if (!/^\p{L}/u.test(rest) || rest.length > 60 || /[.,:;!?|]/.test(rest)) {
    return null;
  }
  return displayName(rest);
}

/** "pull-ups" -> "Pull-up", "KB swings" -> "KB swing": the name a new exercise would get. */
function displayName(name: string): string {
  const one = name.replace(/\p{L}+$/u, (word) =>
    word === word.toUpperCase() ? word : singular(word.toLowerCase()),
  );
  return one.charAt(0).toUpperCase() + one.slice(1);
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (start) => start.toUpperCase());
}
