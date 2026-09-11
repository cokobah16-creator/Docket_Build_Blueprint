"use client";

// The firm's side of the check-in: what is in and what is not, the confirmation of a held
// booking (which the database refuses until it is ready), and asking the client for a document
// on the consultation.

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { confirmAppointment, requestAppointmentDocument, withdrawAppointmentDocumentRequest } from "@/lib/actions/checkin";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/days";
import type { AppointmentReadiness, DocumentRequestRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export function CheckinPanel({ appointmentId, firmId, readiness, requests, canWrite }: { appointmentId: string; firmId: string; readiness: AppointmentReadiness; requests: DocumentRequestRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [dueOn, setDueOn] = useState("");
  const open = requests.filter((r) => !r.fulfilled_at && !r.cancelled_at);
  const answered = requests.filter((r) => r.fulfilled_at);

  function confirm() {
    setError(null);
    start(async () => {
      const r = await confirmAppointment(appointmentId);
      if (r?.error) { setError(r.error); return; }
      router.refresh();
    });
  }
  function ask(e: FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await requestAppointmentDocument(appointmentId, firmId, { title, why: why || null, dueOn: dueOn || null });
      if (r?.error) { setError(r.error); return; }
      setTitle(""); setWhy(""); setDueOn("");
      router.refresh();
    });
  }
  function withdraw(id: string) {
    setError(null);
    start(async () => {
      const r = await withdrawAppointmentDocumentRequest(id, appointmentId);
      if (r?.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      <ul className="divide-y divide-gray-100">
        {readiness.items.map((i) => (
          <li key={i.kind} className="flex items-start gap-3 py-2">
            <span className={i.satisfied ? "mt-0.5 text-emerald-700" : "mt-0.5 text-amber-700"} aria-hidden="true">{i.satisfied ? "✓" : "·"}</span>
            <div className="min-w-0">
              <p className={i.satisfied ? "text-sm text-gray-500" : "text-sm font-medium text-gray-900"}>{i.label}</p>
              <p className="text-xs text-gray-600">{i.detail}{i.kind === "intake" && i.missing?.length ? ` (${i.missing.map((m) => m.label).join(", ")})` : ""}</p>
            </div>
          </li>
        ))}
        {readiness.items.length === 0 && <li className="py-2 text-sm text-gray-600">Nothing is required of the client before this consultation.</li>}
      </ul>

      {readiness.held && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={confirm} disabled={pending || !canWrite}>{pending ? "Confirming…" : "Confirm the consultation"}</Button>
          <span className="text-xs text-gray-600">
            {readiness.ready ? "Everything asked for is in." : readiness.checkin_required ? "The database refuses until every item above is in." : "Nothing is required; confirm when you are ready."}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-900">Ask the client for a document before you meet</p>
        {open.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100">
            {open.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-gray-800">{r.title}{r.due_on ? <span className="ml-1 text-xs text-gray-500">by {formatDay(r.due_on)}</span> : null}</span>
                {canWrite && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => withdraw(r.id)}>Withdraw</Button>}
              </li>
            ))}
          </ul>
        )}
        {answered.length > 0 && <p className="mt-2 text-xs text-gray-600">Answered: {answered.map((r) => r.title).join(", ")}.</p>}
        {canWrite && (
          <form onSubmit={ask} className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="ck-title" className="text-sm font-medium text-gray-900">Document</label>
                <input id="ck-title" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="Tenancy agreement" />
              </div>
              <div>
                <label htmlFor="ck-due" className="text-sm font-medium text-gray-900">Needed by</label>
                <input id="ck-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={field} />
              </div>
            </div>
            <div>
              <label htmlFor="ck-why" className="text-sm font-medium text-gray-900">Why <span className="text-gray-500">(optional, the client reads it)</span></label>
              <input id="ck-why" type="text" maxLength={2000} value={why} onChange={(e) => setWhy(e.target.value)} className={field} />
            </div>
            <Button type="submit" size="sm" disabled={pending || title.trim().length < 2}>{pending ? "Asking…" : "Ask for it"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
