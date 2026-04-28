/**
 * Lightweight document parsers used by /api/upload-files to enrich Office files
 * (DOCX / PPTX / XLSX) with extracted plain-text content. The parsed text is
 * surfaced to the LLM as additional context so designs faithfully reflect
 * uploaded briefs, decks, and spreadsheets.
 *
 * Implementation note: we deliberately avoid heavy dependencies (mammoth,
 * sheetjs, etc.). Office documents are zipped XML; we unpack with JSZip and
 * walk the XML for <w:t>, <a:t>, and <c><v> nodes. This covers the 95% case
 * of "extract the words I typed" without pulling 30 MB of vendor code into
 * the bundle.
 */

import JSZip from 'jszip';

const MAX_TEXT = 60_000;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function clip(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}\n\n…[truncated to ${MAX_TEXT} chars]`;
}

/** Extract concatenated text from <w:t>...</w:t> tags inside word/document.xml. */
async function parseDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = zip.file('word/document.xml');
  if (!documentXml) return '';
  const xml = await documentXml.async('string');
  const out: string[] = [];
  for (const m of xml.matchAll(/<w:p[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const para: string[] = [];
    const inner = m[1] ?? '';
    for (const t of inner.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
      para.push(decodeXmlEntities(t[1] ?? ''));
    }
    const joined = para.join('').trim();
    if (joined) out.push(joined);
  }
  return clip(out.join('\n'));
}

/** Extract slide-by-slide text from ppt/slides/slide*.xml inside a PPTX. */
async function parsePptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  const out: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const file = zip.file(slides[i] ?? '');
    if (!file) continue;
    const xml = await file.async('string');
    const lines: string[] = [];
    for (const t of xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)) {
      const text = decodeXmlEntities(t[1] ?? '').trim();
      if (text) lines.push(text);
    }
    if (lines.length > 0) {
      out.push(`### Slide ${i + 1}\n${lines.join('\n')}`);
    }
  }
  return clip(out.join('\n\n'));
}

/** Extract sheet-by-sheet cell text from xl/sharedStrings.xml + xl/worksheets/sheet*.xml inside an XLSX. */
async function parseXlsx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  // Shared strings table — referenced by `<c t="s"><v>index</v></c>` in sheets.
  const sharedStrings: string[] = [];
  const sst = zip.file('xl/sharedStrings.xml');
  if (sst) {
    const xml = await sst.async('string');
    for (const m of xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
      const inner = m[1] ?? '';
      const parts: string[] = [];
      for (const t of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
        parts.push(decodeXmlEntities(t[1] ?? ''));
      }
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();

  const out: string[] = [];
  for (let i = 0; i < sheetFiles.length; i += 1) {
    const file = zip.file(sheetFiles[i] ?? '');
    if (!file) continue;
    const xml = await file.async('string');
    const rows: string[] = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowInner = rowMatch[1] ?? '';
      const cells: string[] = [];
      for (const cellMatch of rowInner.matchAll(/<c[^>]*?(?:\s+t="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const type = cellMatch[1];
        const cellInner = cellMatch[2] ?? '';
        const valueMatch = cellInner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const inlineMatch = cellInner.match(/<is[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        let value = '';
        if (inlineMatch) value = decodeXmlEntities(inlineMatch[1] ?? '');
        else if (valueMatch) {
          const raw = decodeXmlEntities(valueMatch[1] ?? '');
          if (type === 's') {
            const idx = Number(raw);
            value = Number.isFinite(idx) ? sharedStrings[idx] ?? '' : raw;
          } else {
            value = raw;
          }
        }
        if (value !== '') cells.push(value);
      }
      if (cells.length > 0) rows.push(cells.join('\t'));
    }
    if (rows.length > 0) {
      out.push(`### Sheet ${i + 1}\n${rows.join('\n')}`);
    }
  }
  return clip(out.join('\n\n'));
}

export interface ParsedDocument {
  /** True if we found and extracted readable text. */
  parsed: boolean;
  /** Extracted plain-text body, ready to splice into the prompt. */
  text: string;
  /** Best-guess of the source format. */
  kind: 'docx' | 'pptx' | 'xlsx' | 'unsupported';
}

/** Inspect an upload's mime type / filename and extract plain text when possible. */
export async function parseOfficeDocument(
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  const lower = filename.toLowerCase();
  try {
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.docx')
    ) {
      const text = await parseDocx(buffer);
      return { parsed: text.length > 0, text, kind: 'docx' };
    }
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      lower.endsWith('.pptx')
    ) {
      const text = await parsePptx(buffer);
      return { parsed: text.length > 0, text, kind: 'pptx' };
    }
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      lower.endsWith('.xlsx')
    ) {
      const text = await parseXlsx(buffer);
      return { parsed: text.length > 0, text, kind: 'xlsx' };
    }
  } catch (err) {
    return {
      parsed: false,
      text: `[document-parser] Failed to parse ${filename}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      kind: 'unsupported',
    };
  }
  return { parsed: false, text: '', kind: 'unsupported' };
}
