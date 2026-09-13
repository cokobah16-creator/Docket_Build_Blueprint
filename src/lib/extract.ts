// Reading the words inside an uploaded file — and knowing when we cannot.
//
// Search (migration 43) matches a document on its NAME and nothing else, and says so on the screen,
// because Docket held no text from inside a file. This module is the half that changes that. It is
// shared by the extract-text Edge Function and run as a check by scripts/check-extract.ts.
//
// WHAT IT READS, AND WHAT IT REFUSES TO GUESS AT. Three families:
//
//   · text/*  — plain text, Markdown, CSV, and HTML with its tags taken out. Exact.
//   · DOCX    — a zip; word/document.xml is inflated with DecompressionStream and its runs joined.
//               Exact, and dependency-free, which is why DOCX is here and .doc is not.
//   · PDF     — the TEXT LAYER, where one exists. Best effort, and the honesty is in the guard: a
//               PDF whose text does not come back looking like text is recorded as having no text
//               layer rather than indexed as rubbish. See looksLikeProse().
//
// WHAT IT CANNOT DO, SAID PLAINLY. **There is no OCR here.** A scan — which is much of what a
// Nigerian registry hands a firm — is an image of words, not words, and turning it into text needs
// a recognition engine: either a paid API (a per-page cost, and a third party receiving clients'
// documents, which is a disclosure decision nobody has taken) or a model shipped into the runtime.
// Neither is a thing to slip in as an implementation detail. So a scan comes back `no_text_layer`,
// the screens say the file's words are not searchable, and docs/DOCUMENT_TEXT.md carries the
// decision that has to be taken before that changes.

export type ExtractionStatus = "extracted" | "no_text_layer" | "unsupported" | "failed";

export interface Extraction {
  status: ExtractionStatus;
  /** Present only when the status is "extracted". Normalised, and never longer than MAX_CHARS. */
  text: string;
  /** Why, in words a lawyer could read. Empty when the status is "extracted". */
  detail: string;
  /** True when a longer document was cut at MAX_CHARS — stated rather than silently lost. */
  truncated: boolean;
}

/**
 * A tsvector must fit in 1 MB, and a matter's whole file is not a search result anyway. 400,000
 * characters is a few hundred pages of prose; past that the tail is dropped and `truncated` says so.
 */
export const MAX_CHARS = 400_000;

const ok = (text: string, truncated: boolean): Extraction =>
  ({ status: "extracted", text, detail: "", truncated });
const no = (status: Exclude<ExtractionStatus, "extracted">, detail: string): Extraction =>
  ({ status, text: "", detail, truncated: false });

// ---------------------------------------------------------------- the front door

export async function extractText(bytes: Uint8Array, mime: string | null, name: string): Promise<Extraction> {
  try {
    switch (familyOf(mime, name)) {
      case "text": return finish(decodeText(bytes));
      case "html": return finish(stripHtml(decodeText(bytes)));
      case "docx": return finish(await docxText(bytes));
      case "pdf":  return pdfExtraction(await pdfText(bytes));
      default:
        return no("unsupported", `Docket does not read the words inside a ${mime ?? "file of this kind"}.`);
    }
  } catch (e) {
    return no("failed", e instanceof Error ? e.message : "the file could not be read");
  }
}

export type Family = "text" | "html" | "docx" | "pdf" | "unsupported";

/** The mime decides; the extension is consulted only when there is no mime, or a useless one. */
export function familyOf(mime: string | null, name: string): Family {
  const m = (mime ?? "").split(";")[0]!.trim().toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (m === "text/html" || m === "application/xhtml+xml") return "html";
  if (m.startsWith("text/") || m === "application/json") return "text";
  if (m && m !== "application/octet-stream") return "unsupported";

  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "html" || ext === "htm") return "html";
  if (["txt", "md", "markdown", "csv", "tsv", "json", "log"].includes(ext)) return "text";
  return "unsupported";
}

function finish(text: string): Extraction {
  const clean = normalise(text);
  if (clean.length === 0) return no("no_text_layer", "the file holds no readable text.");
  return clean.length > MAX_CHARS ? ok(clean.slice(0, MAX_CHARS), true) : ok(clean, false);
}

/** A PDF is the one family where "we read it and it was not text" is a real, expected answer. */
function pdfExtraction(text: string): Extraction {
  const clean = normalise(text);
  if (clean.length === 0 || !looksLikeProse(clean)) {
    return no(
      "no_text_layer",
      "this PDF carries no text layer that Docket can read — most often because it is a scan. Its words are not searchable.",
    );
  }
  return clean.length > MAX_CHARS ? ok(clean.slice(0, MAX_CHARS), true) : ok(clean, false);
}

