"use client";

// Consultation notes, as two boxes (design/pwa artboard, LAWYER · APPOINTMENT
// + NOTES).
//
// The whole point of this screen is which box you are typing in. Everything in
// the first box is published to the client's app the moment it saves —
// consultation_notes is what the client appointment screen reads back. The
// second box writes consultation_internal_notes, which has no client policy at
// all and is never read by /app. So each box is framed in its own ink and
// badged in words: "Client sees" against "Never reaches the client". The icons
// are a second signal, never the only one.
//
// Those two greens and reds are the console's one licence to use colour —
// something the client can see, and something they must never — and both say
// so in words. Everything else here is the console's neutral ink.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveConsultationNotes } from "@/lib/actions/video";
import { AppButton } from "@/components/app";
import { Alert } from "@/components/ui/alert";
import { EyeIcon, LockIcon } from "@/components/ui/icons";

const FIELD =
  "mt-1.5 w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[13px] leading-[1.5] text-dk-body placeholder:text-dk-muted focus:border-dk-pri focus:outline-none focus:ring-1 focus:ring-dk-pri";

const LABEL = "block text-[12px] font-semibold text-dk-body";

const BADGE =
  "inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-[4px] border px-[5px] py-px text-[10px] font-bold uppercase tracking-[0.03em]";

export function NotesForm({
  appointmentId, initial, canComplete,
}: {
  appointmentId: string;
  initial: { clientSummary: string; adviceGiven: string; followUp: string; internalNotes: string };
  canComplete: boolean;
}) {
  const router = useRouter();
  const [clientSummary, setClientSummary] = useState(initial.clientSummary);
  const [adviceGiven, setAdviceGiven] = useState(initial.adviceGiven);
  const [followUp, setFollowUp] = useState(initial.followUp);
  const [internalNotes, setInternalNotes] = useState(initial.internalNotes);
  const [markCompleted, setMarkCompleted] = useState(canComplete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await saveConsultationNotes({ appointmentId, clientSummary, adviceGiven, followUp, internalNotes, markCompleted: canComplete && markCompleted });
    setBusy(false);
    if (r?.error) { setError(r.error); return; }
    router.push(`/firm/appointments/${appointmentId}?saved=1`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-[13px]">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Box one. Everything inside it reaches the client. */}
      <fieldset className="rounded-[10px] border border-[#A7D8BE] bg-[#F6FEF9] px-3 pb-[13px] pt-1">
        <legend className="flex flex-wrap items-center gap-[7px] px-1 text-[12px] font-semibold text-dk-body">
          Summary for the client
          <span className={`${BADGE} border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]`}>
            <EyeIcon size={11} strokeWidth={2} />
            Client sees
          </span>
        </legend>
        <p className="text-[11.5px] leading-[1.45] text-dk-soft">
          Plain language. Everything in this box is published to the client&rsquo;s app when you save.
        </p>
        <div className="mt-2.5 flex flex-col gap-[11px]">
          <div>
            <label htmlFor="client_summary" className={LABEL}>
              Summary <span aria-hidden="true" className="text-[#B42318]">*</span>
            </label>
            <textarea
              id="client_summary"
              required
              rows={5}
              maxLength={4000}
              value={clientSummary}
              onChange={(e) => setClientSummary(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="advice_given" className={LABEL}>Advice given</label>
            <textarea
              id="advice_given"
              rows={3}
              maxLength={4000}
              value={adviceGiven}
              onChange={(e) => setAdviceGiven(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="follow_up" className={LABEL}>Next steps / follow-up</label>
            <textarea
              id="follow_up"
              rows={3}
              maxLength={4000}
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className={FIELD}
            />
          </div>
        </div>
      </fieldset>

      {/* Box two. The firm's own record: no client anywhere can read it. */}
      <fieldset className="rounded-[10px] border border-[#E5C4C4] bg-[#FFFBFA] px-3 pb-[13px] pt-1">
        <legend className="flex flex-wrap items-center gap-[7px] px-1 text-[12px] font-semibold text-dk-body">
          Internal note
          <span className={`${BADGE} border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]`}>
            <LockIcon size={11} strokeWidth={2} />
            Never reaches the client
          </span>
        </legend>
        <p className="text-[11.5px] leading-[1.45] text-dk-soft">
          Kept for the firm. It is not published to the client&rsquo;s app and does not appear in their summary.
        </p>
        <label htmlFor="internal_notes" className="sr-only">
          Internal note — never reaches the client
        </label>
        <textarea
          id="internal_notes"
          rows={4}
          maxLength={8000}
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          className={FIELD}
        />
      </fieldset>

      {canComplete && (
        /* The whole row is the target, so the 18px box is not what a thumb has
           to find — the label around it is 48px tall. */
        <label className="flex min-h-[48px] cursor-pointer items-center gap-2.5 rounded-[9px] border border-dk-field bg-white px-3 text-[13px] text-dk-body">
          <input
            type="checkbox"
            checked={markCompleted}
            onChange={(e) => setMarkCompleted(e.target.checked)}
            className="h-[18px] w-[18px] flex-none accent-dk-pri"
          />
          Mark the appointment as completed
        </label>
      )}

      <AppButton type="submit" disabled={busy}>
        {busy ? "Saving…" : canComplete && markCompleted ? "Save and mark completed" : "Save notes"}
      </AppButton>
    </form>
  );
}
