"use client";

// Bringing a spreadsheet of existing matters onto Docket: upload, say what each column means,
// look at what will happen row by row, then let the database file them a batch at a time.
//
// Rules enforced here:
//  · The file never leaves the browser whole. It is parsed here (src/lib/csv.ts), only the
//    mapped columns' text is staged, in chunks, as import_rows; process_import_batch() files
//    each row on its own under admin_w(), so a bad row fails alone with the database's reason.
//  · Nothing is guessed to make a row fit. The checks below WARN — an unknown status, a lawyer
//    who is not a member, an unreadable date — and the database refuses the same things with its
//    own words; a warned row can be ticked out here, or left in to be refused and recorded.
//  · A row that already looks like a matter on the books (same old file number, suit number or
//    cause title) is ticked out by default. The person decides; the import never merges.
//  · A client is never linked by a number or address in the file: every client row becomes an
//    invitation the firm sends itself, offered on the result page until the client accepts.

import { useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseCsv, type CsvTable } from "@/lib/csv";
import { createImportBatch, discardImportBatch, previewImportDuplicates, processImportBatch, stageImportRows, IMPORT_FIELDS, type DuplicateHit, type ImportField } from "@/lib/actions/onboarding";
import { MATTER_TYPES } from "@/lib/db/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const FIELD_LABELS: Record<ImportField, { label: string; hint: string; required?: boolean }> = {
  title: { label: "Working title", hint: "What the firm calls the file. Required.", required: true },
  cause_title: { label: "Cause title", hint: "Okonkwo v Eze & 2 Ors" },
  type: { label: "Type of matter", hint: `One of: ${MATTER_TYPES.join(", ")}. Blank means other.` },
  status: { label: "Status", hint: "One of the firm's status keys or labels. Blank means new inquiry." },
  court: { label: "Court", hint: "Matched to the directory by exact name; otherwise kept as text." },
  suit_number: { label: "Suit number", hint: "As the registry assigned it." },
  judicial_division: { label: "Judicial division", hint: "" },
  handling_lawyer: { label: "Lawyer with conduct", hint: "Their email or exact name on Docket. Blank means you." },
  originating_lawyer: { label: "Originating lawyer", hint: "Their email or exact name." },
  opened_on: { label: "Opened on", hint: "YYYY-MM-DD or DD/MM/YYYY. Blank means today." },
  closed_on: { label: "Closed on", hint: "Same form; only for closed files." },
  legacy_reference: { label: "Your file number", hint: "Kept beside the Docket reference; stops the same file coming in twice." },
  client_name: { label: "Client's name", hint: "Shown to you; a person joins only by phone or email." },
  client_phone: { label: "Client's phone", hint: "0803… or +234…; becomes their invitation. Never a colleague's number." },
  client_email: { label: "Client's email", hint: "" },
  opposing_party: { label: "The other side", hint: "Names separated by semicolons; onto the conflict register." },
  description: { label: "What it is about", hint: "" },
  next_action: { label: "Next action", hint: "" },
};

/**
 * Header words a spreadsheet tends to use, to the column they mean. Matched after lower-casing,
 * in this order, each header taken once: the other side's columns are claimed first so that
 * "Opposing Parties" is never the cause title, and "Opposing Counsel" — the other side's lawyer,
 * which no column here means — is claimed by nobody. Word-anchored where a looser match would
 * take the wrong column ("Case Notes" is not a case number).
 */
