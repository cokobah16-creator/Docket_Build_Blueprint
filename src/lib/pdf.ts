// Minimal, dependency-free PDF writer for text documents (invoices and
// receipts). One or more A4 pages, Helvetica / Helvetica-Bold, WinAnsi text.

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  gap?: number; // extra space after the line, in points
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

function escapePdf(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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
    if (y - lead < MARGIN) flush();
    y -= lead;
    const font = line.bold ? "/F2" : "/F1";
    ops.push(`BT ${font} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapePdf(line.text)}) Tj ET`);
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
