import { foldLine, icsText, trainingIcs } from './training-ics';

/** Friday 13 Nov 2026, 18:00-19:00 in Sofia (UTC+2). */
const TRAINING = {
  slotId: '0b9e3c1a-5d2f-4e6a-8b7c-9d0e1f2a3b4c',
  startsAt: new Date('2026-11-13T16:00:00Z'),
  endsAt: new Date('2026-11-13T17:00:00Z'),
  gym: { name: 'Plovdiv', address: 'ul. Ranni list 13, Plovdiv' },
  trainerName: 'Krasimir Peykov',
  workoutTitle: null,
};
const NOW = new Date('2026-11-12T10:00:00.123Z');

/** The file's content lines, unfolded. */
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('trainingIcs', () => {
  it('is one event with the time, the address, the trainer and a reminder 30 minutes before', () => {
    const ics = trainingIcs(TRAINING, 'en', NOW);

    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(lines(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//The Index//Trainings//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:training-0b9e3c1a-5d2f-4e6a-8b7c-9d0e1f2a3b4c@theindex.training',
      'DTSTAMP:20261112T100000Z',
      'DTSTART:20261113T160000Z',
      'DTEND:20261113T170000Z',
      'SUMMARY:CrossFit training',
      'LOCATION:ul. Ranni list 13\\, Plovdiv',
      'DESCRIPTION:Group instructor: Krasimir Peykov',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:CrossFit training',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('is written in Bulgarian, with the workout once it is out and the gym when it has no address', () => {
    const ics = trainingIcs(
      {
        ...TRAINING,
        gym: { name: 'Пловдив', address: '  ' },
        trainerName: 'Красимир Пейков',
        workoutTitle: 'Fran',
      },
      'bg',
      NOW,
    );

    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        'SUMMARY:CrossFit тренировка',
        'LOCATION:Пловдив',
        'DESCRIPTION:Групов инструктор: Красимир Пейков\\nТренировка на деня: Fran',
        'DESCRIPTION:CrossFit тренировка',
      ]),
    );
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const ics = trainingIcs(
      { ...TRAINING, trainerName: 'Красимир Пейков', workoutTitle: 'Fran' },
      'bg',
      NOW,
    );

    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('\r\n ');
    expect(lines(ics)).toContain(
      'DESCRIPTION:Групов инструктор: Красимир Пейков\\nТренировка на деня: Fran',
    );
  });
});

describe('icsText', () => {
  it('escapes backslashes, semicolons, commas and line breaks', () => {
    expect(icsText('a\\b; c, d\r\ne\nf')).toBe('a\\\\b\\; c\\, d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves a line of 75 octets alone and folds a longer one', () => {
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldLine('x'.repeat(80))).toBe(
      `${'x'.repeat(75)}\r\n ${'x'.repeat(5)}`,
    );
    // Two-octet letters: 37 fit in the first 75 octets, 37 in each next 74.
    expect(foldLine('я'.repeat(40)).split('\r\n ')).toEqual([
      'я'.repeat(37),
      'я'.repeat(3),
    ]);
  });
});
