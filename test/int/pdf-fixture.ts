/**
 * A minimal one-page PDF with the given texts at the given positions (Helvetica 9 pt), so the
 * import can be tested end to end, through the real pdf.js, without committing a lesson plan.
 */
export function pdfWithText(
  texts: { text: string; x: number; y: number }[],
): Buffer {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1');
  const stream = texts
    .map(
      (t) => `BT /F1 9 Tf 1 0 0 1 ${t.x} ${t.y} Tm (${escape(t.text)}) Tj ET`,
    )
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** A lesson plan's top band, laid out as in the real PDFs, plus a little of the plan below. */
export function lessonPlanPdf(
  heading: string,
  columns: {
    rx: string[];
    intermediate: string[];
    beginner: string[];
    skill: string[];
  },
): Buffer {
  const heads = [
    ['RX', 14, columns.rx],
    ['INTERMEDIATE', 163, columns.intermediate],
    ['BEGINNER', 312, columns.beginner],
    ['SKILL', 461, columns.skill],
  ] as const;
  const texts = [{ text: heading, x: 14, y: 772 }];
  for (const [name, x, lines] of heads) {
    texts.push({ text: name, x, y: 747.3 });
    lines.forEach((text, i) => texts.push({ text, x, y: 732.3 - i * 11 }));
  }
  texts.push(
    { text: 'WHITE', x: 64, y: 605 },
    { text: 'INTENDED STIMULUS', x: 110, y: 618 },
    { text: '10 pull-ups', x: 343, y: 596 },
  );
  return pdfWithText(texts);
}
