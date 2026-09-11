"use client";

// The staff view of a matter's timeline: what happened in court at the top,
// then every entry on the file — including the internal ones the client never
// sees.
//
// Rules enforced here:
//  · Internal entries NEVER reach a client. They are visible here because the
//    reader is staff (updates_staff_select), and every one of them carries an
//    unmistakable badge so nobody mistakes an internal note for something the
//    client has read.
//  · A note is inserted as the signed-in staff member with posted_by =
//    auth.uid(); the updates policy (staff_w + posted_by = auth.uid()) is the
//    authorization, never this file, and no service key is used. The id is
//    generated here and the insert returns nothing, because the select policy
//    cannot read a row inserted by the same statement.
//  · Timestamps are UTC in the database and rendered in the viewer's zone.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CourtUpdateForm } from "@/components/firm/court-update-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { CourtRow, UpdateRow } from "@/lib/db/types";
import { ClientUpdateFields, EMPTY_SHAPE, type ClientUpdateShape } from "@/components/firm/client-update-fields";
import { UpdateStructure } from "@/components/portal/update-structure";

/** An updates row as staff read it: visibility and the poster come too. */
export interface StaffUpdate extends UpdateRow {
  visibility: string;
  posted_by: string | null;
}

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const KIND_ICON: Record<string, string> = {
  court_sitting: "⚖", consultation: "🎥", appointment: "📅", filing: "📄", correspondence: "✉",
  milestone: "★", fee: "₦", document: "📎", note: "✎", status_change: "⇄",
};

