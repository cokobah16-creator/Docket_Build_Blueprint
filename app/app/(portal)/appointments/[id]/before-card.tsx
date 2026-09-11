"use client";

// What is still needed before the consultation, as the database computed it — and the one thing
// the client can answer here: the questions the firm's form still requires. Documents are
// uploaded on the tab below; the fee is paid in the panel above; terms are accepted where the
// app asks for them. A conflict item says only that the firm has its own checks to finish.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { amendIntakeAnswers } from "@/lib/actions/checkin";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AppointmentReadiness, IntakeQuestion } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export function BeforeCard({ appointmentId, readiness, questions }: { appointmentId: string; readiness: AppointmentReadiness; questions: IntakeQuestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const intake = readiness.items.find((i) => i.kind === "intake");
  const missingKeys = new Set((intake?.missing ?? []).map((m) => m.key));
  const toAsk = questions.filter((q) => missingKeys.has(q.key));
  const outstanding = readiness.items.filter((i) => !i.satisfied);

  function submit() {
    setError(null);
    start(async () => {
      const r = await amendIntakeAnswers(appointmentId, answers);
      if (r?.error) { setError(r.error); return; }
      setAnswers({});
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {readiness.held && (
        <p className="text-[13.5px] leading-relaxed text-gray-700">
          Your booking is <strong>held</strong>: the time is yours, and the firm confirms it once everything below is in.
        </p>
      )}
      {outstanding.length === 0 ? (
        <p className="text-[13.5px] text-emerald-800">Everything the firm asked for is in.{readiness.held ? " The firm confirms the booking from its side." : ""}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {readiness.items.map((i) => (
            <li key={i.kind} className="flex items-start gap-3 py-2">
              <span className={i.satisfied ? "mt-0.5 text-emerald-700" : "mt-0.5 text-amber-700"} aria-hidden="true">{i.satisfied ? "✓" : "·"}</span>
              <div className="min-w-0">
                <p className={i.satisfied ? "text-[13.5px] text-gray-500" : "text-[13.5px] font-medium text-gray-900"}>{i.label}</p>
                <p className="text-[12px] text-gray-600">{i.detail}</p>
                {!i.satisfied && i.kind === "consent" && <Link href="/app" className="text-[12.5px] font-medium text-brand underline">Read and accept them</Link>}
                {!i.satisfied && i.kind === "payment" && <p className="text-[12px] text-gray-600">Pay in the panel above.</p>}
                {!i.satisfied && i.kind === "documents" && <p className="text-[12px] text-gray-600">Upload each one in Documents below — the request is listed there.</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {toAsk.length > 0 && (
        <form className="space-y-3 rounded-lg border border-gray-200 p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p className="text-[13.5px] font-medium text-gray-900">Still to answer</p>
          {error && <Alert kind="error">{error}</Alert>}
          {toAsk.map((q) => (
            <div key={q.key}>
              <label htmlFor={`q-${q.key}`} className="text-sm font-medium text-gray-900">{q.label}</label>
              {q.help && <p className="text-xs text-gray-500">{q.help}</p>}
              {q.type === "longtext" ? (
                <textarea id={`q-${q.key}`} rows={3} maxLength={q.max_length ?? 4000} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field} />
              ) : q.type === "choice" && q.multiple ? (
                <div className="mt-1 space-y-1">
                  {(q.options ?? []).map((o) => {
                    const cur = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
                    return (
                      <label key={o} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800">
                        <input type="checkbox" checked={cur.includes(o)} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o) }))} className="h-5 w-5" />
                        {o}
                      </label>
                    );
                  })}
                </div>
              ) : q.type === "choice" ? (
                <select id={`q-${q.key}`} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field}>
                  <option value="">Choose</option>
                  {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id={`q-${q.key}`} type="text" maxLength={q.max_length ?? 500} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field} />
              )}
            </div>
          ))}
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send my answers"}</Button>
        </form>
      )}
    </div>
  );
}
