"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveConsultationNotes } from "@/lib/actions/video";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

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

  const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <label htmlFor="client_summary" className="text-sm font-medium text-gray-900">Summary for the client <span className="text-red-700">*</span></label>
        <p className="text-xs text-gray-500">Plain language. This is what the client reads in their app.</p>
        <textarea id="client_summary" required rows={5} maxLength={4000} value={clientSummary} onChange={(e) => setClientSummary(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="advice_given" className="text-sm font-medium text-gray-900">Advice given</label>
        <textarea id="advice_given" rows={3} maxLength={4000} value={adviceGiven} onChange={(e) => setAdviceGiven(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="follow_up" className="text-sm font-medium text-gray-900">Next steps / follow-up</label>
        <textarea id="follow_up" rows={3} maxLength={4000} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={field} />
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label htmlFor="internal_notes" className="text-sm font-medium text-amber-900">Internal notes (never shown to the client)</label>
        <textarea id="internal_notes" rows={4} maxLength={8000} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className={field} />
      </div>
      {canComplete && (
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={markCompleted} onChange={(e) => setMarkCompleted(e.target.checked)} className="h-4 w-4" />
          Mark the appointment as completed
        </label>
      )}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save notes"}</Button>
    </form>
  );
}
