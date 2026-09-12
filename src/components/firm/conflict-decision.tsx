"use client";

// The two pieces of the conflict register that more than one screen needs: what a check found,
// and the lawyer's decision on it. A matter has them on its Conflicts tab; a consultation has
// them on its check-in, because with clearance required a held booking cannot be confirmed until
// a check naming that consultation has been decided.

import { useState, type FormEvent } from "react";
import { decideConflictCheck } from "@/lib/actions/matters";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ConflictCheckRow, ConflictMatch } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const KIND_LABELS: Record<ConflictMatch["kind"], string> = {
  client: "a client of the firm",
  adverse: "on the other side of a matter",
  opposing_party: "named as the opposing party",
  cause_title: "in a cause title",
};

const STRENGTH_LABELS: Record<ConflictMatch["strength"], string> = {
  exact: "exact",
  contains: "contains",
  similar: "similar",
};

export const OUTCOME_LABELS: Record<NonNullable<ConflictCheckRow["outcome"]>, string> = {
  clear: "Clear",
  conflict: "Conflict",
  waived: "Waived",
};

/** The latest decided check decides: clear or waived is cleared; conflict, or none, is not. */
export function isCleared(checks: ConflictCheckRow[]): boolean {
  const decided = checks.filter((c) => c.outcome !== null).sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""));
  return decided.length > 0 && (decided[0].outcome === "clear" || decided[0].outcome === "waived");
}

export function MatchList({ matches, names }: { matches: ConflictMatch[]; names: Record<string, string> }) {
  if (matches.length === 0) return <p className="text-sm text-emerald-800">No name on the firm&rsquo;s register matched.</p>;
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-amber-200 bg-amber-50">
      {matches.map((m, i) => (
        <li key={`${m.kind}-${m.name}-${m.matter_id ?? "r"}-${i}`} className="px-3 py-2 text-sm">
          <p className="font-medium text-gray-900">
            {m.name}
            <span className="ml-2 text-xs font-normal text-gray-600">{STRENGTH_LABELS[m.strength]} match for &ldquo;{m.searched}&rdquo;</span>
          </p>
          <p className="text-xs text-gray-700">
            {KIND_LABELS[m.kind]}
            {m.restricted
              ? ` — on a restricted matter you are not on; ask ${m.lead_lawyer_id ? names[m.lead_lawyer_id] ?? "its lead lawyer" : "its lead lawyer"}`
              : m.matter_id
                ? (
                  <>
                    {" — "}
                    <a href={`/firm/matters/${m.matter_id}`} className="text-brand underline">{m.matter_reference ?? "the matter"}</a>
                    {m.matter_title ? ` · ${m.matter_title}` : ""}
                  </>
                )
                : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Clear, conflict, or waived with a note. One decision per check; the database refuses a second. */
export function DecideCheck({
  checkId, matterId, appointmentId = null, onDone,
}: {
  checkId: string;
  matterId: string | null;
  /** Set when the check is on a consultation rather than a matter, so its page refreshes. */
  appointmentId?: string | null;
  onDone?: (outcome: "clear" | "conflict" | "waived") => void;
}) {
  const [outcome, setOutcome] = useState<"clear" | "conflict" | "waived">("clear");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r = await decideConflictCheck(checkId, outcome, note, matterId, appointmentId);
    setBusy(false);
    if (r?.error) { setError(r.error); return; }
    onDone?.(outcome);
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
      {error && <Alert kind="error">{error}</Alert>}
      <p className="text-sm font-medium text-gray-900">Your decision</p>
      <div className="flex flex-wrap gap-2">
        {(["clear", "conflict", "waived"] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOutcome(o)}
            aria-pressed={outcome === o}
            className={
              outcome === o
                ? "flex min-h-[44px] items-center rounded-full border border-brand bg-brand px-4 text-sm text-brand-on"
                : "flex min-h-[44px] items-center rounded-full border border-gray-300 bg-white px-4 text-sm text-gray-700 hover:border-brand"
            }
          >
            {OUTCOME_LABELS[o]}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={`note-${checkId}`} className="text-sm font-medium text-gray-900">
          {outcome === "waived" ? "Why the conflict is waived" : "Note"}
          {outcome === "waived" ? <span className="text-red-700"> *</span> : <span className="text-gray-500"> (optional)</span>}
        </label>
        <p className="text-xs text-gray-500">
          {outcome === "waived"
            ? "Who consented, and how. A waiver without its reason is refused."
            : "What you looked at, and why you decided as you did."}
        </p>
        <textarea id={`note-${checkId}`} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </div>
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Recording…" : "Record the decision"}</Button>
    </form>
  );
}
