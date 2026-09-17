"use client";

// Two ways in: a CSV with its columns mapped, or one listing typed. Both end in the same call.
//
// A day is a calendar day and is sent as the YYYY-MM-DD it was typed or mapped to; a time is the
// court's own HH:MM. DD/MM/YYYY — the form a Nigerian cause list is usually printed in — is turned
// into YYYY-MM-DD here by string arithmetic, never through a Date, so nothing can shift a day.

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseCsv, type CsvTable } from "@/lib/csv";
import { stageRegistryNotices, type NoticeRowInput } from "@/lib/actions/registry";
import { PURPOSE_KINDS, type StageNoticesResult } from "@/lib/db/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const field = "mt-1 block w-full min-h-11 rounded-lg border border-edge px-3 text-base text-ink focus:border-[#141414] focus:outline focus:outline-2 focus:outline-[#141414]";

type Field = keyof NoticeRowInput;
const FIELDS: Array<{ key: Field; label: string; hint: string; required?: boolean }> = [
  { key: "suit_number", label: "Suit number", hint: "As the registry writes it. Required.", required: true },
  { key: "listed_on", label: "Day listed", hint: "YYYY-MM-DD or DD/MM/YYYY. Required.", required: true },
  { key: "listed_time", label: "Time", hint: "HH:MM, the court's own clock. Blank is allowed; the firm chooses when it confirms." },
  { key: "cause_title", label: "Cause title", hint: "Adebayo v Union Bank" },
  { key: "purpose_kind", label: "Purpose", hint: `One of: ${PURPOSE_KINDS.join(", ")} — or your own word, kept as written.` },
  { key: "purpose", label: "Purpose, in full", hint: "Hearing of the originating summons" },
  { key: "judge", label: "Judge", hint: "" },
  { key: "courtroom", label: "Courtroom", hint: "" },
];

/** DD/MM/YYYY → YYYY-MM-DD by string arithmetic. Anything else is passed on as typed, for the database to refuse in words. */
function normaliseDay(s: string): string {
  const t = s.trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return t;
}

function guessMapping(headers: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const pick = (key: Field, ...names: string[]) => {
    const i = norm.findIndex((h) => names.includes(h));
    if (i >= 0 && map[key] === undefined) map[key] = i;
  };
  pick("suit_number", "suitnumber", "suitno", "suit", "caseno", "casenumber", "number");
  pick("listed_on", "date", "day", "listedon", "hearingdate", "listed");
  pick("listed_time", "time", "listedtime");
  pick("cause_title", "causetitle", "parties", "title", "case");
  pick("purpose_kind", "purposekind", "kind", "stage");
  pick("purpose", "purpose", "for", "business", "nature");
  pick("judge", "judge", "coram", "before");
  pick("courtroom", "courtroom", "court", "room");
  return map;
}

export function StageForm({ registryId }: { registryId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"csv" | "one">("csv");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [sourceNote, setSourceNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StageNoticesResult | null>(null);
  const [one, setOne] = useState<NoticeRowInput>({ suit_number: "", listed_on: "", listed_time: "", cause_title: "", purpose_kind: "", purpose: "", judge: "", courtroom: "" });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const t = parseCsv(String(reader.result ?? ""), { maxRows: 500 });
      setTable(t); setMapping(guessMapping(t.headers)); setResult(null); setError(null);
      if (!sourceNote) setSourceNote(f.name);
    };
    reader.readAsText(f);
  }

  const rows: NoticeRowInput[] = useMemo(() => {
    if (!table) return [];
    const get = (r: string[], k: Field) => (mapping[k] === undefined ? "" : (r[mapping[k]!] ?? "").trim());
    return table.rows.map((r) => ({
      suit_number: get(r, "suit_number"),
      listed_on: normaliseDay(get(r, "listed_on")),
      listed_time: get(r, "listed_time") || null,
      cause_title: get(r, "cause_title") || null,
      purpose_kind: get(r, "purpose_kind") || null,
      purpose: get(r, "purpose") || null,
      judge: get(r, "judge") || null,
      courtroom: get(r, "courtroom") || null,
    }));
  }, [table, mapping]);

  const mappedRequired = mapping.suit_number !== undefined && mapping.listed_on !== undefined;

  async function stage(toStage: NoticeRowInput[]) {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await stageRegistryNotices(registryId, toStage, sourceNote);
      if ("error" in r) { setError(r.error); return; }
      setResult(r);
      router.refresh();
    } catch { setError("Nothing was staged — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  function submitOne(e: FormEvent) {
    e.preventDefault();
    void stage([{ ...one, listed_on: normaliseDay(one.listed_on), listed_time: one.listed_time || null, cause_title: one.cause_title || null,
                  purpose_kind: one.purpose_kind || null, purpose: one.purpose || null, judge: one.judge || null, courtroom: one.courtroom || null }]);
  }

  return (
    <div className="flex flex-col gap-3.5">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      {result && (
        <Alert kind={result.rejected.length > 0 ? "warning" : "success"} title={`${result.staged} ${result.staged === 1 ? "listing" : "listings"} staged as drafts`}>
          <p className="text-15">
            Nothing is published yet. <Link href="/registry" className="underline">Open the cause list</Link> to look them over; a registrar publishes.
          </p>
          {result.rejected.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-13">
              {result.rejected.map((r) => <li key={r.row}>Row {r.row}{r.suit_number ? ` (${r.suit_number})` : ""}: {r.reason}</li>)}
            </ul>
          )}
        </Alert>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant={mode === "csv" ? "primary" : "ghost"} onClick={() => setMode("csv")}>From a CSV</Button>
        <Button size="sm" variant={mode === "one" ? "primary" : "ghost"} onClick={() => setMode("one")}>One listing</Button>
      </div>

      <Card>
        <CardHeader title="What this is from" />
        <CardBody>
          <label className="block text-15 text-ink">Source
            <input type="text" maxLength={300} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="Cause list of 14 Sep 2026, page 3" className={field} />
            <span className="mt-1 block text-13 text-ink-muted">Kept with every listing, and shown to the firm beside the date it confirms.</span>
          </label>
        </CardBody>
      </Card>

      {mode === "csv" ? (
        <Card>
          <CardHeader title="The file" />
          <CardBody className="space-y-3">
            <label className="block text-15 text-ink">CSV
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="mt-1 block w-full text-15" />
            </label>
            {table && (
              <>
                <p className="text-13 text-ink-muted">{fileName}: {table.rows.length} rows{table.rows.length >= 500 ? " (the first 500 — stage the rest as another file)" : ""}. Say what each column is:</p>
                {table.warnings.length > 0 && <Alert kind="warning">{table.warnings.slice(0, 3).join(" ")}</Alert>}
                <div className="grid gap-2 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="block text-15 text-ink">
                      {f.label}{f.required ? " *" : ""}
                      <select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })} className={field}>
                        <option value="">— not in the file —</option>
                        {table.headers.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
                      </select>
                      {f.hint && <span className="mt-0.5 block text-13 text-ink-muted">{f.hint}</span>}
                    </label>
                  ))}
                </div>
                {rows.length > 0 && (
                  <div className="rounded-card border border-hairline">
                    <Table density="compact">
                      <THead><TR><TH>Suit</TH><TH>Day</TH><TH>Time</TH><TH>Purpose</TH></TR></THead>
                      <TBody>
                        {rows.slice(0, 8).map((r, i) => (
                          <TR key={i}><TD className="font-mono">{r.suit_number || "—"}</TD><TD>{r.listed_on || "—"}</TD><TD>{r.listed_time ?? ""}</TD><TD>{r.purpose ?? r.purpose_kind ?? ""}</TD></TR>
                        ))}
                      </TBody>
                    </Table>
                    {rows.length > 8 && <p className="px-3 py-2 text-13 text-ink-muted">…and {rows.length - 8} more</p>}
                  </div>
                )}
                <Button pending={busy} disabled={!mappedRequired || rows.length === 0} onClick={() => void stage(rows)}>
                  {`Stage ${rows.length} as drafts`}
                </Button>
                {!mappedRequired && <p className="text-13 text-ink-muted">Map the suit number and the day first.</p>}
              </>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="One listing" />
          <CardBody>
            <form onSubmit={submitOne} className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-15 text-ink">
                  {f.label}{f.required ? " *" : ""}
                  <input type={f.key === "listed_on" ? "date" : f.key === "listed_time" ? "time" : "text"} required={f.required}
                         value={(one[f.key] ?? "") as string} onChange={(e) => setOne({ ...one, [f.key]: e.target.value })} className={field} />
                  {f.hint && <span className="mt-0.5 block text-13 text-ink-muted">{f.hint}</span>}
                </label>
              ))}
              <div className="sm:col-span-2">
                <Button type="submit" pending={busy}>Stage as a draft</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