/** Runs of whitespace become one space; a blank line survives as a single blank line. */
export function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // Soft hyphens and zero-width characters are invisible and would split a word in the index.
    .replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/[ \t\f\v\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The guard that keeps rubbish out of the index.
 *
 * A PDF whose fonts we cannot decode — a two-byte Identity-H encoding with no ToUnicode map, most
 * often — yields a string of plausible-looking characters that are not words. Indexing that is
 * worse than indexing nothing: the firm gets hits on gibberish and learns not to trust the search
 * box. So: most of the characters must be ones prose is made of, and there must be real words.
 */
export function looksLikeProse(s: string): boolean {
  const chars = [...s];
  if (chars.length < 8) return false;

  // 1. Control characters, replacement characters and private-use glyphs are what an undecoded
  //    two-byte font turns into. A little is a stray; a seventh of the page is not text.
  //    The test is written this way round — count what cannot be prose, rather than allow-listing
  //    what can — because an allow-list rejects an em dash, a naira sign or a Yoruba vowel the
  //    first time one appears, and quietly loses a real document.
  const junk = (s.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\uE000-\uF8FF]/g) ?? []).length;
  if (junk / chars.length > 0.15) return false;

  // 2. There must be words. A page of nothing but coordinates has none.
  const words = s.match(/[A-Za-zÀ-ɏ]{3,}/g) ?? [];
  if (words.length < 3) return false;

  // 3. And letters must be most of what is not whitespace.
  const letters = (s.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  const solid = s.replace(/\s/g, "").length;
  return solid > 0 && letters / solid >= 0.5;
}

// ---------------------------------------------------------------- plain text and HTML

/** UTF-8 first; a file that comes back full of replacement characters is re-read as Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad === 0 || bad / Math.max(utf8.length, 1) < 0.002) return utf8;
  return new TextDecoder("windows-1252").decode(bytes);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
    ndash: "–", mdash: "—", hellip: "…",
  };
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

// ---------------------------------------------------------------- DOCX

/**
 * A .docx is a zip. We want one member of it — word/document.xml — so the central directory is
 * read for that member's offset and compression, its bytes are inflated, and the runs are joined.
 * DecompressionStream is in the runtime, so this needs no library at all.
 */
