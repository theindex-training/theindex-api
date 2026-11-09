import { singular } from '../../exercises/exercise-key';
import { ExerciseMeasure } from '../../exercises/exercise.enums';
import {
  ScoreType,
  SYSTEM_WORKOUT_TYPES,
  WorkoutTypeCode,
} from '../../workout-types/workout-type.enums';
import { WorkoutLevel } from '../workout.enums';
import { SheetText } from './sheet-layout';

/**
 * Turns the text of a lesson plan's top band (sheet-layout.ts) into a structured workout draft:
 * the same shape the API saves, with movements still as names. The grammar follows how CrossFit
 * writes workouts ("3 rounds for time:", "AMRAP 12:", "EMOM 20:", "21 KB swings (35/53 lb)",
 * "15/20-cal bike", ":40 row for calories"...). It is a best effort that a trainer reviews: what
 * it can't place becomes a note or a warning, never a silent guess.
 */

export type DraftItem = {
  exerciseName: string;
  measure: ExerciseMeasure;
  quantity: number | null;
  quantityMax: number | null;
  quantityFemale: number | null;
  maxEffort: boolean;
  loadKg: number | null;
  loadFemaleKg: number | null;
  loadPercent: number | null;
  slot: number | null;
  notes: string | null;
};

export type DraftVariant = {
  level: WorkoutLevel;
  rounds: number | null;
  repScheme: number[] | null;
  durationSeconds: number | null;
  timeCapSeconds: number | null;
  intervalSeconds: number | null;
  workSeconds: number | null;
  restSeconds: number | null;
  notes: string | null;
  items: DraftItem[];
};

export type DraftPart = {
  title: string | null;
  typeCode: WorkoutTypeCode;
  scoreType: ScoreType;
  variants: DraftVariant[];
};

export type WorkoutDraft = {
  /** The plan's number, e.g. "261109". */
  sourceCode: string | null;
  /** The day the number stands for (YYMMDD), 'YYYY-MM-DD'. */
  date: string | null;
  title: string | null;
  parts: DraftPart[];
  warnings: string[];
};

const { REPS, DISTANCE, TIME, CALORIES } = ExerciseMeasure;
const LB_IN_KG = 0.45359237;
const POOD_IN_KG = 16.38;
const METRES: Record<string, number> = {
  m: 1,
  meter: 1,
  metre: 1,
  km: 1000,
  ft: 0.3048,
  foot: 0.3048,
  feet: 0.3048,
  mi: 1609.34,
  mile: 1609.34,
  yd: 0.9144,
  yard: 0.9144,
};
const VARIANT_NOTES_MAX = 500;
const ITEM_NOTES_MAX = 200;

const defaultScore = (code: WorkoutTypeCode) =>
  SYSTEM_WORKOUT_TYPES.find((t) => t.code === code)!.scoreType;

export function parseSheet(sheet: SheetText): WorkoutDraft {
  const warnings: string[] = [];
  const draft: WorkoutDraft = {
    ...parseHeading(sheet.heading),
    parts: [],
    warnings,
  };
  if (!draft.date) warnings.push('The date could not be read from the heading');

  const rx = parseColumn(sheet.rx, WorkoutLevel.RX);
  if (!rx || !rx.variant.items.length) {
    warnings.push('The RX workout could not be read');
  } else {
    const main: DraftPart = {
      title: null,
      typeCode: rx.typeCode,
      scoreType: rx.scoreType,
      variants: [rx.variant],
    };
    const others = [
      [WorkoutLevel.INTERMEDIATE, sheet.intermediate, 'Intermediate'],
      [WorkoutLevel.BEGINNER, sheet.beginner, 'Beginner'],
    ] as const;
    for (const [level, lines, label] of others) {
      if (!lines.length || /^same as rx/i.test(clean(lines[0]))) continue;
      const column = parseColumn(lines, level);
      if (column?.variant.items.length) main.variants.push(column.variant);
      else warnings.push(`The ${label} workout could not be read`);
    }
    draft.parts.push(main);
  }

  const skill = sheet.skill.map(clean).filter(Boolean);
  if (skill.length && !/^rest\b/i.test(skill[0])) {
    // A heading such as "Pre-workout build-up" comes first; work lines start with an amount.
    const titled = !/^[\d:]/.test(skill[0]) && !skill[0].endsWith(':');
    const title = titled ? skill[0] : null;
    const column = parseColumn(
      titled ? skill.slice(1) : skill,
      WorkoutLevel.RX,
    );
    if (column?.variant.items.length) {
      const part: DraftPart = {
        title: title ?? 'Skill',
        typeCode: column.typeCode,
        // Skill work is practice, whatever shape it takes.
        scoreType: ScoreType.NONE,
        variants: [column.variant],
      };
      if (title && /^pre\b/i.test(title)) draft.parts.unshift(part);
      else draft.parts.push(part);
    } else {
      warnings.push(`The skill work "${skill.join(' ')}" could not be read`);
    }
  }
  return draft;
}

