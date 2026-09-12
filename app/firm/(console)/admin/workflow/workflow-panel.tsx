"use client";

// The firm's practice workflow: which packs are installed at which version, what the catalogue
// offers, and the firm's own wording on each stage.
//
// Rules enforced here: install_workflow_pack() asks admin_w() itself and only ever adds; a stage
// the firm already has keeps its wording, colour, order and reach. The label editor is a plain
// update under the matter_statuses write policy (owners and admins with a second factor). A stage's
// key is never edited: matters and packs point at it. Nothing is firm-specific in this file.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { installWorkflowPack, updateMatterStatusRow } from "@/lib/actions/workflow";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { FirmWorkflowPackRow, MatterStatus, WorkflowPackRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export function WorkflowPanel({ firmId, packs, installed, statuses, canWrite }: {
  firmId: string;
  packs: WorkflowPackRow[];
  installed: FirmWorkflowPackRow[];
  statuses: MatterStatus[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", colour: "", sort: 0, defaultNextAction: "" });

  const installedBy = new Map(installed.map((i) => [i.pack_key, i.installed_version]));
  const byKey = new Map<string, WorkflowPackRow[]>();
  for (const p of packs) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p].sort((a, b) => b.version - a.version));

  async function install(key: string, version: number) {
    setBusy(`${key}:${version}`); setError(null); setNotice(null);
    try {
      const r = await installWorkflowPack(firmId, key, version);
      if ("error" in r) { setError(r.error); return; }
      setNotice(`${key} version ${r.version}: ${r.added} stage${r.added === 1 ? "" : "s"} added, ${r.recognised} already yours and left as they read`
        + (r.ofAnotherPack > 0 ? `, and ${r.ofAnotherPack} you already have from another pack, left exactly as they are.` : "."));
      router.refresh();
    } catch { setError("Nothing was installed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  function startEdit(s: MatterStatus) {
    setEditing(s.id);
    setDraft({ label: s.label, colour: s.colour ?? "", sort: s.sort ?? 0, defaultNextAction: s.default_next_action ?? "" });
    setError(null); setNotice(null);
  }

  async function saveEdit(id: string) {
    setBusy(id); setError(null);
    try {
      const r = await updateMatterStatusRow({ statusId: id, ...draft });
      if (r?.error) { setError(r.error); return; }
      setEditing(null); router.refresh();
    } catch { setError("Nothing was saved — try again."); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <CardHeader title="Packs" />
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-600">
            A pack is a set of stages and the work each stage starts, published by Docket as a numbered version.
            Installing one adds the stages you lack and recognises the ones you have — your wording, colours and
            order are never rewritten, and no matter is moved. Installing a newer version adds only.
          </p>
          {byKey.size === 0 ? (
            <p className="text-sm text-gray-600">Docket has published no pack yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {Array.from(byKey.entries()).map(([key, versions]) => {
                const latest = versions[0];
                const have = installedBy.get(key) ?? null;
                const def = latest.definition;
                const templates = def.task_templates ?? [];
                return (
                  <li key={key} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {latest.name} <span className="font-normal text-gray-600">· version {latest.version}</span>
                        {have ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">installed{have < latest.version ? ` (v${have})` : ""}</span> : null}
                      </p>
                      <p className="text-xs text-gray-600">
                        {latest.matter_types?.length ? `for ${latest.matter_types.map((t) => t.replace(/_/g, " ")).join(", ")} matters` : "for every matter type"} ·
                        {" "}{def.statuses.length} stage{def.statuses.length === 1 ? "" : "s"} · {templates.length} task template{templates.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {latest.note && <p className="text-xs text-gray-600">{latest.note}</p>}
                    <p className="mt-1 text-xs text-gray-500">{def.statuses.map((s) => s.label).join(" → ")}</p>
                    {canWrite && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {have === null && <Button type="button" size="sm" disabled={busy !== null} onClick={() => void install(key, latest.version)}>{busy === `${key}:${latest.version}` ? "Installing…" : "Install"}</Button>}
                        {have !== null && have < latest.version && <Button type="button" size="sm" disabled={busy !== null} onClick={() => void install(key, latest.version)}>{busy === `${key}:${latest.version}` ? "Upgrading…" : `Upgrade to version ${latest.version}`}</Button>}
                        {have !== null && have >= latest.version && <span className="text-xs text-gray-500">Up to date.</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your stages" />
        <CardBody className="space-y-3">
          <p className="text-sm text-gray-600">
            The stages a matter moves through, in order. Your clients read the label. A stage is offered on the matter
            types it names, or on every type. The key is fixed: matters and packs point at it.
          </p>
          <ul className="divide-y divide-gray-100">
            {statuses.map((s) => (
              <li key={s.id} className="py-3">
                {editing === s.id ? (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <label className="text-sm text-gray-900 sm:col-span-2">Label<input type="text" maxLength={80} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={field} /></label>
                    <label className="text-sm text-gray-900">Colour<input type="text" maxLength={20} value={draft.colour} onChange={(e) => setDraft({ ...draft, colour: e.target.value })} placeholder="slate, blue, green, amber, indigo, gray" className={field} /></label>
                    <label className="text-sm text-gray-900">Order<input type="number" min={0} max={10000} value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: Number(e.target.value) })} className={field} /></label>
                    <label className="text-sm text-gray-900 sm:col-span-4">Next action the stage suggests (offered when the slot is empty)<input type="text" maxLength={500} value={draft.defaultNextAction} onChange={(e) => setDraft({ ...draft, defaultNextAction: e.target.value })} className={field} /></label>
                    <div className="flex gap-2 sm:col-span-4">
                      <Button type="button" size="sm" disabled={busy === s.id} onClick={() => void saveEdit(s.id)}>{busy === s.id ? "Saving…" : "Save"}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.label}{s.is_terminal ? <span className="ml-2 text-xs text-gray-500">closes the file</span> : null}</p>
                      <p className="text-xs text-gray-600">
                        <span className="font-mono">{s.key}</span> · order {s.sort ?? 0}
                        {s.matter_types?.length ? ` · ${s.matter_types.map((t) => t.replace(/_/g, " ")).join(", ")} matters` : " · every type"}
                        {s.pack_key ? ` · from the ${s.pack_key} pack v${s.pack_version}` : " · the firm's own"}
                        {s.default_next_action ? ` · suggests: ${s.default_next_action}` : ""}
                      </p>
                    </div>
                    {canWrite && <button type="button" className="text-xs font-medium text-brand underline" onClick={() => startEdit(s)}>Edit the wording</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
