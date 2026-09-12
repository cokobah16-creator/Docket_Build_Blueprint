"use client";

// The platform publishes a workflow pack version: a JSON definition, checked by the database
// (workflow_pack_definition_check) before anything is written, immutable once published.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishWorkflowPack } from "@/lib/actions/workflow";
import { Alert } from "@/components/ui/alert";
import { MATTER_TYPES, type WorkflowPackRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
const EXAMPLE = `{
  "statuses": [
    { "key": "instructions", "label": "Instructions Received", "colour": "slate", "sort": 10, "next_action": "Open the file" },
    { "key": "completed", "label": "Completed", "colour": "gray", "sort": 90, "is_terminal": true }
  ],
  "task_templates": [
    { "key": "open_file", "title": "Open the file and confirm the fee arrangement", "on_status_key": "instructions", "due_offset_days": 2, "assignee": "lead" }
  ]
}`;

export function PackPublisher({ packs }: { packs: WorkflowPackRow[] }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [definition, setDefinition] = useState(EXAMPLE);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; ok?: string } | null>(null);

  /**
   * Loading an existing pack replaces everything in the form, so it is an act, not a side effect
   * of typing. It used to run on every keystroke: a new key with an existing key as a prefix
   * ("litigation_fast_track") passed through an exact match mid-word and silently threw away the
   * definition the operator had written, with no undo and nowhere the text had been kept.
   */
  function loadLatest(k: string) {
    const latest = packs.filter((p) => p.key === k).sort((a, b) => b.version - a.version)[0];
    if (!latest) { setResult({ error: `No pack is published under the key "${k}".` }); return; }
    setName(latest.name); setTypes(latest.matter_types ?? []); setDefinition(JSON.stringify(latest.definition, null, 2)); setNote("");
    setResult({ ok: `Loaded ${latest.key} version ${latest.version}. Publishing writes version ${latest.version + 1}.` });
  }
  const loadable = packs.some((p) => p.key === key);

  async function publish() {
    setBusy(true); setResult(null);
    try {
      const r = await publishWorkflowPack({ key, name, matterTypes: types, definition, note });
      if ("error" in r) setResult({ error: r.error }); else { setResult({ ok: `Published ${key} version ${r.version}. Firms upgrade from their Workflow screen; nothing of theirs changed.` }); router.refresh(); }
    } catch { setResult({ error: "Nothing was published — the connection may have dropped." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {result?.error && <Alert kind="error">{result.error}</Alert>}
      {result?.ok && <Alert kind="success">{result.ok}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-900">Pack key
          <input type="text" list="pack-keys" value={key} onChange={(e) => setKey(e.target.value.trim())} pattern="[a-z0-9_]{2,40}" placeholder="conveyancing" className={field} />
          <datalist id="pack-keys">{Array.from(new Set(packs.map((p) => p.key))).map((k) => <option key={k} value={k} />)}</datalist>
          <span className="mt-1 block text-xs text-gray-500">An existing key publishes the next version of that pack; a new key starts one.</span>
          {loadable && (
            <button type="button" onClick={() => loadLatest(key)}
                    className="mt-1 min-h-[36px] rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:border-brand">
              Load the latest version of {key} into this form
            </button>
          )}
        </label>
        <label className="text-sm text-gray-900">Name<input type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
      </div>
      <fieldset>
        <legend className="text-sm text-gray-900">Matter types (none selected: every type)</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {MATTER_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs">
              <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} /> {t.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm text-gray-900">Definition (JSON)
        <textarea value={definition} onChange={(e) => setDefinition(e.target.value)} rows={18} className={`${field} font-mono text-xs`} />
      </label>
      <label className="block text-sm text-gray-900">Note<input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version" className={field} /></label>
      <button type="button" disabled={busy || !key || !name} onClick={() => void publish()} className="min-h-[44px] rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "Publishing…" : "Publish this version"}</button>
    </div>
  );
}