/** "261109 // HELEN | TASK PRIORITY" -> number, day and name. */
export function parseHeading(
  heading: string,
): Pick<WorkoutDraft, 'sourceCode' | 'date' | 'title'> {
  const match =
    /^(\d{2})(\d{2})(\d{2})\b\s*(?:\/\/\s*([^|]+?))?\s*(?:\|.*)?$/.exec(
      heading.trim(),
    );
  if (!match) return { sourceCode: null, date: null, title: null };
  const [, yy, mm, dd, name] = match;
  const date = `20${yy}-${mm}-${dd}`;
  const real =
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
  return {
    sourceCode: `${yy}${mm}${dd}`,
    date: real ? date : null,
    title: name ? titleCase(name.trim()) : null,
  };
}

type Column = {
  typeCode: WorkoutTypeCode;
  scoreType: ScoreType;
  variant: DraftVariant;
};

/** One column of the band: a workout for one level, or the skill work. */
export function parseColumn(raw: string[], level: WorkoutLevel): Column | null {
  const lines = joinWrapped(raw.map(clean).filter(Boolean));
  if (!lines.length) return null;

  const variant: DraftVariant = {
    level,
    rounds: null,
    repScheme: null,
    durationSeconds: null,
    timeCapSeconds: null,
    intervalSeconds: null,
    workSeconds: null,
    restSeconds: null,
    notes: null,
    items: [],
  };
  let typeCode: WorkoutTypeCode | null = null;
  let scoreType: ScoreType | null = null;
  const notes: string[] = [];

  for (const line of lines) {
    const cap = timeCap(line);
    if (cap) variant.timeCapSeconds = cap;

    const header = parseHeader(line);
    if (header) {
      typeCode = header.typeCode ?? typeCode;
      Object.assign(variant, header.fields);
      if (header.item) variant.items.push(header.item);
      continue;
    }

    if (line.startsWith('- ')) {
      const text = line.slice(2).trim();
      const bare = text.replace(/\.$/, '');
      if (/^score is (the )?total reps/i.test(bare)) {
        scoreType = ScoreType.REPS;
        continue;
      }
      if (/^score is .*\b(load|weight|heaviest)\b/i.test(bare)) {
        scoreType = ScoreType.LOAD;
        continue;
      }
      const after = /^(.+) after each round$/i.exec(bare);
      const extra = after ? parseItems(after[1], false) : [];
      if (extra.length) {
        for (const item of extra) {
          variant.items.push({
            ...item,
            notes: note(item.notes, 'After each round'),
          });
        }
        continue;
      }
      if (!cap) notes.push(text);
      continue;
    }

    if (/^\d+(-\d+)+$/.test(line)) {
      variant.repScheme = line.split('-').map(Number);
      continue;
    }
    // "Deadlift 5-3-1-5-3-1-5-3-1" on one line.
    const lift = /^(\D.*?)\s+(\d+(?:-\d+)+)$/.exec(line);
    if (lift) {
      const [item] = parseItems(lift[1], true);
      if (item) {
        variant.repScheme = lift[2].split('-').map(Number);
        variant.items.push(item);
        continue;
      }
    }

    const items = line.endsWith(':') ? [] : parseItems(line, true);
    if (items.length) variant.items.push(...items);
    else notes.push(line);
  }

  if (!typeCode) {
    // A lift with a rep scheme and nothing else is a heavy day: "Deadlift 5-3-1-5-3-1-5-3-1".
    const lifts =
      !!variant.repScheme &&
      variant.items.length > 0 &&
      variant.items.every((i) => i.quantity === null && !i.maxEffort);
    typeCode = lifts ? WorkoutTypeCode.FOR_LOAD : WorkoutTypeCode.QUALITY;
  }
  scoreType ??= defaultScore(typeCode);

  // "Min. 1 | :40 row for calories ... Score is total reps": each station is as much as
  // possible in its time.
  if (typeCode === WorkoutTypeCode.EMOM && scoreType === ScoreType.REPS) {
    for (const item of variant.items) {
      if (item.slot && item.measure === TIME && item.quantity) {
        item.maxEffort = true;
      }
    }
  }
  if (notes.length) variant.notes = notes.join(' ').slice(0, VARIANT_NOTES_MAX);
  return { typeCode, scoreType, variant };
}

