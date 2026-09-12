// Minimal, dependency-free PDF writer for text documents (invoices, receipts, and the documents
// a firm generates from a template). One or more A4 pages, Helvetica / Helvetica-Bold, WinAnsi
// text, wrapped to the page.
//
// WHAT IT CANNOT DO, SAID PLAINLY. The two standard fonts carry the WinAnsi (Windows-1252)
// repertoire: Latin letters with the accents of Western Europe, the common punctuation, the euro
// sign. A character outside it — the Yoruba dot-below vowels, the naira sign, an emoji — cannot
// be drawn by them, and a legal instrument must never silently print "?" where a name was. So
// encoding REFUSES such text and names the characters, and the generator tells the person to
// spell the value in plain letters or wait for an embedded font. No logo, no tables, no form
// fields, no cryptographic signature: what is signed is the bytes, and the database keeps their
// checksum and the record of who signed.

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number; // extra space after the line, in points
}

export class PdfEncodingError extends Error {
  constructor(public characters: string[]) {
    super(`These characters cannot be printed in this document's font: ${characters.join(" ")}. Spell the value in plain letters.`);
  }
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const TEXT_W = PAGE_W - MARGIN * 2;

/** Windows-1252 code points for the characters WinAnsi has above 0x7E that are not Latin-1. */
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** One byte per character in WinAnsi, or the list of characters that have none. */
export function winAnsiBytes(s: string): { bytes: number[]; unprintable: string[] } {
  const bytes: number[] = [];
  const unprintable = new Set<string>();
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09) { bytes.push(0x20); continue; }
    if (cp >= 0x20 && cp <= 0x7e) { bytes.push(cp); continue; }
    if (cp >= 0xa0 && cp <= 0xff) { bytes.push(cp); continue; }
    if (ch in CP1252) { bytes.push(CP1252[ch]); continue; }
    unprintable.add(ch);
  }
  return { bytes, unprintable: Array.from(unprintable) };
}

/** Every character of every line must be printable; the refusal names the ones that are not. */
export function assertPrintable(text: string): void {
  const { unprintable } = winAnsiBytes(text);
  if (unprintable.length > 0) throw new PdfEncodingError(unprintable);
}

function escapePdfBytes(bytes: number[]): string {
  let out = "";
  for (const b of bytes) {
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return out;
}

/** An estimate of Helvetica's advance, good enough to wrap: narrow, wide and average glyphs. */
function textWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    if (/[ilj|'!.,:;I]/.test(ch)) w += 0.28;
    else if (/[mwMW@]/.test(ch)) w += 0.87;
    else if (/[A-Z0-9]/.test(ch)) w += 0.68;
    else if (ch === " ") w += 0.28;
    else w += 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

/**
 * Break a paragraph into lines that fit the text width. A word longer than a line is cut.
 *
 * Runs of spaces are carried through, not collapsed. This writer has no tables: the invoice
 * aligns its figures with runs of spaces (`Subtotal    NGN 50,000.00`) and a generated instrument
 * indents its clauses the same way, so splitting on /\s+/ and rejoining with one space destroyed
 * every column and every indent on the page. A run of whitespace is therefore a token of its own,
 * measured like any other; a tab becomes four spaces here, since the font has no tab and
 * winAnsiBytes would otherwise draw it as a single one. Only the whitespace at a break is
 * dropped, because a line never begins or ends on it.
 */
export function wrapText(text: string, size: number, bold = false, maxWidth = TEXT_W): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.trim() === "") { out.push(""); continue; }
    let line = "";
    let atStart = true; // leading indentation belongs to the line; a wrapped line starts clean
    for (const token of para.match(/\s+|\S+/g) ?? []) {
      if (/^\s+$/.test(token)) {
        if (line !== "" || atStart) line += token.replace(/\t/g, "    ");
        continue;
      }
      atStart = false;
      const candidate = line + token;
      if (textWidth(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
      if (line.trim() !== "") out.push(line.replace(/\s+$/, ""));
      line = "";
      let rest = token;
      while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

export function textPdf(lines: PdfLine[]) {
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN;

  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = PAGE_H - MARGIN;
  };

  for (const line of lines) {
    const size = line.size ?? 11;
    const lead = size * 1.4;
    const bold = Boolean(line.bold);
    for (const piece of wrapText(line.text, size, bold)) {
      if (y - lead < MARGIN) flush();
      y -= lead;
      const font = bold ? "/F2" : "/F1";
      const { bytes, unprintable } = winAnsiBytes(piece);
      if (unprintable.length > 0) throw new PdfEncodingError(unprintable);
      ops.push(`BT ${font} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdfBytes(bytes)}) Tj ET`);
    }
    y -= line.gap ?? 0;
  }
  flush();

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, then (page, content) pairs.
  const objects: string[] = [];
  const pageIds: number[] = [];
  const firstPageObj = 5;
  pages.forEach((_, i) => pageIds.push(firstPageObj + i * 2));

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((content, i) => {
    const pageId = pageIds[i]!;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
