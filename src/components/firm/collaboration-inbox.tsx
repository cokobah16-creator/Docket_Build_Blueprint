"use client";

// One arrangement per row, from whichever side you are on: answer it, talk on it, end it.
// Every button calls a function that re-decides who may do it; nothing here is a permission check.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/days";
import { KIND_LABEL } from "@/lib/collaboration-copy";
import { endCollaboration, postCollaborationNote, respondToCollaboration } from "@/lib/actions/collaboration";
import type { CollaborationInboxRow, CollaborationNoteRow } from "@/lib/db/types";

export function CollaborationInbox({ rows, notes, firmId, today, side }: {
  rows: CollaborationInboxRow[];
  notes: CollaborationNoteRow[];
  /** The firm reading this screen, so a note can be labelled "us" or "them". */
  firmId: string;
  today: string;
  /** "receiving" adds Accept and Decline; the owning firm never answers its own proposal. */
  side: "receiving" | "owning";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const live = (r: CollaborationInboxRow) =>
    Boolean(r.accepted_at) && !r.ended_at && (!r.ends_on || r.ends_on >= today);
  const awaiting = (r: CollaborationInboxRow) => !r.accepted_at && !r.declined_at && !r.ended_at;

  function stateOf(r: CollaborationInboxRow): string {
    if (r.ended_at) return "Ended";
    if (r.declined_at) return "Declined";
    if (!r.accepted_at) return "Waiting on an answer";
    if (r.ends_on && r.ends_on < today) return `Expired ${formatDay(r.ends_on)}`;
    return r.ends_on ? `Live until ${formatDay(r.ends_on)}` : "Live";
  }

  async function answer(id: string, accept: boolean) {
    const reason = accept ? null : (window.prompt("Why are you declining? (the other firm sees this)") ?? "");
    setBusy(id); setError(null);
    try {
      const r = await respondToCollaboration(id, accept, reason);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function finish(id: string) {
    const reason = window.prompt("Why is this ending? (kept on the record, and the other firm sees it)") ?? "";
    setBusy(id); setError(null);
    try {
      const r = await endCollaboration(id, reason);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function note(e: FormEvent, id: string) {
    e.preventDefault();
    setBusy(`note:${id}`); setError(null);
    try {
      const r = await postCollaborationNote(id, draft);
      if (r?.error) { setError(r.error); return; }
      setDraft(""); router.refresh();
    } catch { setError("Nothing was sent — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <>
      {error && <div className="px-[15px] pt-3"><Alert kind="error" title="That was refused">{error}</Alert></div>}
      <ul>
        {rows.map((r) => {
          const mine = notes.filter((n) => n.collaboration_id === r.id);
          return (
            <li key={r.id} className="border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-[#141414]">
                  {r.case_title ?? "A matter"}
                  <span className="font-normal text-[#57534E]"> · {KIND_LABEL.get(r.kind) ?? r.kind}</span>
                </p>
                <span className={live(r) ? "text-xs font-medium text-[#15803D]" : "text-xs text-[#57534E]"}>{stateOf(r)}</span>
              </div>
              <p className="mt-0.5 text-xs text-[#57534E]">
                {side === "receiving" ? `From ${r.from_firm_name}` : `With another firm`}
                {r.suit_number ? ` · ${r.suit_number}` : ""}
                {r.court_name ? ` · ${r.court_name}` : ""}
              </p>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-gray-800">{r.scope_note}</p>
              <p className="mt-1 text-xs text-[#57534E]">
                {r.shared_documents} document{r.shared_documents === 1 ? "" : "s"} shared ·
                {" "}{r.share_updates ? "their client-facing updates are shared" : "no updates shared"}
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {side === "receiving" && awaiting(r) && (
                  <>
                    <Button size="sm" disabled={busy === r.id} onClick={() => void answer(r.id, true)}>
                      {busy === r.id ? "…" : "Accept"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void answer(r.id, false)}>Decline</Button>
                  </>
                )}
                {live(r) && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => { setOpenNotes(openNotes === r.id ? null : r.id); setDraft(""); }}>
                      {openNotes === r.id ? "Close" : `Notes (${mine.length})`}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => void finish(r.id)}>End this</Button>
                  </>
                )}
              </div>

              {openNotes === r.id && (
                <div className="mt-2 rounded-lg bg-gray-50 p-3">
                  {mine.length === 0 ? (
                    <p className="text-xs text-[#57534E]">Nothing said yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {mine.map((n) => (
                        <li key={n.id} className="text-[12.5px] text-gray-800">
                          <span className="font-medium">{n.firm_id === firmId ? "Us" : "Them"}:</span> {n.body}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form onSubmit={(e) => void note(e, r.id)} className="mt-2 flex gap-2">
                    <input
                      value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000}
                      placeholder="A note to the other firm"
                      className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-[14px] text-gray-900 focus:border-[#141414] focus:outline-none"
                    />
                    <Button type="submit" size="sm" disabled={busy === `note:${r.id}` || draft.trim().length === 0}>Send</Button>
                  </form>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