const OUTCOME_LABELS: Record<string, string> = {
  hearing_held: "Hearing held",
  adjourned: "Adjourned",
  adjourned_sine_die: "Adjourned sine die",
  hearing_notice: "Hearing notice",
  ruling_delivered: "Ruling delivered",
  judgment_delivered: "Judgment delivered",
  struck_out: "Struck out",
  stood_down: "Stood down",
  mention: "Mention",
  court_did_not_sit: "Court did not sit",
  vacated: "Date vacated",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function StaffTimeline({
  matterId, firmId, userId, initial, timezone, courts, currentCourtId, currentCourtName, judicialDivision, names,
}: {
  matterId: string;
  firmId: string;
  userId: string;
  initial: StaffUpdate[];
  timezone: string;
  courts: CourtRow[];
  currentCourtId: string | null;
  currentCourtName: string | null;
  judicialDivision: string | null;
  /** user id → the name to show against an entry. */
  names: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<StaffUpdate[]>(initial);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"client" | "internal">("client");
  const [shape, setShape] = useState<ClientUpdateShape>(EMPTY_SHAPE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noted, setNoted] = useState<"client" | "internal" | null>(null);

  useEffect(() => setItems(initial), [initial]);

  // Realtime: RLS decides what the subscription delivers, so staff receive the
  // internal entries a colleague posts as well as the client-visible ones.
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const channel = supabase
      .channel(`staff-updates-${matterId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "updates", filter: `matter_id=eq.${matterId}` }, (payload) => {
        const row = payload.new as StaffUpdate;
        setItems((cur) => (cur.some((u) => u.id === row.id) ? cur : [row, ...cur].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matterId]);

  const addNote = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNoted(null);
    const heading = title.trim();
    if (heading.length < 2) { setError("Give the note a short heading — it is what the timeline shows."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }

    setBusy(true);
    const row = {
      id: crypto.randomUUID(),
      matter_id: matterId,
      firm_id: firmId,
      kind: "note",
      visibility,
      title: heading.slice(0, 200),
      body: body.trim() || null,
      posted_by: userId,
      occurred_at: new Date().toISOString(),
      // The client update's shape travels only on a client-visible entry; an internal note has
      // no client to be shaped for. The database refuses a "required" with nothing said.
      meaning: visibility === "client" ? shape.meaning.trim() || null : null,
      next_step: visibility === "client" ? shape.nextStep.trim() || null : null,
      client_action: visibility === "client" && shape.actionRequired === "required" ? shape.clientAction.trim() || null : null,
      action_required: visibility === "client" ? (shape.actionRequired === "required" ? true : shape.actionRequired === "none" ? false : null) : null,
      next_update_by: visibility === "client" ? shape.nextUpdateBy || null : null,
    };
    // No .select(): the select policy cannot read a row inserted by the same statement.
    const { error: insertError } = await supabase.from("updates").insert(row);
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }

    setItems((cur) => [{ ...row, payload: {}, created_at: row.occurred_at } as StaffUpdate, ...cur]);
    setTitle("");
    setBody("");
    setShape(EMPTY_SHAPE);
    setNoted(visibility);
    router.refresh();
  }, [body, firmId, matterId, router, shape, title, userId, visibility]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div>
      <section id="post-update" className="scroll-mt-24 border-b border-gray-100 px-4 py-5 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">Post what happened in court</h3>
        <p className="mt-0.5 text-sm text-gray-600">
          The client is told within a minute. The internal note beside it stays with the firm.
        </p>
        <div className="mt-4">
          <CourtUpdateForm
            matterId={matterId}
            firmId={firmId}
            timezone={timezone}
            courts={courts}
            currentCourtId={currentCourtId}
            currentCourtName={currentCourtName}
            judicialDivision={judicialDivision}
          />
        </div>
      </section>

      <section className="border-b border-gray-100 px-4 py-5 sm:px-5">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand marker:text-brand">
            Add a note to the file
          </summary>
          <form onSubmit={addNote} className="mt-3 space-y-3">
            {error && <Alert kind="error" title="That note was refused">{error}</Alert>}
            {noted === "client" && <Alert kind="success">Note added. Your client can see it.</Alert>}
            {noted === "internal" && <Alert kind="success">Internal note added. Your client cannot see it.</Alert>}
            <div>
              <label htmlFor="note-title" className="text-sm font-medium text-gray-900">Heading <span className="text-red-700">*</span></label>
              <input
                id="note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                placeholder="Processes filed at the registry"
                className={field}
              />
            </div>
            <div>
              <label htmlFor="note-body" className="text-sm font-medium text-gray-900">Detail</label>
              <textarea id="note-body" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={field} />
            </div>
            {visibility === "client" && <ClientUpdateFields idPrefix="note" value={shape} onChange={setShape} />}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">Who may read this?</legend>
              <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
                <input type="radio" name="note-visibility" className="mt-0.5 h-4 w-4" checked={visibility === "client"} onChange={() => setVisibility("client")} />
                <span>
                  <span className="font-medium text-gray-900">Your client and the firm</span>
                  <span className="block text-xs text-gray-500">It appears in the client&rsquo;s app straight away.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                <input type="radio" name="note-visibility" className="mt-0.5 h-4 w-4" checked={visibility === "internal"} onChange={() => setVisibility("internal")} />
                <span>
                  <span className="font-medium text-amber-900">Internal — the firm only</span>
                  <span className="block text-xs text-amber-800">Never shown to your client, in the app or in any notification.</span>
                </span>
              </label>
            </fieldset>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add to the timeline"}</Button>
          </form>
        </details>
      </section>

      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          Nothing on this file yet. Post what happened in court above, or add a note — the client sees everything that is not marked internal.
        </p>
      ) : (
        <ol className="divide-y divide-gray-100">
          {items.map((u) => {
            const internal = u.visibility === "internal";
            const p = (u.payload ?? {}) as Record<string, unknown>;
            const outcome = text(p.outcome);
            const nextDate = text(p.next_date);
            const poster = u.posted_by ? names[u.posted_by] ?? null : null;
            return (
              <li
                key={u.id}
                className={cn("flex gap-3 px-4 py-4 sm:px-5", internal && "border-l-4 border-amber-400 bg-amber-50/60")}
              >
                <span aria-hidden="true" className="mt-0.5 w-6 shrink-0 text-center text-base">{KIND_ICON[u.kind] ?? "•"}</span>
                <div className="min-w-0 flex-1">
                  {internal && (
                    <p className="mb-1">
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                        <span aria-hidden="true">🔒</span> Internal — not shown to your client
                      </span>
                    </p>
                  )}
                  <p className="text-sm font-medium text-gray-900">{u.title}</p>
                  {u.body && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{u.body}</p>}
                  {!internal && <UpdateStructure update={u} compact />}
                  {u.kind === "court_sitting" && (
                    <dl className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
                      {outcome && (
                        <div><dt className="inline text-gray-500">Outcome: </dt><dd className="inline">{OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, " ")}</dd></div>
                      )}
                      {text(p.court_name) && (
                        <div><dt className="inline text-gray-500">Court: </dt><dd className="inline">{text(p.court_name)}</dd></div>
                      )}
                      {text(p.adjourned_at_instance_of) && (
                        <div><dt className="inline text-gray-500">At the instance of: </dt><dd className="inline">{text(p.adjourned_at_instance_of)}</dd></div>
                      )}
                      {nextDate && (
                        <div>
                          <dt className="inline text-gray-500">Next date: </dt>
                          <dd className="inline">{fmt.format(new Date(nextDate))}{text(p.next_purpose) ? ` · ${text(p.next_purpose)}` : ""}</dd>
                        </div>
                      )}
                      {text(p.judge) && (
                        <div><dt className="inline text-gray-500">Judge: </dt><dd className="inline">{text(p.judge)}</dd></div>
                      )}
                      {text(p.courtroom) && (
                        <div><dt className="inline text-gray-500">Court room: </dt><dd className="inline">{text(p.courtroom)}</dd></div>
                      )}
                    </dl>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {fmt.format(new Date(u.occurred_at))}{poster ? ` · ${poster}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
