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
//
// The kind used to be an emoji in a 24px column (⚖ 🎥 📅 📄 ✉ ★ ₦ 📎 ✎ ⇄) and
// the internal badge carried a 🔒. Both are now line icons from the app's own
// set, on the same shape as src/components/portal/timeline.tsx: a 28px disc
// that keeps every row's text on one left margin, and the kind carried as
// screen-reader text, because a picture of a balance is not a word. The badge
// keeps its words as well as its padlock — that distinction is the most
// important one on this screen.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CourtUpdateForm } from "@/components/firm/court-update-form";
import { Alert } from "@/components/ui/alert";
import { AppButton } from "@/components/app/button";
import type { IconProps } from "@/components/ui/icons";
import {
  CalendarIcon,
  ChevronDownIcon,
  DocumentIcon,
  LockIcon,
  MailIcon,
  NairaIcon,
  PaperclipIcon,
  PencilIcon,
  ScalesIcon,
  StarIcon,
  SwapIcon,
  VideoIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { CourtRow, UpdateRow } from "@/lib/db/types";

/** An updates row as staff read it: visibility and the poster come too. */
export interface StaffUpdate extends UpdateRow {
  visibility: string;
  posted_by: string | null;
}

const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
/** Required is said in words: colour in the console means late, unpaid or waiting on you. */
const requiredMark = <span className="font-normal text-dk-muted">(required)</span>;

type IconGlyph = (p: IconProps) => React.JSX.Element;

/**
 * The ten `update_kind` values, each with its mark and its name. Typed as
 * possibly-missing on purpose: the enum can grow in a migration before it grows
 * here, and an unnamed kind falls back to a dot rather than nothing.
 */
const KINDS: Record<string, { Icon: IconGlyph; label: string } | undefined> = {
  court_sitting: { Icon: ScalesIcon, label: "Court sitting" },
  consultation: { Icon: VideoIcon, label: "Consultation" },
  appointment: { Icon: CalendarIcon, label: "Appointment" },
  filing: { Icon: DocumentIcon, label: "Filing" },
  correspondence: { Icon: MailIcon, label: "Correspondence" },
  milestone: { Icon: StarIcon, label: "Milestone" },
  fee: { Icon: NairaIcon, label: "Fee" },
  document: { Icon: PaperclipIcon, label: "Document" },
  note: { Icon: PencilIcon, label: "Note" },
  status_change: { Icon: SwapIcon, label: "Status change" },
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
    };
    // No .select(): the select policy cannot read a row inserted by the same statement.
    const { error: insertError } = await supabase.from("updates").insert(row);
    setBusy(false);
    if (insertError) { setError(insertError.message); return; }

    setItems((cur) => [{ ...row, payload: {}, created_at: row.occurred_at } as StaffUpdate, ...cur]);
    setTitle("");
    setBody("");
    setNoted(visibility);
    router.refresh();
  }, [body, firmId, matterId, router, title, userId, visibility]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div>
      <section id="post-update" className="scroll-mt-24 border-b border-dk-rule px-[15px] py-[17px]">
        <h3 className="font-app-head text-[15.5px] font-semibold text-dk-strong">Post what happened in court</h3>
        <p className="mt-0.5 text-[12.5px] leading-snug text-dk-soft">
          The client is told within a minute. The internal note beside it stays with the firm.
        </p>
        <div className="mt-3.5">
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

      <section className="border-b border-dk-rule px-[15px] py-[17px]">
        <details className="group">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="flex-1 text-[13px] font-semibold text-dk-pri underline underline-offset-2">
              Add a note to the file
            </span>
            <span aria-hidden="true" className="flex-none text-dk-muted transition group-open:rotate-180">
              <ChevronDownIcon size={16} />
            </span>
          </summary>
          <form onSubmit={addNote} className="mt-3 flex flex-col gap-3">
            {error && <Alert kind="error" title="That note was refused">{error}</Alert>}
            {noted === "client" && <Alert kind="success">Note added. Your client can see it.</Alert>}
            {noted === "internal" && <Alert kind="success">Internal note added. Your client cannot see it.</Alert>}
            <div>
              <label htmlFor="note-title" className={labelClass}>Heading {requiredMark}</label>
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
              <label htmlFor="note-body" className={labelClass}>Detail</label>
              <textarea id="note-body" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} className={field} />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className={labelClass}>Who may read this?</legend>
              <label className="flex min-h-[52px] items-start gap-2.5 rounded-[10px] border border-dk-line bg-white p-3">
                <input type="radio" name="note-visibility" className="mt-0.5 h-5 w-5 flex-none" checked={visibility === "client"} onChange={() => setVisibility("client")} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-dk-strong">Your client and the firm</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-dk-muted">It appears in the client&rsquo;s app straight away.</span>
                </span>
              </label>
              {/* The amber and the padlock both stay: this is the one choice on the
                  screen that decides whether a client ever reads the words. */}
              <label className="flex min-h-[52px] items-start gap-2.5 rounded-[10px] border border-[#E7B84B] bg-[#FFFBEB] p-3">
                <input type="radio" name="note-visibility" className="mt-0.5 h-5 w-5 flex-none" checked={visibility === "internal"} onChange={() => setVisibility("internal")} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#7A3E0A]">
                    <LockIcon size={14} className="flex-none" />
                    Internal — the firm only
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-[#92400E]">
                    Never shown to your client, in the app or in any notification.
                  </span>
                </span>
              </label>
            </fieldset>
            <AppButton type="submit" variant="primary-sm" disabled={busy}>{busy ? "Saving…" : "Add to the timeline"}</AppButton>
          </form>
        </details>
      </section>

      {items.length === 0 ? (
        <p className="px-6 py-10 text-center text-[12.5px] leading-relaxed text-dk-muted">
          Nothing on this file yet. Post what happened in court above, or add a note — the client sees everything that is not marked internal.
        </p>
      ) : (
        <ol className="divide-y divide-dk-rule">
          {items.map((u) => {
            const internal = u.visibility === "internal";
            const p = (u.payload ?? {}) as Record<string, unknown>;
            const outcome = text(p.outcome);
            const nextDate = text(p.next_date);
            const poster = u.posted_by ? names[u.posted_by] ?? null : null;
            const kind = KINDS[u.kind];
            const Glyph = kind?.Icon;
            return (
              <li
                key={u.id}
                className={cn(
                  "flex gap-[11px] px-[15px] py-[13px]",
                  internal && "border-l-4 border-[#E7B84B] bg-[#FFFBEB] pl-[11px]",
                )}
              >
                <span
                  aria-hidden="true"
                  className="mt-[1px] grid h-7 w-7 flex-none place-items-center rounded-full bg-dk-rule text-dk-soft"
                >
                  {Glyph ? <Glyph size={15} /> : <span className="h-[5px] w-[5px] rounded-full bg-dk-muted" />}
                </span>
                <div className="min-w-0 flex-1">
                  {/* The most important distinction on this screen: a padlock, the
                      words, and the amber — no one of the three on its own. */}
                  {internal && (
                    <p className="mb-1">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7B84B] bg-white px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] text-[#7A3E0A]">
                        <LockIcon size={12} className="flex-none" />
                        Internal — not shown to your client
                      </span>
                    </p>
                  )}
                  <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                    <span className="sr-only">{kind?.label ?? "Update"}. </span>
                    {u.title}
                  </p>
                  {u.body && (
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-dk-body">{u.body}</p>
                  )}
                  {u.kind === "court_sitting" && (
                    <dl className="mt-1.5 grid gap-1 text-[12px] leading-snug text-dk-soft sm:grid-cols-2">
                      {outcome && (
                        <div><dt className="inline text-dk-muted">Outcome: </dt><dd className="inline">{OUTCOME_LABELS[outcome] ?? outcome.replace(/_/g, " ")}</dd></div>
                      )}
                      {text(p.court_name) && (
                        <div><dt className="inline text-dk-muted">Court: </dt><dd className="inline">{text(p.court_name)}</dd></div>
                      )}
                      {text(p.adjourned_at_instance_of) && (
                        <div><dt className="inline text-dk-muted">At the instance of: </dt><dd className="inline">{text(p.adjourned_at_instance_of)}</dd></div>
                      )}
                      {nextDate && (
                        <div>
                          <dt className="inline text-dk-muted">Next date: </dt>
                          <dd className="inline">{fmt.format(new Date(nextDate))}{text(p.next_purpose) ? ` · ${text(p.next_purpose)}` : ""}</dd>
                        </div>
                      )}
                      {text(p.judge) && (
                        <div><dt className="inline text-dk-muted">Judge: </dt><dd className="inline">{text(p.judge)}</dd></div>
                      )}
                      {text(p.courtroom) && (
                        <div><dt className="inline text-dk-muted">Court room: </dt><dd className="inline">{text(p.courtroom)}</dd></div>
                      )}
                    </dl>
                  )}
                  <p className="mt-[3px] text-[11px] text-dk-muted">
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
