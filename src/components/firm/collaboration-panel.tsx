"use client";

// The owning firm's side of a collaboration: propose one, share a named version into it, take a
// version back, end it. Sharing is per version on purpose — a document that gains a new version
// tomorrow is not shared by a row written today, and the screen says so.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { formatDay } from "@/lib/days";
import { COLLABORATION_KINDS, KIND_LABEL } from "@/lib/collaboration-copy";
import {
  endCollaboration, proposeCollaboration, shareDocumentWithCollaborator, withdrawSharedDocument,
} from "@/lib/actions/collaboration";
import type { CollaborationDocumentRow, CollaborationRow } from "@/lib/db/types";

const field =
  "mt-1 block w-full min-h-11 rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900 focus:border-[#141414] focus:outline-none";

export function CollaborationPanel({
  matterId, rows, shared, firms, documents, firmNames, today,
}: {
  matterId: string;
  rows: CollaborationRow[];
  shared: CollaborationDocumentRow[];
  /** Firms on Docket, from the service directory. */
  firms: Array<{ id: string; name: string }>;
  /** The matter's documents with a current version that has a checksum — the only shareable thing. */
  documents: Array<{ id: string; name: string; versionId: string | null; checksum: string | null }>;
  firmNames: Record<string, string>;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ withFirmId: "", kind: "agency", scopeNote: "", shareUpdates: false, endsOn: "" });
  const [pick, setPick] = useState<Record<string, string>>({});

  const live = (r: CollaborationRow) =>
    Boolean(r.accepted_at) && !r.ended_at && !r.declined_at && (!r.ends_on || r.ends_on >= today);

  function stateOf(r: CollaborationRow): string {
    if (r.ended_at) return "Ended";
    if (r.declined_at) return `Declined${r.decline_reason ? `: ${r.decline_reason}` : ""}`;
    if (!r.accepted_at) return "Waiting on their answer";
    if (r.ends_on && r.ends_on < today) return `Expired ${formatDay(r.ends_on)}`;
    return r.ends_on ? `Live until ${formatDay(r.ends_on)}` : "Live";
  }

  async function propose(e: FormEvent) {
    e.preventDefault();
    setBusy("propose"); setError(null);
    try {
      const r = await proposeCollaboration({
        matterId, withFirmId: form.withFirmId, kind: form.kind,
        scopeNote: form.scopeNote, shareUpdates: form.shareUpdates, endsOn: form.endsOn || null,
      });
      if ("error" in r) { setError(r.error); return; }
      setOpen(false); setForm({ ...form, scopeNote: "", endsOn: "" }); router.refresh();
    } catch { setError("Nothing was proposed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function share(collaborationId: string) {
    const versionId = pick[collaborationId];
    if (!versionId) return;
    setBusy(collaborationId); setError(null);
    try {
      const r = await shareDocumentWithCollaborator(collaborationId, versionId, matterId);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing was shared — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function takeBack(id: string) {
    setBusy(id); setError(null);
    try {
      const r = await withdrawSharedDocument(id, matterId);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function finish(id: string) {
    const reason = window.prompt("Why is this ending? (the other firm sees it)") ?? "";
    setBusy(id); setError(null);
    try {
      const r = await endCollaboration(id, reason);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  const shareable = documents.filter((d) => d.versionId && d.checksum);

  return (
    <Card>
      <CardHeader
        title="Firms working with us on this matter"
        action={<Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Bring in a firm"}</Button>}
      />
      {error && <CardBody><Alert kind="error" title="That was refused">{error}</Alert></CardBody>}

      {open && (
        <CardBody className="border-t border-gray-100">
          <form onSubmit={propose} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-gray-900">Which firm
                <select required value={form.withFirmId} onChange={(e) => setForm({ ...form, withFirmId: e.target.value })} className={field}>
                  <option value="">Choose a firm on Docket</option>
                  {firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  A firm that is not on Docket has nothing to receive — record that arrangement as a note on the matter.
                </span>
              </label>
              <label className="block text-sm text-gray-900">As what
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={field}>
                  {COLLABORATION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <span className="mt-1 block text-xs text-gray-500">{COLLABORATION_KINDS.find((k) => k.value === form.kind)?.hint}</span>
              </label>
            </div>
            <label className="block text-sm text-gray-900">What you are asking them to do
              <input type="text" required maxLength={2000} value={form.scopeNote}
                     placeholder="Appear for us at the hearing on 3 November and report back."
                     onChange={(e) => setForm({ ...form, scopeNote: e.target.value })} className={field} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input type="checkbox" checked={form.shareUpdates} onChange={(e) => setForm({ ...form, shareUpdates: e.target.checked })} />
                Share the updates we write for the client
              </label>
              <label className="block text-sm text-gray-900">Ends on (optional)
                <input type="date" min={today} value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className={field} />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              They see the case title, suit number and court as they read today, and nothing else of the file. Internal
              notes are never shared. Documents are shared one named version at a time, after they accept — and your
              client is told the moment they do.
            </p>
            <Button type="submit" disabled={busy === "propose"}>{busy === "propose" ? "Proposing…" : "Propose it"}</Button>
          </form>
        </CardBody>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody else is on this matter"
          hint="Bring in agency counsel for an appearance, refer it on, or add joint counsel — each with what they may see and when it ends."
        />
      ) : (
        <ul>
          {rows.map((r) => {
            const docs = shared.filter((s) => s.collaboration_id === r.id);
            return (
              <li key={r.id} className="border-t border-gray-100 px-[15px] py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-gray-900">
                    {firmNames[r.with_firm_id] ?? "Another firm"}
                    <span className="font-normal text-gray-600"> · {KIND_LABEL.get(r.kind) ?? r.kind}</span>
                  </p>
                  <span className={live(r) ? "text-xs font-medium text-[#15803D]" : "text-xs text-gray-500"}>{stateOf(r)}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-gray-800">{r.scope_note}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {r.share_updates ? "Our client-facing updates are shared" : "No updates shared"} ·
                  {" "}{docs.filter((d) => !d.withdrawn_at).length} document{docs.filter((d) => !d.withdrawn_at).length === 1 ? "" : "s"} shared
                </p>

                {docs.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {docs.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                        <span className={d.withdrawn_at ? "line-through" : ""}>
                          {documents.find((x) => x.versionId === d.document_version_id)?.name
                            ?? documents.find((x) => x.id === d.document_id)?.name
                            ?? "A version"}
                        </span>
                        {d.withdrawn_at
                          ? <span>· taken back {formatDay(d.withdrawn_at.slice(0, 10))}</span>
                          : live(r) && (
                              <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => void takeBack(d.id)}>Take it back</Button>
                            )}
                      </li>
                    ))}
                  </ul>
                )}

                {live(r) && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-gray-700">
                      Share a version
                      <select value={pick[r.id] ?? ""} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}
                              className="mt-1 block min-h-10 rounded-lg border border-gray-300 px-2 text-sm">
                        <option value="">Choose a document</option>
                        {shareable.map((d) => <option key={d.id} value={d.versionId ?? ""}>{d.name}</option>)}
                      </select>
                    </label>
                    <Button size="sm" disabled={busy === r.id || !pick[r.id]} onClick={() => void share(r.id)}>Share it</Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void finish(r.id)}>End this</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CardBody className="border-t border-gray-100 text-xs text-gray-500">
        Sharing is by version: a document that gains a new version is not shared by a row written before it, so hand
        over the new one deliberately. Taking a version back, or ending the arrangement, closes every door at once —
        but neither recalls a copy already downloaded, and nothing in Docket can.
      </CardBody>
    </Card>
  );
}
