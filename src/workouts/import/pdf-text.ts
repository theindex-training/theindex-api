import { TextItem } from './sheet-layout';

type PdfTextItem = { str?: string; transform?: number[] };

/**
 * The text of a PDF's first page with its positions, read with pdf.js. The library is ESM-only
 * and loaded on first use, so the API starts (and its other tests run) without it.
 * Throws when the bytes are not a readable PDF.
 */
export async function firstPageText(bytes: Uint8Array): Promise<TextItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given.
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    return (content.items as PdfTextItem[]).flatMap((item) =>
      item.str && item.transform
        ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }]
        : [],
    );
  } finally {
    await task.destroy();
  }
}