type Header = {
  typeCode?: WorkoutTypeCode;
  fields: Partial<DraftVariant>;
  item?: DraftItem;
};

/** A line that says how the work is organised rather than what is done. */
function parseHeader(line: string): Header | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d+) rounds?,? (?:each )?for time(?: of)?:?$/i.exec(line))) {
    return { typeCode: WorkoutTypeCode.FOR_TIME, fields: { rounds: +m[1] } };
  }
  if (/^for time(?: of)?:?$/i.test(line)) {
    return { typeCode: WorkoutTypeCode.FOR_TIME, fields: {} };
  }
  if ((m = /^(\d+(?:-\d+)+)(?: reps)?,? for time(?: of)?:?$/i.exec(line))) {
    return {
      typeCode: WorkoutTypeCode.FOR_TIME,
      fields: { repScheme: m[1].split('-').map(Number) },
    };
  }
  if (
    (m = /^AMRAP (?:in )?(\d+)(?::(\d\d))?(?:[- ]min(?:ute)?s?)?:?$/i.exec(
      line,
    )) ||
    (m = /^(\d+)()[- ]min(?:ute)? AMRAP:?$/i.exec(line))
  ) {
    return {
      typeCode: WorkoutTypeCode.AMRAP,
      fields: { durationSeconds: +m[1] * 60 + +(m[2] || 0) },
    };
  }
  if (
    (m = /^EMOM (?:for |x ?)?(\d+)(?::00)?(?:[- ]min(?:ute)?s?)?:?$/i.exec(
      line,
    ))
  ) {
    return {
      typeCode: WorkoutTypeCode.EMOM,
      fields: { intervalSeconds: 60, durationSeconds: +m[1] * 60 },
    };
  }
  if (
    (m =
      /^every (\d*:\d\d|\d+ min(?:ute)?s?)(?:,? for (\d+) (sets?|rounds?|min(?:ute)?s?))?\b.*:$/i.exec(
        line,
      ))
  ) {
    const fields: Partial<DraftVariant> = { intervalSeconds: seconds(m[1]) };
    if (m[2] && /^min/i.test(m[3])) fields.durationSeconds = +m[2] * 60;
    else if (m[2]) fields.rounds = +m[2];
    return { typeCode: WorkoutTypeCode.EMOM, fields };
  }
  if ((m = /^tabata\b:?\s*(.*)$/i.exec(line))) {
    const [item] = m[1] ? parseItems(m[1], true) : [];
    return {
      typeCode: WorkoutTypeCode.TABATA,
      fields: { rounds: 8, workSeconds: 20, restSeconds: 10 },
      item: item && { ...item, maxEffort: true },
    };
  }
  if ((m = /^(\d+) (?:sets?|rounds?|attempts?):$/i.exec(line))) {
    return { fields: { rounds: +m[1] } };
  }
  if ((m = /^on an? (\d*:\d\d) clock:$/i.exec(line))) {
    return { fields: { durationSeconds: seconds(m[1]) } };
  }
  return null;
}

