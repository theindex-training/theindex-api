import {
  InvalidSummaryError,
  normalizeSummary,
  sanitizeSummaryText,
  SUMMARY_MAX_BLOCKS,
  summaryFromLines,
  summaryToPlainText,
} from './workout-summary';

const p = (text: string, id?: string) => ({
  ...(id ? { id } : {}),
  type: 'paragraph',
  data: { text },
});

function problem(input: unknown): string {
  try {
    normalizeSummary(input);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSummaryError);
    return (error as Error).message;
  }
  throw new Error('expected the summary to be refused');
}

describe('sanitizeSummaryText', () => {
  it('keeps bold, italic and line breaks, and nothing else', () => {
    expect(
      sanitizeSummaryText(
        '<strong>3 rounds</strong> <em>for time</em><br><a href="https://x.test">link</a> <span style="color:red">red</span><script>alert(1)</script>',
      ),
    ).toBe('<b>3 rounds</b> <i>for time</i><br />link red');
  });

  it('drops line breaks and spaces around the text', () => {
    expect(sanitizeSummaryText('<br>&nbsp; 400-m run <br/>')).toBe('400-m run');
  });
});

describe('normalizeSummary', () => {
  it('stores paragraphs sanitized, drops empty ones and keeps the editor’s ids and version', () => {
    expect(
      normalizeSummary({
        time: 1731200000000,
        version: '2.31.0',
        blocks: [
          p('<b>3 rounds for time:</b>', 'abc123'),
          p('   '),
          p('<br>'),
          p('400-m run<br>21 KB swings (35/53 lb)', 'bad id!'),
        ],
      }),
    ).toEqual({
      time: 1731200000000,
      version: '2.31.0',
      blocks: [
        {
          id: 'abc123',
          type: 'paragraph',
          data: { text: '<b>3 rounds for time:</b>' },
        },
        {
          type: 'paragraph',
          data: { text: '400-m run<br />21 KB swings (35/53 lb)' },
        },
      ],
    });
  });

  it('refuses another shape, another block type, a missing text and an empty summary', () => {
    expect(problem(null)).toBe('summary must be an object with a blocks array');
    expect(problem({ blocks: 'x' })).toBe(
      'summary must be an object with a blocks array',
    );
    expect(
      problem({ blocks: [p('ok'), { type: 'header', data: { text: 'H' } }] }),
    ).toBe(
      'summary paragraph 2: only paragraphs are allowed (bold and italic inside them)',
    );
    expect(problem({ blocks: [{ type: 'paragraph', data: {} }] })).toBe(
      'summary paragraph 1: the text is missing',
    );
    expect(problem({ blocks: [] })).toBe('summary must not be empty');
    expect(problem({ blocks: [p('<b> </b>'), p('<script>x</script>')] })).toBe(
      'summary must not be empty',
    );
  });

  it('refuses too many paragraphs or too much text', () => {
    expect(
      problem({
        blocks: Array.from({ length: SUMMARY_MAX_BLOCKS + 1 }, () => p('x')),
      }),
    ).toBe('summary can have at most 60 paragraphs');
    expect(problem({ blocks: [p('x'.repeat(3001))] })).toBe(
      'summary must be at most 3000 characters of text',
    );
    expect(
      normalizeSummary({ blocks: [p('x'.repeat(3000))] }).blocks,
    ).toHaveLength(1);
  });
});

describe('summaryToPlainText', () => {
  it('gives a line per paragraph and per line break, without markup', () => {
    expect(
      summaryToPlainText({
        blocks: [
          { type: 'paragraph', data: { text: '<b>AMRAP 12:</b>' } },
          {
            type: 'paragraph',
            data: { text: '15/20-cal bike<br />5 ring muscle-ups' },
          },
          { type: 'paragraph', data: { text: 'Fish &amp; chips &lt;3' } },
        ],
      }),
    ).toBe('AMRAP 12:\n15/20-cal bike\n5 ring muscle-ups\nFish & chips <3');
  });
});

describe('summaryFromLines', () => {
  it('makes a paragraph per line, the first in bold, with text escaped', () => {
    const summary = summaryFromLines([
      '3 rounds for time:',
      '400-m run',
      ' ',
      '21 KB swings (35/53 lb) <fast>',
    ]);

    expect(summary.blocks.map((b) => b.data.text)).toEqual([
      '<b>3 rounds for time:</b>',
      '400-m run',
      '21 KB swings (35/53 lb) &lt;fast&gt;',
    ]);
    // What the import makes is accepted as it is.
    expect(normalizeSummary(summary)).toEqual(summary);
  });
});
