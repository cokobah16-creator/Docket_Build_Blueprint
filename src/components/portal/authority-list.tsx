"use client";

// The client's own list of who may act for them, with the button that ends one.
// revoke_representation() admits the principal, so this is the client's act, not a request.
//
// Ending one asks first, and says what ending does before the tap (docs/VOICE.md, rule 16). Each
// row says in whole sentences what the person may and may not do, because a client checking an
// authority reads it as a list of permissions, not as a line of codes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/badge";
import { calendarDayWords } from "@/lib/notifications-copy";
import { revokeRepresentation } from "@/lib/actions/delegation";
import { CAPACITIES } from "@/lib/delegation-copy";
import type { RepresentationRow } from "@/lib/db/types";

const CAPACITY_LABEL = new Map<string, string>(CAPACITIES.map((c) => [c.value, c.label]));

/** revokeRepresentation() hands back the database's own words; the client reads these instead. */
function refusal(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not permitted")) return "This authority was not ended, because this account is not allowed to end it. Message your firm.";
  if (m.includes("not found") || m.includes("unknown authority")) return "This authority was not ended, because it could not be found. Refresh the page to see the list as it is now.";
  return "This authority was not ended. Try again. If it keeps happening, message your firm.";
}

export function AuthorityList({ rows, firms, today }: {
  rows: RepresentationRow[];
  firms: Record<string, string>;
  /** Today where the client is. starts_on and expires_on are calendar days. */
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RepresentationRow | null>(null);

  const live = (r: RepresentationRow) =>
    !r.revoked_at && r.accepted_at !== null && r.starts_on <= today && (!r.expires_on || r.expires_on >= today);

  // Who, before what. An authority you cannot put a name to is one you cannot check.
  const who = (r: RepresentationRow) => r.representative_name ?? r.invited_email ?? r.invited_phone ?? "Somebody";

  async function end(id: string) {
    setBusy(id); setError(null);
    try {
      const r = await revokeRepresentation(id, "Ended by the client.");
      if (r?.error) setError(refusal(r.error)); else router.refresh();
    } catch {
      // The request may have arrived even though the answer did not, so this does not say nothing changed.
      setError("The connection dropped before Docket could confirm this. Refresh the page to see whether the authority has ended.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  // The state in a word or two for the pill, and the period as a sentence under it. An authority
  // is in force through its expires_on day, so the period reads "until" that day.
  const state = (r: RepresentationRow) => {
    if (r.revoked_at) return { pill: <StatusPill status="cancelled" label="Ended" />, period: null };
    if (!r.accepted_at) return { pill: <StatusPill status="pending" label="Not taken up yet" />, period: null };
    if (r.expires_on && r.expires_on < today) {
      return { pill: <StatusPill status="closed" label="Expired" />, period: `It lasted until ${calendarDayWords(r.expires_on)}.` };
    }
    if (r.starts_on > today) {
      return { pill: <StatusPill status="scheduled" label="Not started yet" />, period: `It starts on ${calendarDayWords(r.starts_on)}.` };
    }
    return {
      pill: <StatusPill status="active" />,
      period: r.expires_on ? `It lasts until ${calendarDayWords(r.expires_on)}.` : "It lasts until you end it.",
    };
  };

  return (
    <>
      {error && <div className="px-4 pt-3"><Alert kind="error" title="That did not go through">{error}</Alert></div>}
      <ul className="divide-y divide-hairline">
        {rows.map((r) => {
          const firm = firms[r.firm_id] ?? "your firm";
          const { pill, period } = state(r);
          return (
            <li key={r.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-2.5">
                <p className="min-w-0 text-15 font-semibold text-ink">{who(r)}</p>
                {pill}
              </div>
              <p className="mt-0.5 text-13 text-ink-muted">
                {CAPACITY_LABEL.get(r.capacity) ?? "Acting for you"}{r.organisation_name ? ` for ${r.organisation_name}` : ""}.
              </p>
              {r.representative_name && (r.invited_email || r.invited_phone) && (
                <p className="text-13 text-ink-muted">Invited as {r.invited_email ?? r.invited_phone}.</p>
              )}
              <ul className="mt-2 space-y-0.5 text-13 text-ink">
                <li>{r.scope === "all_matters" ? `It covers all your matters at ${firm}, except restricted ones.` : `It covers one matter at ${firm}.`}</li>
                <li>{r.can_view_docs ? "They may read your documents." : "They may not read your documents."}</li>
                <li>{r.can_pay ? "They may pay on your behalf." : "They may not pay on your behalf."}</li>
                <li>They cannot sign anything for you.</li>
              </ul>
              {period && <p className="mt-1 text-13 text-ink-muted">{period}</p>}
              {live(r) && (
                <Button size="sm" variant="ghost" className="mt-2.5" pending={busy === r.id} onClick={() => setConfirming(r)}>
                  {busy === r.id ? "Ending…" : "End this authority"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <Modal open={confirming !== null} onClose={() => { if (!busy) setConfirming(null); }} title="End this authority?">
        {confirming && (
          <div className="space-y-4">
            <div className="space-y-2 text-15 text-ink">
              <p>{who(confirming)} will no longer be able to act for you under it.</p>
              <p>Ending it stops it at once. It cannot undo what they have already read or downloaded.</p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row-reverse">
              <Button variant="danger" pending={busy === confirming.id} onClick={() => void end(confirming.id)}>
                {busy === confirming.id ? "Ending…" : "Yes, end it"}
              </Button>
              <Button variant="ghost" disabled={busy === confirming.id} onClick={() => setConfirming(null)}>Keep it</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
