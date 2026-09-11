"use client";

// Two boxes, two audiences.
//
// Everything in the first group reaches the client's app the moment it saves;
// the internal note has no client-facing path at all. Which is which is the
// single most important thing on this screen, so each field says so on its own
// label rather than relying on the lawyer remembering the convention.

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveConsultationNotes } from "@/lib/actions/video";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const field =
  // 16px so iOS Safari does not zoom the page when the field takes focus.
  "mt-1.5 w-full rounded-[9px] border border-[#D6D3CE] bg-white px-3 py-[11px] text-base leading-relaxed text-[#3F3B36] focus:border-[#141414] focus:outline-none";

function AudienceLabel({
  htmlFor,
  children,
  badge,
  tone,
}: {
  htmlFor: string;
  children: ReactNode;
  badge: string;
  tone: "client" | "internal";
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-700">
      {children}
      <span
        className={
          tone === "client"
            ? "rounded border border-[#A7D8BE] bg-[#ECFDF3] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.03em] text-[#05603A]"
            : "rounded border border-[#E5C4C4] bg-[#FEF3F2] px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.03em] text-[#912018]"
        }
      >
        {badge}
      </span>
    </label>
  );
}

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
    <form onSubmit={onSubmit} className="space-y-3.5">
      {error && <Alert kind="error">{error}</Alert>}

      <div>
        <AudienceLabel htmlFor="client_summary" badge="Client sees" tone="client">
          Summary for the client <span className="font-normal text-[#B42318]">*</span>
        </AudienceLabel>
        <p className="mt-1 text-[11.5px] text-[#57534E]">Plain language. This is what the client reads in their app.</p>
        <textarea id="client_summary" required rows={5} maxLength={4000} value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} className={field} />
      </div>

      <div>
        <AudienceLabel htmlFor="advice_given" badge="Client sees" tone="client">Advice given</AudienceLabel>
        <textarea id="advice_given" rows={3} maxLength={4000} value={adviceGiven} onChange={(e) => setAdviceGiven(e.target.value)} className={field} />
      </div>

      <div>
        <AudienceLabel htmlFor="follow_up" badge="Client sees" tone="client">Next steps / follow-up</AudienceLabel>
        <textarea id="follow_up" rows={3} maxLength={4000} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={field} />
      </div>

      <div className="border-t border-[#F0EEEA] pt-3.5">
        <AudienceLabel htmlFor="internal_notes" badge="Never reaches the client" tone="internal">Internal note</AudienceLabel>
        <p className="mt-1 text-[11.5px] text-[#57534E]">
          For the file and for colleagues. It has no client-facing path at all.
        </p>
        <textarea id="internal_notes" rows={4} maxLength={8000} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className={field} />
      </div>

      {canComplete && (
        <label className="flex items-center gap-2.5 text-[13px] text-[#141414]">
          <input type="checkbox" checked={markCompleted} onChange={(e) => setMarkCompleted(e.target.checked)} className="size-4" />
          Mark the consultation as completed
        </label>
      )}

      <Button type="submit" variant="neutral" size="lg" className="w-full" disabled={busy}>
        {busy ? "Saving…" : canComplete && markCompleted ? "Save and mark completed" : "Save notes"}
      </Button>
    </form>
  );
}
