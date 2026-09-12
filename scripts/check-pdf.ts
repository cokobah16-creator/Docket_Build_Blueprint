// What the PDF writer must keep true, asserted by running it. `deno run scripts/check-pdf.ts`
// (the `deno` CI job) — src/lib/pdf.ts is dependency-free TypeScript, so deno is the whole oracle.
//
// Two of these were defects found by review: wrapText collapsed every run of whitespace, which
// destroyed the column the invoice aligns its figures in; and the invoice route did not catch the
// refusal the writer throws for a character WinAnsi cannot draw, so a client whose own name
// carries a dot-below vowel was handed a 500. The writer's refusal is deliberate and is asserted
// here too: a legal instrument must never silently print "?" where a name was.

import { PdfEncodingError, textPdf, winAnsiBytes, wrapText } from "../src/lib/pdf.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`PASS ${name}`); return; }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. A run of spaces is the invoice's only column, and it survives wrapping.
const aligned = "Subtotal    NGN 50,000.00";
check("a run of spaces survives wrapText", wrapText(aligned, 10)[0] === aligned, JSON.stringify(wrapText(aligned, 10)[0]));

// 2. It survives all the way into the page's content stream.
const pdf = new TextDecoder("latin1").decode(textPdf([{ text: aligned, size: 10 }]));
check("the content stream carries the run", pdf.includes(`(${aligned}) Tj`), pdf.match(/\(.*?\) Tj/)?.[0] ?? "no Tj");

// 3. Leading indentation is part of the line, not trimmed away.
check("leading indentation is kept", wrapText("    3. The Purchaser shall pay", 10)[0] === "    3. The Purchaser shall pay");

// 4. Wrapping still happens, and a wrapped line neither begins nor ends on whitespace.
const long = `${"word ".repeat(60)}end`;
const lines = wrapText(long, 11);
check("a long paragraph still wraps", lines.length > 1, `${lines.length} lines`);
check("no wrapped line begins or ends on a space", lines.every((l) => l === l.trim()), JSON.stringify(lines.find((l) => l !== l.trim())));

// 5. A word longer than the line is cut rather than overflowing.
check("an over-long word is cut", wrapText("x".repeat(400), 11).length > 1);

// 6. A blank line stays a blank line.
check("a blank line is kept", wrapText("a\n\nb", 11).join("|") === "a||b", wrapText("a\n\nb", 11).join("|"));

// 7. The refusal: the characters this market actually types, named rather than printed as "?".
for (const bad of ["Ọlá & Co. Legal Practitioners", "Chukwuemeka Ọkẹkẹ", "Professional fee ₦250,000"]) {
  let thrown: unknown = null;
  try { textPdf([{ text: bad, size: 10 }]); } catch (e) { thrown = e; }
  check(`refuses unprintable text: ${bad.slice(0, 20)}…`, thrown instanceof PdfEncodingError && (thrown as PdfEncodingError).characters.length > 0);
}

// 8. What WinAnsi does carry is carried: Latin-1 accents and the euro sign, one byte each.
check("WinAnsi text is accepted", winAnsiBytes("Ade & Söhne — €50 “quoted”").unprintable.length === 0,
  winAnsiBytes("Ade & Söhne — €50 “quoted”").unprintable.join(" "));

// 9. The file is a PDF and ends where it says it ends.
const one = new TextDecoder("latin1").decode(textPdf([{ text: "Invoice", size: 12, bold: true }]));
check("the file starts %PDF and ends %%EOF", one.startsWith("%PDF-1.4\n") && one.trimEnd().endsWith("%%EOF"));
const startxref = Number(one.slice(one.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
check("startxref points at the xref table", one.slice(startxref, startxref + 4) === "xref", one.slice(startxref, startxref + 12));

if (failures > 0) { console.error(`\n${failures} check(s) failed`); Deno.exit(1); }
console.log("\nthe PDF writer holds");
