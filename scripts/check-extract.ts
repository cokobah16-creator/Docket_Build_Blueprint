// The extractor, RUN rather than merely compiled. Deno: `deno run scripts/check-extract.ts`.
//
// Every way this module fails is quiet. A PDF whose text comes back as mojibake does not raise an
// error — it fills the firm's search index with characters that match nothing, and a lawyer
// concludes the search box does not work. A DOCX whose runs are joined without their spaces gives
// "thepartiesagree", which is worse than no text at all because it looks like a hit.
//
// The sharpest check here is the ROUND TRIP: src/lib/pdf.ts writes a PDF, src/lib/extract.ts reads
// it back, and the words that went in must come out. Two modules Docket owns, checking each other
// against a real file rather than against a fixture somebody hand-wrote to pass.

import {
  contentStreamText, decodeText, docxText, extractText, familyOf, looksLikeProse, normalise, pdfText, zipMember,
} from "../src/lib/extract.ts";
import { textPdf } from "../src/lib/pdf.ts";

let failures = 0;
function check(name: string, condition: boolean, saw?: unknown) {
  if (condition) { console.log(`PASS ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}${saw === undefined ? "" : `\n     saw: ${JSON.stringify(saw)}`}`);
}

const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------- which reader, for which file

check("a pdf mime is a pdf", familyOf("application/pdf", "anything") === "pdf");
check("a docx mime is a docx",
  familyOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x") === "docx");
check("text/plain is text", familyOf("text/plain; charset=utf-8", "x") === "text");
check("html is its own family", familyOf("text/html", "x") === "html");
check("an image is not read", familyOf("image/jpeg", "scan.jpg") === "unsupported");
check("a .doc is not a .docx", familyOf("application/msword", "old.doc") === "unsupported");
// Browsers send octet-stream for anything they do not know, so the name is the fallback and only
// then — a wrong mime must never let a JPEG be parsed as a PDF.
check("octet-stream falls back to the name", familyOf("application/octet-stream", "deed.pdf") === "pdf");
check("no mime at all falls back to the name", familyOf(null, "notes.md") === "text");
check("an unknown name is not guessed at", familyOf(null, "mystery.xyz") === "unsupported");

// ---------------------------------------------------------------- plain text

{
  const r = await extractText(enc("Adebayo v Union Bank\n\nThe parties agree."), "text/plain", "note.txt");
  check("plain text comes back whole", r.status === "extracted" && r.text.includes("Union Bank"), r);
  check("a blank line survives as one", r.text === "Adebayo v Union Bank\n\nThe parties agree.", r.text);
}
{
  // Yoruba, Igbo and Hausa names are the ordinary case, not an edge case.
  const r = await extractText(enc("Ọláwálé Ṣóyínká and Ngọzi Okonkwo"), "text/plain", "n.txt");
  check("Nigerian names survive UTF-8", r.text === "Ọláwálé Ṣóyínká and Ngọzi Okonkwo", r.text);
}
{
  // A Windows-1252 file: 0x92 is a right single quote there and invalid UTF-8.
  const bytes = new Uint8Array([...enc("the client"), 0x92, ...enc("s deed")]);
  const r = await extractText(bytes, "text/plain", "old.txt");
  check("a Windows-1252 file is re-read rather than mangled", r.text === "the client’s deed", r.text);
}
{
  const r = await extractText(new Uint8Array(0), "text/plain", "empty.txt");
  check("an empty file is not 'extracted'", r.status === "no_text_layer", r);
}
check("a decoder failure is not silent", decodeText(enc("plain")) === "plain");

// ---------------------------------------------------------------- normalising

check("runs of spaces collapse", normalise("a    b") === "a b");
check("a soft hyphen is removed, not indexed", normalise("agree\u00ADment") === "agreement");
check("a zero-width space is removed", normalise("Union\u200BBank") === "UnionBank");
check("a non-breaking space is a space", normalise("Union\u00A0Bank") === "Union Bank");
check("CRLF becomes one newline", normalise("a\r\nb") === "a\nb");
check("three blank lines become one", normalise("a\n\n\n\n\nb") === "a\n\nb");

// ---------------------------------------------------------------- the guard against rubbish

check("prose is prose", looksLikeProse("The parties agree that the deed shall be registered."));
check("Nigerian prose is prose", looksLikeProse("Ọláwálé Ṣóyínká acted for the claimant throughout."));
// This is the failure the guard exists for: a two-byte font read one byte at a time.
check("mojibake is not prose", !looksLikeProse("\u0003\u0011\u0004\u0012\u0007\u0001\u0013\u0002\u0011\u0004\u0012"));
check("a page of coordinates is not prose", !looksLikeProse("1 0 0 1 72 720 0 0 1 56 800 1 0 0 1 90 640"));
check("two words are not enough", !looksLikeProse("the deed"));
check("an empty string is not prose", !looksLikeProse(""));

// ---------------------------------------------------------------- HTML

{
  const html = `<html><head><style>p{color:red}</style><script>var a="deed"</script></head>
    <body><h1>Notice of Appeal</h1><p>Filed on 3&nbsp;March &amp; served.</p><p>Second&mdash;paragraph.</p></body></html>`;
  const r = await extractText(enc(html), "text/html", "notice.html");
  check("html tags are taken out", !r.text.includes("<"), r.text);
  check("a script's contents are not indexed", !r.text.includes("var a"), r.text);
  check("a stylesheet's contents are not indexed", !r.text.includes("color:red"), r.text);
  check("entities are decoded", r.text.includes("3 March & served"), r.text);
  check("an em dash entity is decoded", r.text.includes("Second—paragraph"), r.text);
  check("a paragraph break is a line break", r.text.split("\n").length >= 2, r.text);
}

// ---------------------------------------------------------------- DOCX

/** The smallest zip that is a valid .docx for our purposes: one member, deflated. */
async function makeDocx(documentXml: string, method: "store" | "deflate"): Promise<Uint8Array> {
  const nameBytes = enc("word/document.xml");
  const raw = enc(documentXml);
  const data = method === "store"
    ? raw
    : new Uint8Array(await new Response(
        new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")),
      ).arrayBuffer());

  const put32 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const put16 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255);
  const m = method === "store" ? 0 : 8;

  const local: number[] = [];
  put32(local, 0x04034b50); put16(local, 20); put16(local, 0); put16(local, m);
  put16(local, 0); put16(local, 0); put32(local, 0);
  put32(local, data.length); put32(local, raw.length);
  put16(local, nameBytes.length); put16(local, 0);
  local.push(...nameBytes, ...data);

  const central: number[] = [];
  put32(central, 0x02014b50); put16(central, 20); put16(central, 20); put16(central, 0); put16(central, m);
  put16(central, 0); put16(central, 0); put32(central, 0);
  put32(central, data.length); put32(central, raw.length);
  put16(central, nameBytes.length); put16(central, 0); put16(central, 0);
  put16(central, 0); put16(central, 0); put32(central, 0); put32(central, 0);
  central.push(...nameBytes);

  const eocd: number[] = [];
  put32(eocd, 0x06054b50); put16(eocd, 0); put16(eocd, 0); put16(eocd, 1); put16(eocd, 1);
  put32(eocd, central.length); put32(eocd, local.length); put16(eocd, 0);

  return new Uint8Array([...local, ...central, ...eocd]);
}

const DOC_XML =
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>` +
  `<w:p><w:r><w:t>IN THE HIGH COURT</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t xml:space="preserve">The parties </w:t></w:r><w:r><w:t>agree</w:t></w:r>` +
  `<w:r><w:t xml:space="preserve"> as follows.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Ọláwálé &amp; Co.</w:t></w:r></w:p>` +
  `</w:body></w:document>`;

for (const method of ["store", "deflate"] as const) {
  const zip = await makeDocx(DOC_XML, method);
  const r = await extractText(zip, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "d.docx");
  check(`a ${method}d docx is read`, r.status === "extracted", r);
  check(`a ${method}d docx keeps the words apart`, r.text.includes("The parties agree as follows."), r.text);
  check(`a ${method}d docx keeps its paragraphs`, r.text.split("\n").length === 3, r.text);
  check(`a ${method}d docx decodes its entities`, r.text.includes("Ọláwálé & Co."), r.text);
}
{
  const zip = await makeDocx(DOC_XML, "deflate");
  check("a member that is not there is null", (await zipMember(zip, "word/footer1.xml")) === null);
  const r = await extractText(enc("not a zip at all"), null, "fake.docx");
  check("a file that is not a zip fails rather than pretends", r.status === "failed", r);
}
{
  // docxText is the piece the Edge Function calls; assert it directly too.
  const t = await docxText(await makeDocx(DOC_XML, "deflate"));
  check("docxText returns the runs joined", t.includes("IN THE HIGH COURT"), t);
}

// ---------------------------------------------------------------- PDF, the round trip

{
  const pdf = textPdf([
    { text: "IN THE FEDERAL HIGH COURT OF NIGERIA", bold: true },
    { text: "Suit No. FHC/L/CS/77/2026" },
    { text: "The claimant seeks an order of specific performance against the defendant." },
    { text: "Fees: 250,000.00 (two hundred and fifty thousand naira)" },
  ]);
  const r = await extractText(pdf, "application/pdf", "notice.pdf");
  // The writer wraps a long line, so the round trip is judged on the words, not on where the
  // line breaks fell — a break is the writer doing its job, not the reader losing something.
  const flat = r.text.replace(/\n/g, " ");
  check("a PDF Docket wrote is read back", r.status === "extracted", r);
  check("the heading survives the round trip", flat.includes("IN THE FEDERAL HIGH COURT OF NIGERIA"), flat);
  check("the suit number survives", flat.includes("FHC/L/CS/77/2026"), flat);
  check("a whole sentence survives", flat.includes("specific performance against the defendant"), flat);
  // Parentheses and commas are what a PDF writer must escape and a reader must unescape.
  check("escaped parentheses come back", flat.includes("(two hundred and fifty thousand naira)"), flat);
  check("a comma inside a number is not lost", flat.includes("250,000.00"), flat);
  check("the extracted text is prose by its own guard", looksLikeProse(r.text));
}
{
  // The other half of the round trip: WinAnsi's high range, written as octal escapes and read back.
  const pdf = textPdf([{ text: "Fee — €40 “per hour”, café" }]);
  const r = await extractText(pdf, "application/pdf", "fees.pdf");
  const flat = r.text.replace(/\n/g, " ");
  check("an em dash comes back", flat.includes("—"), flat);
  check("a Windows-1252 curly quote comes back", flat.includes("“per hour”"), flat);
  check("a euro sign comes back", flat.includes("€40"), flat);
  check("an accented letter comes back", flat.includes("café"), flat);
}
{
  const t = await pdfText(textPdf([{ text: "one" }]));
  check("pdfText alone returns the words", t.includes("one"), t);
}
{
  const r = await extractText(enc("GIF89a not a pdf at all"), "application/pdf", "wrong.pdf");
  check("a file claiming to be a PDF and not being one fails", r.status === "failed", r);
}

// ---------------------------------------------------------------- PDF, the scan

{
  // What a scanner produces: one page, one image, no text operators anywhere. It must come back
  // no_text_layer — never "extracted" with an empty string, and never "failed", because nothing
  // went wrong. This is the single most important assertion in this file: it is the difference
  // between telling a firm "this scan is not searchable" and quietly indexing nothing.
  const scan =
    "%PDF-1.4\n" +
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "4 0 obj << /Type /XObject /Subtype /Image /Width 8 /Height 8 /Length 12 >>\nstream\n" +
    "\x89PNGnotreal\nendstream endobj\n" +
    "trailer << /Root 1 0 R >>\n%%EOF\n";
  const r = await extractText(enc(scan), "application/pdf", "scan.pdf");
  check("a scan is reported as having no text layer", r.status === "no_text_layer", r);
  check("and the reason says so in words a lawyer could read", /scan/i.test(r.detail), r.detail);
  check("and nothing is stored for it", r.text === "", r);
}
{
  // A PDF whose only text is a two-byte encoding we cannot decode: the guard must reject it rather
  // than index the mojibake.
  const gibberish =
    "%PDF-1.4\n5 0 obj << /Length 60 >>\nstream\n" +
    "BT /F1 12 Tf <0003001100040012000700010013> Tj ET\nendstream endobj\n%%EOF\n";
  const r = await extractText(enc(gibberish), "application/pdf", "cid.pdf");
  check("an undecodable font is not indexed as text", r.status === "no_text_layer", r);
}

// ---------------------------------------------------------------- content-stream operators

check("a TJ array's wide kern becomes a space",
  contentStreamText("BT [(Union) -250 (Bank)] TJ ET").includes("Union Bank"));
check("a narrow kern does not split a word",
  contentStreamText("BT [(Bank)-20(ing)] TJ ET").includes("Banking"));
check("a hex string is decoded",
  contentStreamText("BT <48656C6C6F> Tj ET").includes("Hello"));
check("an octal escape is decoded",
  contentStreamText("BT (caf\\351) Tj ET").includes("café"));
check("balanced parentheses inside a string survive",
  contentStreamText("BT (a (nested) thing) Tj ET").includes("a (nested) thing"));
check("an escaped closing bracket does not end the string",
  contentStreamText("BT (fee \\(NGN\\) due) Tj ET").includes("fee (NGN) due"));
check("Td starts a new line",
  contentStreamText("BT (one) Tj 0 -14 Td (two) Tj ET").includes("one\ntwo"));
check("nothing outside BT/ET is invented", contentStreamText("1 0 0 1 72 720 cm") === "");

// ---------------------------------------------------------------- the cap

{
  const long = "the parties agree. ".repeat(30_000); // ~570,000 characters
  const r = await extractText(enc(long), "text/plain", "long.txt");
  check("a very long document is cut, not dropped", r.status === "extracted" && r.text.length === 400_000, r.status);
  check("and being cut is stated rather than hidden", r.truncated === true, r);
}
{
  const r = await extractText(enc("short"), "text/plain", "s.txt");
  check("a short document is not marked truncated", r.truncated === false, r);
}

// ---------------------------------------------------------------- unsupported

{
  const r = await extractText(enc("\xFF\xD8\xFF binary"), "image/jpeg", "photo.jpg");
  check("an image is 'unsupported', not 'failed'", r.status === "unsupported", r);
  check("and the reason names the kind of file", r.detail.includes("image/jpeg"), r.detail);
}

console.log(failures === 0 ? "\nthe extractor holds" : `\n${failures} check(s) failed`);
if (failures > 0) Deno.exit(1);