const SYNONYMS: Array<[RegExp, ImportField]> = [
  [/^(?!.*(counsel|lawyer|solicitor))(?=.*(oppos|defendant|respondent|other side|adverse|against))/, "opposing_party"],
  [/^(working )?title$|^matter( name)?$|^file( name)?$/, "title"],
  [/cause|\bparties\b|caption|versus/, "cause_title"],
  [/^type|matter type|category/, "type"],
  [/status|stage/, "status"],
  [/^court/, "court"],
  [/suit|\bcase (no|number|#)\b/, "suit_number"],
  [/division|district/, "judicial_division"],
  [/originat/, "originating_lawyer"],
  [/^(?!.*oppos)(?=.*(handling|conduct|lawyer|counsel|fee earner|assigned))/, "handling_lawyer"],
  [/opened|date opened|start|commenced|instructed/, "opened_on"],
  [/closed|concluded|date closed|ended/, "closed_on"],
  [/\bfile (no|number|#)\b|\bref(erence)?( no)?$|our ref/, "legacy_reference"],
  [/client.*(phone|tel|mobile|gsm)|^(phone|tel|mobile|gsm)/, "client_phone"],
  [/client.*(e-?mail)|^e-?mail/, "client_email"],
  [/client/, "client_name"],
  [/desc|\bnotes?\b|summary|brief|about/, "description"],
  [/next action|to do|action/, "next_action"],
];

/** Columns are addressed by index, never by name: two columns with the same header stay two columns. */
function autoMap(headers: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  const taken = new Set<number>();
  for (const [re, f] of SYNONYMS) {
    if (out[f] !== undefined) continue;
    const i = headers.findIndex((x, ix) => x && !taken.has(ix) && re.test(x.toLowerCase()));
    if (i >= 0) { out[f] = i; taken.add(i); }
  }
  return out;
}

// The same shapes import_day() and import_phone_key() accept (migration 34), so a warning here is
// a refusal there and nothing warned here is filed quietly.
const DAY = /^(\d{4}-\d{2}-\d{2}([ T].*)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})$/;
const PHONE = /^(\+2340\d{10}|2340\d{10}|\+[1-9]\d{7,14}|\+0\d{10}|0\d{10}|234\d{10}|[1-9]\d{9})$/;
const CELL_MAX = 8000;

export interface StaffOption { user_id: string; label: string; email: string | null; full_name: string | null }

export function ImportWizard({
  firmId, staff, statuses, referencePrefix, referenceIssued, conflictChecksRequired,
}: {
  firmId: string;
  staff: StaffOption[];
  statuses: Array<{ key: string; label: string }>;
  referencePrefix: string;
  referenceIssued: boolean;
  conflictChecksRequired: boolean;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  // A batch begun and not yet fully staged: retried into, never recreated, until it is filed or discarded.
  const [batch, setBatch] = useState<{ id: string; staged: number } | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [skips, setSkips] = useState<Set<number>>(new Set());
  const [dupes, setDupes] = useState<Map<number, DuplicateHit>>(new Map());
  const [checking, setChecking] = useState(false);
  const [phase, setPhase] = useState<"upload" | "map" | "preview" | "running">("upload");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ staged: number; processed: number; total: number } | null>(null);

  const statusKeys = useMemo(() => new Set(statuses.flatMap((s) => [s.key.toLowerCase(), s.label.toLowerCase()])), [statuses]);
  const staffKeys = useMemo(() => new Set(staff.flatMap((m) => [m.email?.toLowerCase() ?? "", m.full_name?.toLowerCase() ?? ""]).filter(Boolean)), [staff]);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    if (f.size > 4 * 1024 * 1024) { setError("Files up to 4 MB. Split a larger spreadsheet."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const t = parseCsv(String(reader.result ?? ""));
      if (t.headers.length === 0 || t.rows.length === 0) { setError("The file has no rows to import."); return; }
      setFileName(f.name);
      setTable(t);
      setMapping(autoMap(t.headers));
      setSkips(new Set());
      setDupes(new Map());
      setBatch(null);
      setProgress(null);
      setPhase("map");
    };
    reader.onerror = () => setError("The file could not be read.");
    reader.readAsText(f);
  }

  /** The row as the database will see it: mapped columns only, text as typed. */
  const mapped = useMemo(() => {
    if (!table) return [] as Array<{ row_no: number; raw: Record<string, string> }>;
    return table.rows.map((cells, i) => {
      const raw: Record<string, string> = {};
      for (const f of IMPORT_FIELDS) {
        const col = mapping[f];
        if (col === undefined) continue;
        const v = cells[col] ?? "";
        if (v.trim()) raw[f] = v.trim();
      }
      return { row_no: i + 1, raw };
    });
  }, [table, mapping]);

  function issuesFor(raw: Record<string, string>): string[] {
    const out: string[] = [];
    if (!raw.title || raw.title.length < 2) out.push("no title — the row will be refused");
    if (raw.type && !MATTER_TYPES.includes(raw.type.toLowerCase() as (typeof MATTER_TYPES)[number])) out.push(`type "${raw.type}" is not one Docket knows`);
    if (raw.status && !statusKeys.has(raw.status.toLowerCase())) out.push(`status "${raw.status}" is not one of the firm's`);
    if (raw.handling_lawyer && !staffKeys.has(raw.handling_lawyer.toLowerCase())) out.push(`"${raw.handling_lawyer}" is not a member of the firm`);
    if (raw.originating_lawyer && !staffKeys.has(raw.originating_lawyer.toLowerCase())) out.push(`"${raw.originating_lawyer}" is not a member of the firm`);
    if (raw.opened_on && !DAY.test(raw.opened_on)) out.push(`"${raw.opened_on}" is not a readable day`);
    if (raw.closed_on && !DAY.test(raw.closed_on)) out.push(`"${raw.closed_on}" is not a readable day`);
    if (raw.client_phone && !PHONE.test(raw.client_phone.replace(/[^0-9+]/g, ""))) out.push(`the phone "${raw.client_phone}" is not readable — use 0803 000 0000 or +234…; the client will not be invited`);
    for (const [k, v] of Object.entries(raw)) if (v.length > CELL_MAX) { out.push(`${FIELD_LABELS[k as ImportField]?.label ?? k} is longer than 8,000 characters — the row will be refused`); break; }
    if (raw.client_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw.client_email)) out.push("the email address does not look like one");
    if (raw.client_name && !raw.client_phone && !raw.client_email) out.push("a client is named but has no phone or email — they cannot be invited from here");
    return out;
  }

  async function toPreview() {
    setError(null);
    if (mapping.title === undefined) { setError("Say which column is the working title — a matter needs one."); return; }
    setChecking(true);
    try {
      const r = await previewImportDuplicates(firmId, mapped.map((m) => ({ row_no: m.row_no, legacy_reference: m.raw.legacy_reference, suit_number: m.raw.suit_number, cause_title: m.raw.cause_title })));
      if ("error" in r) { setError(r.error); return; }
      const d = new Map(r.hits.map((h) => [h.row_no, h]));
      setDupes(d);
      setSkips(new Set(r.hits.map((h) => h.row_no)));
      setPhase("preview");
    } catch {
      setError("The check against the books did not come back — the connection may have dropped. Try again.");
    } finally {
      setChecking(false);
    }
  }

  /**
   * Stage, then file. A batch is created once; if staging stops, the same batch is resumed from
   * the first chunk that did not land (a chunk is one insert — all of it or none), because
   * process_import_batch() files nothing until every row is in. If filing stops, the result
   * page continues it.
   */
  async function run() {
    if (!table) return;
    setError(null);
    const total = mapped.length;
    const overlong = mapped.find((m) => !skips.has(m.row_no) && Object.values(m.raw).some((v) => v.length > CELL_MAX));
    if (overlong) { setError(`Row ${overlong.row_no} has a cell longer than 8,000 characters — shorten it in the file, or tick the row out.`); return; }
    setPhase("running");
    let b = batch;
    try {
      if (!b) {
        const created = await createImportBatch(firmId, fileName, total);
        if ("error" in created) { setError(created.error); setPhase("preview"); return; }
        b = { id: created.batchId, staged: 0 };
        setBatch(b);
      }
      setProgress({ staged: b.staged, processed: 0, total });
      for (let i = b.staged; i < mapped.length; i += 200) {
        const chunk = mapped.slice(i, i + 200).map((m) => ({ ...m, skip: skips.has(m.row_no) }));
        const staged = await stageImportRows(b.id, firmId, chunk);
        if (staged?.error) {
          setError(`Staging stopped at row ${i + 1} of ${total}: ${staged.error} Nothing is filed until every row is in — retry to continue from there, or discard this batch.`);
          setPhase("preview"); return;
        }
        b = { ...b, staged: Math.min(total, i + 200) };
        setBatch(b);
        setProgress({ staged: b.staged, processed: 0, total });
      }
    } catch {
      setError(`The connection dropped while staging${b ? ` — ${b.staged} of ${total} rows are in` : ""}. Nothing is filed until every row is in — retry to continue from there, or discard this batch.`);
      setPhase("preview"); return;
    }
    try {
      let done = 0;
      for (let guard = 0; guard < 1000; guard += 1) {
        const r = await processImportBatch(b.id, 50);
        if ("error" in r) { setError(r.error); break; }
        done += r.processed;
        setProgress({ staged: total, processed: done, total });
        if (r.remaining === 0 || r.processed === 0) break;
      }
    } catch {
      // Every row is in; the result page shows what was filed and continues the rest.
    }
    router.push(`/firm/admin/import/${b.id}`);
    router.refresh();
  }

  async function discard() {
    if (!batch) return;
    setDiscarding(true); setError(null);
    try {
      const r = await discardImportBatch(batch.id);
      if (r?.error) { setError(r.error); return; }
      setBatch(null); setProgress(null);
    } catch {
      setError("The batch could not be discarded — the connection may have dropped. Try again, or discard it from the imports list.");
    } finally {
      setDiscarding(false);
    }
  }

  // ------------------------------------------------------------- render
  if (phase === "upload") {
    return (
      <Card>
        <CardHeader title="Bring your existing matters in" />
        <CardBody className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {!referenceIssued && (
            <Alert kind="warning" title={`Your reference prefix is ${referencePrefix}, and it locks at the first matter`}>
              Every imported matter is numbered {referencePrefix}-M-{new Date().getUTCFullYear()}-000001 onwards. If that prefix is not the one you want,{" "}
              <Link href="/firm/admin/settings" className="underline">change it first</Link>.
            </Alert>
          )}
          {conflictChecksRequired && (
            <Alert kind="warning" title="Conflict checks are required before a client joins a matter">
              Each matter will come in; its client will not be linked until a check on that matter is cleared. The result page says so per row.
            </Alert>
          )}
          <p className="text-sm text-gray-600">
            A CSV export from your spreadsheet, one matter per row, with a header row. You say what each column means next.
            Dates are calendar days (YYYY-MM-DD or DD/MM/YYYY). Every client is invited by phone or email — even one already on Docket — and never linked by a number in a file.{" "}
            <Link href="/firm/admin/import/template" className="text-brand underline">See the columns and download a template</Link>.
          </p>
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90">
            Choose a CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
          </label>
        </CardBody>
      </Card>
    );
  }

  if (phase === "map" && table) {
    return (
      <Card>
        <CardHeader title={`What each column means — ${fileName}`} />
        <CardBody className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {table.warnings.map((w) => <Alert key={w} kind="warning">{w}</Alert>)}
          <p className="text-sm text-gray-600">{table.rows.length} rows, {table.headers.length} columns. Columns left as “not imported” are ignored.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <div key={f}>
                <label htmlFor={`map-${f}`} className="text-sm font-medium text-gray-900">
                  {FIELD_LABELS[f].label}{FIELD_LABELS[f].required && <span className="text-red-700"> *</span>}
                </label>
                {FIELD_LABELS[f].hint && <p className="text-xs text-gray-500">{FIELD_LABELS[f].hint}</p>}
                <select id={`map-${f}`} value={mapping[f] === undefined ? "" : String(mapping[f])} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))} className={field}>
                  <option value="">Not imported</option>
                  {table.headers.map((h, i) => h && <option key={`${h}-${i}`} value={String(i)}>{h}{table.headers.filter((x) => x === h).length > 1 ? ` (column ${i + 1})` : ""}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void toPreview()} disabled={checking}>{checking ? "Checking against the books…" : "Check the rows"}</Button>
            <Button type="button" variant="ghost" onClick={() => { setTable(null); setPhase("upload"); }}>Choose another file</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (phase === "preview" || phase === "running") {
    const rows = mapped.map((m) => ({ ...m, issues: issuesFor(m.raw), dupe: dupes.get(m.row_no) ?? null }));
    const inCount = rows.filter((r) => !skips.has(r.row_no)).length;
    const warned = rows.filter((r) => r.issues.length > 0 && !skips.has(r.row_no)).length;
    return (
      <Card>
        <CardHeader title={`What will happen — ${fileName}`} />
        <CardBody className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <p className="text-sm text-gray-700">
            <strong>{inCount}</strong> of {rows.length} rows will be filed{dupes.size > 0 ? `; ${dupes.size} ticked out because they already look like a matter on the books` : ""}
            {warned > 0 ? `; ${warned} carry a warning — the database checks the same things and refuses such a row with its reason recorded, unless you tick it out` : ""}.
            Each row is filed on its own: one bad row never stops the rest.
          </p>
          {batch && phase !== "running" && (
            <Alert kind="warning" title={`${batch.staged} of ${rows.length} rows are staged in a batch that is not finished`}>
              Nothing has been filed from it. Retry continues from row {batch.staged + 1} into the same batch; discard it to start again. The columns cannot be changed while it stands.
              <div className="mt-2"><Button type="button" size="sm" variant="ghost" disabled={discarding} onClick={() => void discard()}>{discarding ? "Discarding…" : "Discard this batch"}</Button></div>
            </Alert>
          )}
          {phase === "running" && progress && (
            <Alert kind="info" title="Filing…">
              Staged {progress.staged} of {progress.total}; filed {progress.processed} of {progress.total}. Stay on this page.
            </Alert>
          )}
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="px-2 py-2">In</th><th className="px-2 py-2">#</th><th className="px-2 py-2">Title</th><th className="px-2 py-2">Client</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Opened</th><th className="px-2 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row_no} className={skips.has(r.row_no) ? "text-gray-400" : r.issues.length ? "bg-amber-50" : ""}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" aria-label={`Include row ${r.row_no}`} checked={!skips.has(r.row_no)} disabled={phase === "running"}
                        onChange={(e) => setSkips((s) => { const n = new Set(s); if (e.target.checked) n.delete(r.row_no); else n.add(r.row_no); return n; })} className="h-5 w-5" />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{r.row_no}</td>
                    <td className="px-2 py-1.5">{r.raw.title ?? <em className="text-red-700">no title</em>}{r.raw.legacy_reference ? <span className="ml-1 text-xs text-gray-500">({r.raw.legacy_reference})</span> : null}</td>
                    <td className="px-2 py-1.5 text-xs">{[r.raw.client_name, r.raw.client_phone, r.raw.client_email].filter(Boolean).join(" · ")}</td>
                    <td className="px-2 py-1.5 text-xs">{r.raw.status ?? "new inquiry"}</td>
                    <td className="px-2 py-1.5 text-xs">{r.raw.opened_on ?? "today"}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.dupe && <span className="block text-amber-900">{r.dupe.reason} ({r.dupe.reference})</span>}
                      {r.issues.map((i) => <span key={i} className="block text-amber-900">{i}</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="lg" onClick={() => void run()} disabled={phase === "running" || discarding || inCount === 0}>{phase === "running" ? "Filing…" : batch ? "Retry from where it stopped" : `File ${inCount} ${inCount === 1 ? "matter" : "matters"}`}</Button>
            <Button type="button" variant="ghost" disabled={phase === "running" || batch !== null} onClick={() => setPhase("map")}>Back to the columns</Button>
          </div>
        </CardBody>
      </Card>
    );
  }
  return null;
}
