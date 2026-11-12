import { sheetFromItems, TextItem } from './sheet-layout';

/** Positions as in the real lesson plans: heading at 772, column heads at 747, 11 pt lines. */
const COLUMN_X = { RX: 14, INTERMEDIATE: 163, BEGINNER: 312, SKILL: 461 };

function page(
  heading: string,
  columns: Record<keyof typeof COLUMN_X, string[]>,
): TextItem[] {
  const items: TextItem[] = [{ text: heading, x: 14, y: 772 }];
  for (const [name, x] of Object.entries(COLUMN_X)) {
    items.push({ text: name, x: x + 0.1, y: 747.3 });
    columns[name as keyof typeof COLUMN_X].forEach((text, line) =>
      items.push({ text, x, y: 732.3 - line * 11 }),
    );
  }
  // The lesson plan under the band.
  items.push(
    { text: 'WHITE', x: 64, y: 605 },
    { text: 'INTENDED STIMULUS', x: 110, y: 618 },
    { text: '8:00-15:00.', x: 124, y: 607 },
    { text: 'GENERAL WARM-UP', x: 343, y: 618 },
    { text: '10 pull-ups', x: 343, y: 596 },
    { text: 'Copyright', x: 229, y: 8 },
  );
  return items;
}

const HELEN = {
  RX: ['3 rounds for time:', '400-m run', '12 pull-ups'],
  INTERMEDIATE: ['Same as Rx’d'],
  BEGINNER: ['3 rounds for time:', '200-m run', '12 ring rows'],
  SKILL: ['Rest, stretch, recover.'],
};

describe('sheetFromItems', () => {
  it('reads the heading and the four columns, and nothing of the lesson plan below', () => {
    expect(
      sheetFromItems(page('261109 // HELEN | TASK PRIORITY', HELEN)),
    ).toEqual({
      heading: '261109 // HELEN | TASK PRIORITY',
      rx: ['3 rounds for time:', '400-m run', '12 pull-ups'],
      intermediate: ['Same as Rx’d'],
      beginner: ['3 rounds for time:', '200-m run', '12 ring rows'],
      skill: ['Rest, stretch, recover.'],
    });
  });

  it('does not depend on the order the text comes in', () => {
    const items = page('261109 | TASK PRIORITY', HELEN);
    expect(sheetFromItems([...items].reverse())).toEqual(sheetFromItems(items));
  });

  it('joins the pieces of one line, left to right', () => {
    const items = page('261109', { ...HELEN, RX: ['21 KB swings'] });
    items.push({ text: '(35/53 lb)', x: 70, y: 732.3 });

    expect(sheetFromItems(items)?.rx).toEqual(['21 KB swings (35/53 lb)']);
  });

  it('ignores repeated copies of the text, and a copy shifted by a line', () => {
    const real = page('261114 | TIME PRIORITY', HELEN);
    const shifted = real
      .filter((item) => item.y > 640)
      .map((item) => ({ ...item, y: item.y + 11 }));

    expect(sheetFromItems([...real, ...real, ...shifted, ...real])).toEqual(
      sheetFromItems(real),
    );
  });

  it('ignores empty texts and squeezes spaces', () => {
    const items = page('261109', { ...HELEN, RX: ['  400-m   run ', ' '] });

    expect(sheetFromItems(items)?.rx).toEqual(['400-m run']);
  });

  it('gives null when a column head is missing', () => {
    const items = page('261109', HELEN);

    expect(sheetFromItems(items.filter((i) => i.text !== 'SKILL'))).toBeNull();
    expect(sheetFromItems(items.filter((i) => i.text !== 'RX'))).toBeNull();
    expect(sheetFromItems([])).toBeNull();
  });

  it('gives an empty heading when no line above the columns starts with the number', () => {
    const items = page('WORKOUT OF THE DAY', HELEN);

    expect(sheetFromItems(items)?.heading).toBe('');
  });
});
