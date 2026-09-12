"use client";

// The firm's templates: the words, the placeholders they name, and whether the instrument is
// signed here or executed on paper.
//
// Rules enforced here: the document_templates policies ask admin_w(); the database checks every
// placeholder against the list it can fill (document_template_placeholders()) plus {extra.name}
// for a value typed at generation, and refuses a template that names anything else — so the
// reference below is the same list, not a promise. A change to the words or the execution mode
// bumps the version; a document generated earlier keeps the version it was made from.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { retireDocumentTemplate, saveDocumentTemplate } from "@/lib/actions/templates";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MATTER_TYPES, TEMPLATE_PLACEHOLDERS, type DocumentTemplateRow, type TemplateExecution } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const EXECUTION: Array<{ value: TemplateExecution; label: string; help: string }> = [
  { value: "electronic", label: "Signed in Docket", help: "The client reads it here and signs by typing their name; the signed version is locked." },
  { value: "paper", label: "Executed on paper", help: "A deed or an instrument that needs a witness, attestation or stamping: printed, signed before a witness, and the executed copy recorded here." },
  { value: "either", label: "Either", help: "The lawyer decides on each document." },
];

const EMPTY = { name: "", matterTypes: [] as string[], body: "", execution: "either" as TemplateExecution, note: "" };

/** The {placeholders} a body names, in the order they first appear. */
function keysIn(body: string) {
  const out: string[] = [];
  for (const m of body.matchAll(/\{([a-z0-9_.]+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function TemplatesEditor({ firmId, templates, canWrite, timezone }: { firmId: string; templates: DocumentTemplateRow[]; canWrite: boolean; timezone: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone });

  function start(t: DocumentTemplateRow | null) {
    setError(null); setNotice(null);
    setEditing(t ? t.id : "new");
    setDraft(t ? { name: t.name, matterTypes: t.matter_types ?? [], body: t.body, execution: t.execution, note: t.note ?? "" } : EMPTY);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await saveDocumentTemplate({ id: editing === "new" ? null : editing, firmId, ...draft });
      if (r?.error) { setError(r.error); return; }
      setNotice(editing === "new" ? "Template added." : "Template saved.");
      setEditing(null);
      router.refresh();
    } catch { setError("Nothing was saved — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  async function retire(t: DocumentTemplateRow) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await retireDocumentTemplate(t.id, !t.retired_at);
      if (r?.error) { setError(r.error); return; }
      setNotice(t.retired_at ? `${t.name} is back in use.` : `${t.name} is retired: nothing new is generated from it, and documents already made from it are unchanged.`);
      router.refresh();
    } catch { setError("Nothing was changed — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  const unknown = keysIn(draft.body).filter((k) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(k) && !/^extra\.[a-z0-9_]{1,40}$/.test(k));
  const typed = keysIn(draft.body).filter((k) => k.startsWith("extra."));

  return (
    <div className="space-y-6">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <CardHeader title="Templates" action={canWrite && editing === null ? <Button size="sm" onClick={() => start(null)}>New template</Button> : undefined} />
        <CardBody>
          <p className="mb-3 text-xs text-gray-500">A document is generated from one of these on a matter&apos;s Documents tab.</p>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-600">No templates yet. An engagement letter is the usual first one.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {t.name} <span className="text-xs font-normal text-gray-500">· version {t.version}</span>
                      {t.retired_at && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">retired</span>}
                    </p>
                    <p className="text-xs text-gray-600">
                      {EXECUTION.find((x) => x.value === t.execution)?.label ?? t.execution}
                      {" · "}{t.matter_types?.length ? t.matter_types.map((m) => m.replace(/_/g, " ")).join(", ") : "any matter type"}
                      {" · "}{keysIn(t.body).length} placeholder{keysIn(t.body).length === 1 ? "" : "s"}
                      {" · changed "}{fmt.format(new Date(t.updated_at))}
                    </p>
                    {t.note && <p className="mt-0.5 text-xs text-gray-500">{t.note}</p>}
                  </div>
                  {canWrite && (
                    <span className="flex gap-2">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(t)}>Edit</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => retire(t)}>{t.retired_at ? "Put back in use" : "Retire"}</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {editing !== null && (
        <Card>
          <CardHeader title={editing === "new" ? "New template" : "Edit template"} />
          <CardBody>
            <p className="mb-3 text-xs text-gray-500">Placeholders in braces are filled from the matter when a document is generated. A matter with no value for one stops the generation — nothing is guessed.</p>
            <form onSubmit={save} className="space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-gray-800">Name</span>
                <input className={field} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required minLength={2} maxLength={120} placeholder="Engagement letter" />
              </label>
              <fieldset>
                <legend className="text-sm font-medium text-gray-800">Matter types</legend>
                <p className="text-xs text-gray-500">Leave every box clear for a template that fits any matter.</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {MATTER_TYPES.map((m) => {
                    const on = draft.matterTypes.includes(m);
                    return (
                      <label key={m} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs ${on ? "border-brand bg-black/5 text-brand" : "border-gray-300 text-gray-700"}`}>
                        <input type="checkbox" checked={on} onChange={() => setDraft({ ...draft, matterTypes: on ? draft.matterTypes.filter((x) => x !== m) : [...draft.matterTypes, m] })} />
                        {m.replace(/_/g, " ")}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-medium text-gray-800">How it is executed</legend>
                <div className="mt-1 space-y-1.5">
                  {EXECUTION.map((x) => (
                    <label key={x.value} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="execution" className="mt-1" checked={draft.execution === x.value} onChange={() => setDraft({ ...draft, execution: x.value })} />
                      <span><span className="font-medium text-gray-800">{x.label}</span> <span className="text-xs text-gray-600">— {x.help}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm">
                <span className="font-medium text-gray-800">The words</span>
                <textarea className={`${field} min-h-[260px] font-mono text-xs`} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required maxLength={60000} placeholder={"Dear {client.name},\n\nWe refer to {matter.title} ({matter.reference}) …\n\nOur fee is {extra.fee}.\n\n{lawyer.name}\n{firm.name}"} />
              </label>
              {unknown.length > 0 && <Alert kind="warning">Not on the list, so the database will refuse this template: {unknown.map((k) => `{${k}}`).join(", ")}. Use a placeholder below, or {"{extra.name}"} for a value typed at generation.</Alert>}
              {typed.length > 0 && <p className="text-xs text-gray-600">Typed at generation, each time: {typed.map((k) => `{${k}}`).join(", ")}.</p>}
              <label className="block text-sm">
                <span className="font-medium text-gray-800">Note for colleagues</span>
                <input className={field} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={1000} placeholder="When to use it, what to check first" />
              </label>
              <details className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                <summary className="cursor-pointer font-medium">Placeholders the matter can fill</summary>
                <p className="mt-2">Each is taken from the matter, its client, the handling lawyer or the firm at the moment of generation, and the source is recorded with the document.</p>
                <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
                  {TEMPLATE_PLACEHOLDERS.map((k) => <li key={k} className="font-mono">{`{${k}}`}</li>)}
                  <li className="font-mono">{"{extra.<name>}"} <span className="font-sans text-gray-500">— typed each time</span></li>
                </ul>
              </details>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || unknown.length > 0}>{busy ? "Saving…" : "Save"}</Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
