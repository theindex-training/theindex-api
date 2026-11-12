/**
 * Finds the workout in the text of a CrossFit affiliate-programming lesson plan (the PDFs the
 * trainers get). Only the band at the top is read: the heading ("261109 // HELEN | TASK
 * PRIORITY") and the four columns under RX, INTERMEDIATE, BEGINNER and SKILL. The lesson plan
 * below it (stimulus, warm-ups, cooldown) is ignored.
 */

/** A piece of text on the page; `y` grows upwards, as in PDF coordinates. */
export type TextItem = { text: string; x: number; y: number };

export type SheetText = {
  heading: string;
  rx: string[];
  intermediate: string[];
  beginner: string[];
  skill: string[];
};

const COLUMNS = ['RX', 'INTERMEDIATE', 'BEGINNER', 'SKILL'] as const;
/** The first lines of the lesson plan, which end the band. */
const BELOW_THE_BAND = new Set(['INTENDED STIMULUS', 'WHITE', 'WHITE BOARD']);
/** Texts within this distance are on one line. */
const SAME_LINE = 2.5;
/** How far the band reaches when nothing marks its end. */
const BAND_HEIGHT = 220;

const placeOf = (item: TextItem) =>
  `${Math.round(item.x)}|${Math.round(item.y)}|${item.text}`;

export function sheetFromItems(raw: TextItem[]): SheetText | null {
  const all = raw
    .map((item) => ({ ...item, text: item.text.replace(/\s+/g, ' ').trim() }))
    .filter((item) => item.text);

  // Some of these PDFs carry the same text several times, and once more shifted by a line.
  // The real one is the copy that is repeated most; where all are equal, the first.
  const copies = new Map<string, number>();
  for (const item of all) {
    copies.set(placeOf(item), (copies.get(placeOf(item)) ?? 0) + 1);
  }
  const rxHeaders = all.filter((item) => item.text === 'RX');
  if (!rxHeaders.length) return null;
  const rx = rxHeaders.reduce((best, item) =>
    copies.get(placeOf(item))! > copies.get(placeOf(best))! ? item : best,
  );
  const wanted = copies.get(placeOf(rx))!;
  const seen = new Set<string>();
  const items = all.filter((item) => {
    const place = placeOf(item);
    if (copies.get(place)! < wanted || seen.has(place)) return false;
    seen.add(place);
    return true;
  });

  const headers = COLUMNS.map((name) =>
    items.find(
      (item) => item.text === name && Math.abs(item.y - rx.y) <= SAME_LINE,
    ),
  );
  if (headers.some((h) => !h)) return null;
  const starts = headers.map((h) => h!.x);

  const headingItem = items
    .filter((item) => item.y > rx.y + SAME_LINE && /^\d{6}\b/.test(item.text))
    .sort((a, b) => a.y - b.y)[0];
  const heading = headingItem
    ? lineTexts(
        items.filter((item) => Math.abs(item.y - headingItem.y) <= SAME_LINE),
      ).join(' ')
    : '';

  const below = items
    .filter((item) => item.y < rx.y && BELOW_THE_BAND.has(item.text))
    .map((item) => item.y);
  const bottom = below.length ? Math.max(...below) : rx.y - BAND_HEIGHT;
  const band = items.filter(
    (item) => item.y < rx.y - SAME_LINE && item.y > bottom + SAME_LINE,
  );

  const column = (index: number) => {
    const from = starts[index] - SAME_LINE;
    const to =
      index + 1 < starts.length ? starts[index + 1] - SAME_LINE : Infinity;
    return lineTexts(band.filter((item) => item.x >= from && item.x < to));
  };
  return {
    heading,
    rx: column(0),
    intermediate: column(1),
    beginner: column(2),
    skill: column(3),
  };
}

/** The items as lines of text, top to bottom, each line left to right. */
function lineTexts(items: TextItem[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - item.y) <= SAME_LINE) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) =>
    line
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(' '),
  );
}