/**
 * The movements on one line: usually one, several when joined with "+" ("4 power snatches +
 * 4 squat snatches"). `bare` allows a name without an amount ("Snatch (125/185 lb)").
 */
export function parseItems(text: string, bare: boolean): DraftItem[] {
  let rest = text.trim();
  let slot: number | null = null;
  const station = /^min(?:ute)?\.? ?(\d+) ?\| ?(.+)$/i.exec(rest);
  if (station) {
    slot = +station[1];
    rest = station[2];
  }
  const pieces = rest.split(/\s+\+\s+/);
  const joined = pieces.map((piece) => parseItem(piece, false));
  const items = joined.every((item) => item)
    ? (joined as DraftItem[])
    : [parseItem(rest, bare)].filter((item) => item !== null);
  return items.map((item) => ({ ...item, slot }));
}

function parseItem(text: string, bare: boolean): DraftItem | null {
  let rest = text.trim().replace(/\.$/, '');
  const item: DraftItem = {
    exerciseName: '',
    measure: REPS,
    quantity: null,
    quantityMax: null,
    quantityFemale: null,
    maxEffort: false,
    loadKg: null,
    loadFemaleKg: null,
    loadPercent: null,
    slot: null,
    notes: null,
  };
  let m: RegExpExecArray | null;

  if ((m = /\/(side|leg|arm|hand)$/i.exec(rest))) {
    item.notes = note(item.notes, `Per ${m[1].toLowerCase()}`);
    rest = rest.slice(0, m.index).trim();
  }
  if (
    (m =
      /\s*\((\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?[- ]?(lbs?|kg|poods?)\)/i.exec(
        rest,
      ))
  ) {
    const unit = m[3].toLowerCase();
    const factor =
      unit === 'kg' ? 1 : unit.startsWith('lb') ? LB_IN_KG : POOD_IN_KG;
    const loads = [m[1], m[2]].filter(Boolean).map((v) => toKg(+v, factor));
    item.loadKg = Math.max(...loads);
    // Written women's/men's: the lighter one is the women's.
    if (loads.length === 2 && loads[0] !== loads[1]) {
      item.loadFemaleKg = Math.min(...loads);
    }
    rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim();
  }
  if ((m = /\s*@ ?(\d+) ?%(?: of [\w-]+)?/i.exec(rest))) {
    item.loadPercent = +m[1];
    rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim();
  }
  if ((m = /\s*\(([^)]*)\)$/.exec(rest))) {
    item.notes = note(item.notes, m[1].trim());
    rest = rest.slice(0, m.index).trim();
  }
  if (
    (m =
      /\s+for (?:max(?:imum)? )?(?:calories|reps|distance|meters|metres)$/i.exec(
        rest,
      ))
  ) {
    item.maxEffort = true;
    rest = rest.slice(0, m.index).trim();
  }

  const pair = (first: string, second: string | undefined, factor = 1) => {
    const values = [first, second]
      .filter(Boolean)
      .map((v) => Math.max(1, Math.round(number(v!) * factor)));
    item.quantity = Math.max(...values);
    if (values.length === 2 && values[0] !== values[1]) {
      item.quantityFemale = Math.min(...values);
    }
  };

  if (
    (m =
      /^(\d[\d,.]*)(?:\/(\d[\d,.]*))?[- ]?(m|meters?|metres?|km|ft|foot|feet|mi|miles?|yd|yards?)\b\.?\s+(.+)$/i.exec(
        rest,
      ))
  ) {
    item.measure = DISTANCE;
    pair(m[1], m[2], METRES[m[3].toLowerCase().replace(/s$/, '')] ?? 1);
    rest = m[4];
  } else if (
    (m = /^(\d+)(?:\/(\d+))?[- ]?cal(?:orie)?s?\b\.?\s+(.+)$/i.exec(rest))
  ) {
    item.measure = CALORIES;
    pair(m[1], m[2]);
    rest = m[3];
  } else if ((m = /^(\d*:\d\d)\s+(.+)$/.exec(rest))) {
    item.measure = TIME;
    item.quantity = seconds(m[1]);
    rest = m[2];
  } else if (
    (m = /^(\d+)[- ]?(sec(?:ond)?s?|min(?:ute)?s?)\b\.?\s+(.+)$/i.exec(rest))
  ) {
    item.measure = TIME;
    item.quantity = +m[1] * (/^min/i.test(m[2]) ? 60 : 1);
    rest = m[3];
  } else if ((m = /^(\d+)-(\d+)\s+(.+)$/.exec(rest))) {
    item.quantity = +m[1];
    item.quantityMax = +m[2] > +m[1] ? +m[2] : null;
    rest = m[3];
  } else if ((m = /^(\d+)(?:\/(\d+))?\s+(.+)$/.exec(rest))) {
    pair(m[1], m[2]);
    rest = m[3];
  } else if (
    (m = /^max(?:imum)?[- ](?:effort |reps (?:of )?)?(.+)$/i.exec(rest))
  ) {
    item.maxEffort = true;
    if (/\b(hang|hold|plank|support|l-sit|sit)\b/i.test(m[1]))
      item.measure = TIME;
    rest = m[1];
  } else if (!bare && !item.maxEffort) {
    return null;
  }
  if (item.quantity !== null && item.quantity < 1) return null;

  rest = rest.replace(/^of\s+/i, '').trim();
  // A name is words, not a sentence: at most 60 characters, starting with a letter.
  if (!/^\p{L}/u.test(rest) || rest.length > 60 || /[.,:;!?]/.test(rest)) {
    return null;
  }
  item.exerciseName = displayName(rest);
  if (item.notes) item.notes = item.notes.slice(0, ITEM_NOTES_MAX);
  return item;
}