export async function docxText(bytes: Uint8Array): Promise<string> {
  const xml = await zipMember(bytes, "word/document.xml");
  if (!xml) throw new Error("this .docx has no word/document.xml — it may not be a Word file");
  const text = new TextDecoder("utf-8").decode(xml);
  return decodeEntities(
    text
      .replace(/<w:tab\b[^>]*\/?>/g, "\t")
      .replace(/<w:br\b[^>]*\/?>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      // <w:t xml:space="preserve"> matters: a run may be a single space, and the tag strip below
      // keeps whatever is between the tags, so two words never run together.
      .replace(/<[^>]+>/g, ""),
  );
}

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** One member of a zip, by exact name. Null when the archive does not carry it. */
export async function zipMember(zip: Uint8Array, want: string): Promise<Uint8Array | null> {
  // The end-of-central-directory record is last, after a comment of up to 64 KiB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 65_535; i--) {
    if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("this file is not a zip archive");

  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  for (let n = 0; n < count; n++) {
    if (u32(zip, p) !== 0x02014b50) break;
    const method = u16(zip, p + 10);
    const compressed = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const localAt = u32(zip, p + 42);
    const name = new TextDecoder("utf-8").decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (name === want) {
      if (u32(zip, localAt) !== 0x04034b50) throw new Error("the archive's index does not match its contents");
      // A local header's own sizes can be zero when a data descriptor follows, so the central
      // directory's compressed size is the one to trust; only the two name/extra lengths are read
      // from the local header, and those are always right.
      const start = localAt + 30 + u16(zip, localAt + 26) + u16(zip, localAt + 28);
      const raw = zip.subarray(start, start + compressed);
      if (method === 0) return raw;
      if (method === 8) return await through(raw, "deflate-raw");
      throw new Error(`this archive uses compression method ${method}, which Docket cannot read`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function through(data: Uint8Array, format: "deflate-raw" | "deflate"): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- PDF

/**
 * The text layer of a PDF, best effort.
 *
 * Every stream in the file is taken, inflated if it is FlateDecode, and kept only if it reads like
 * a content stream — one carrying BT with a text-showing operator in it. That skips fonts, images
 * and metadata without having to parse the cross-reference table, which is the part of the format
 * that varies most between producers and is the usual reason a hand-written parser breaks.
 *
 * Bytes become characters one for one (never through a text decoder, which would mangle the binary
 * between the streams), and a string's bytes are read back as WinAnsi, which is what a
 * single-byte-encoded PDF almost always uses. A two-byte font we cannot decode produces something
 * that is not prose, and looksLikeProse() throws it away rather than indexing it.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const s = latin1(bytes);
  if (!s.startsWith("%PDF-")) throw new Error("this file does not begin %PDF- and is not a PDF");
  const out: string[] = [];

  let i = 0;
  for (;;) {
    const at = s.indexOf("stream", i);
    if (at < 0) break;
    // The dictionary is what stands between this object's start and the stream keyword.
    const objAt = s.lastIndexOf("obj", at);
    const dict = objAt >= 0 && at - objAt < 4096 ? s.slice(objAt, at) : "";
    let start = at + "stream".length;
    if (s[start] === "\r") start++;
    if (s[start] === "\n") start++;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    i = end + "endstream".length;

    // A font program or an image is never worth inflating.
    if (/\/Subtype\s*\/Image|\/FontFile\d?\b/.test(dict)) continue;

    let body: string;
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        // PDF's Flate is zlib-wrapped, not raw.
        body = latin1(await through(bytes.subarray(start, end), "deflate"));
      } catch { continue; }
    } else if (/\/Filter\b/.test(dict)) {
      continue; // LZW, DCT, CCITT, JBIG2 — an image, or a codec Docket does not carry.
    } else {
      body = s.slice(start, end);
    }

    if (!/\bBT\b/.test(body) || !/\b(Tj|TJ)\b/.test(body)) continue;
    out.push(contentStreamText(body));
  }
  return out.join("\n");
}

/** Bytes to characters, one for one. Not a decoding: 0x93 stays 0x93 until a font says otherwise. */
function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return s;
}

/** Windows-1252's own characters, 0x80–0x9F, which Latin-1 leaves undefined. */
const CP1252_HIGH: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ",
  0x9e: "ž", 0x9f: "Ÿ",
};

function winAnsi(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    out += c >= 0x80 && c <= 0x9f ? (CP1252_HIGH[c] ?? "") : String.fromCharCode(c);
  }
  return out;
}

/**
 * The text-showing operators of one content stream, in the order they appear.
 *
 * Tj and ' and " show a string; TJ shows an array of strings with kerning numbers between them, and
 * a big enough negative number there IS the space between two words — a PDF that looks spaced on
 * the page often has no space character in it at all. Td, TD and T* move to a new line.
 */
export function contentStreamText(body: string): string {
  let out = "";
  const stack: string[] = [];
  let inArray = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;

    if (ch === "(") {
      const { text, next } = readLiteral(body, i + 1);
      stack.push(text);
      i = next;
      continue;
    }
    if (ch === "<" && body[i + 1] !== "<") {
      const close = body.indexOf(">", i + 1);
      if (close < 0) break;
      stack.push(readHex(body.slice(i + 1, close)));
      i = close;
      continue;
    }
    if (ch === "[") { inArray = true; continue; }
    if (ch === "]") { inArray = false; continue; }

    if (inArray && (ch === "-" || (ch >= "0" && ch <= "9"))) {
      let j = i;
      while (j < body.length && /[-0-9.]/.test(body[j]!)) j++;
      // The threshold is the usual one: a kern this wide is a word break, not tightening.
      if (Number(body.slice(i, j)) <= -120) stack.push(" ");
      i = j - 1;
      continue;
    }

    if (/[A-Za-z'"*]/.test(ch)) {
      let j = i;
      while (j < body.length && /[A-Za-z0-9'"*]/.test(body[j]!)) j++;
      const op = body.slice(i, j);
      i = j - 1;
      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        out += stack.join("");
        stack.length = 0;
        if (op === "'" || op === '"') out += "\n";
      } else if (op === "Td" || op === "TD" || op === "T*" || op === "ET") {
        stack.length = 0;
        out += "\n";
      } else if (op === "BT") {
        stack.length = 0;
      }
    }
  }
  return out;
}

function readLiteral(body: string, from: number): { text: string; next: number } {
  let depth = 1;
  let raw = "";
  let i = from;
  for (; i < body.length; i++) {
    const c = body[i]!;
    if (c === "\\") {
      const n = body[i + 1];
      if (n === undefined) break;
      if (n >= "0" && n <= "7") {
        let oct = "";
        let j = i + 1;
        while (j < body.length && oct.length < 3 && body[j]! >= "0" && body[j]! <= "7") { oct += body[j]!; j++; }
        raw += String.fromCharCode(parseInt(oct, 8));
        i = j - 1;
        continue;
      }
      // A backslash before a newline is a line continuation and produces nothing.
      if (n === "\n") { i++; continue; }
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
      raw += simple[n] ?? n;
      i++;
      continue;
    }
    if (c === "(") { depth++; raw += c; continue; }
    if (c === ")") { depth--; if (depth === 0) break; raw += c; continue; }
    raw += c;
  }
  return { text: winAnsi(raw), next: i };
}

function readHex(inner: string): string {
  const hex = inner.replace(/[^0-9a-fA-F]/g, "");
  const even = hex.length % 2 === 0 ? hex : hex + "0";
  let raw = "";
  for (let i = 0; i < even.length; i += 2) raw += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
  return winAnsi(raw);
}
