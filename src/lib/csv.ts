// A CSV reader for the import screen: RFC 4180 — quoted fields, doubled quotes inside them,
// commas and line breaks inside quotes, CRLF or LF, an optional byte-order mark, a header row.
//
// Written here rather than taken from a package because the dependency set is pinned by a
// lockfile generated where the registry is reachable, and this file is shorter than the
// review of a new dependency would be. It parses; it never interprets. What a column MEANS is
// decided by the mapping step, and every value is handed on as the text it was.

export interface CsvTable {
  /** Header cells, trimmed, as typed. Empty headers are kept as "" so column indexes hold. */
  headers: string[];
  /** Data rows, each padded or truncated to the header length. Blank lines are dropped. */
  rows: string[][];
  /** Problems worth telling the person: a row with more cells than headers, an unclosed quote. */
  warnings: string[];
}

/** Parses the whole text. A field is text; nothing is coerced. */
export function parseCsv(text: string, opts: { delimiter?: string; maxRows?: number } = {}): CsvTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const maxRows = opts.maxRows ?? 5000;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  const warnings: string[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  const endField = () => { record.push(field); field = ""; };
  const endRecord = () => {
    endField();
    // A blank line is not a row — nor is a line of nothing but separators, which is how a
    // spreadsheet exports the formatted-but-empty rows under its data.
    if (record.every((c) => c.trim() === "")) { record = []; return; }
    records.push(record);
    record = [];
  };

  while (i < n) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') {
      // A quote opens a quoted field only at the start of the field; elsewhere it is a character.
      if (field.length === 0) { inQuotes = true; i += 1; continue; }
      field += c; i += 1; continue;
    }
    if (c === delimiter) { endField(); i += 1; continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i += 1; endRecord(); i += 1; continue; }
    if (c === "\n") { endRecord(); i += 1; continue; }
    field += c; i += 1;
  }
  if (inQuotes) warnings.push("The file ends inside a quoted value — the last row may be incomplete.");
  if (field.length > 0 || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [], warnings: ["The file is empty."] };
  const headers = records[0].map((h) => h.trim());
  const width = headers.length;
  const rows: string[][] = [];
  let wide = 0;
  for (let r = 1; r < records.length; r += 1) {
    if (rows.length >= maxRows) { warnings.push(`Only the first ${maxRows} rows were read.`); break; }
    const cells = records[r];
    if (cells.length > width) wide += 1;
    const row = cells.slice(0, width);
    while (row.length < width) row.push("");
    rows.push(row.map((v) => v.trim()));
  }
  if (wide > 0) warnings.push(`${wide} ${wide === 1 ? "row has" : "rows have"} more cells than the header — the extra cells were ignored.`);
  return { headers, rows, warnings };
}

/**
 * Comma unless the first line has more semicolons or tabs than commas (a spreadsheet export).
 * Counted outside quotes: a quoted header such as "Title, working" is one cell, not a comma.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 2000).split(/\r?\n/)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch in counts) counts[ch] += 1;
  }
  const commas = counts[","], semis = counts[";"], tabs = counts["\t"];
  if (tabs > commas && tabs > semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** Serialises rows back to CSV, quoting whatever needs it — for the reconciliation download. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