/** "- Time cap: 15:00", "(12-minute cap)" -> seconds. */
function timeCap(line: string): number | null {
  let m: RegExpExecArray | null;
  if ((m = /\b(?:time )?cap(?: of)?:? (\d+:\d\d)\b/i.exec(line)))
    return seconds(m[1]);
  if ((m = /\b(\d+)[- ]min(?:ute)?s?(?: time)? cap\b/i.exec(line)))
    return +m[1] * 60;
  if ((m = /\b(?:time )?cap(?: of)?:? (\d+) min/i.exec(line)))
    return +m[1] * 60;
  return null;
}

/** ":40" -> 40, "2:00" -> 120, "3 minutes" -> 180. */
function seconds(text: string): number {
  const clock = /^(\d*):(\d\d)$/.exec(text);
  if (clock) return +(clock[1] || 0) * 60 + +clock[2];
  return parseInt(text, 10) * 60;
}

const number = (text: string) => Number(text.replace(/,/g, ''));

/** Whole kilograms: converted loads are a starting point the trainer adjusts. */
const toKg = (value: number, factor: number) =>
  factor === 1 ? value : Math.max(1, Math.round(value * factor));

const note = (existing: string | null, more: string) =>
  existing ? `${existing}; ${more}` : more;

/** Typographic quotes and dashes as plain ones, single spaces. */
function clean(line: string): string {
  return line
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A line that starts with a lowercase letter continues the one before ("... after" / "each round."). */
function joinWrapped(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    if (joined.length && /^\p{Ll}/u.test(line)) {
      joined[joined.length - 1] += ` ${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined;
}

/** "pull-ups" -> "Pull-up", "KB swings" -> "KB swing": the name a new exercise would get. */
function displayName(name: string): string {
  const one = name.replace(/[\p{L}]+$/u, (word) =>
    word === word.toUpperCase() ? word : singular(word.toLowerCase()),
  );
  return one.charAt(0).toUpperCase() + one.slice(1);
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (start) => start.toUpperCase());
}
