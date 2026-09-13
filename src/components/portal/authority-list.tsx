"use client";

// The client's own list of who may act for them, with the button that ends one.
// revoke_representation() admits the principal, so this is the client's act — not a request.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/days";
import { revokeRepresentation } from "@/lib/actions/delegation";
import { CAPACITIES } from "@/lib/delegation-copy";
import type { RepresentationRow } from "@/lib/db/types";

const CAPACITY_LABEL = new Map<string, string>(CAPACITIES.map((c) => [c.value, c.label]));

export function AuthorityList({ rows, firms, today }: {
  rows: RepresentationRow[];
  firms: Record<string, string>;
  /** Today where the client is. starts_on and expires_on are calendar days. */
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = (r: RepresentationRow) =>
    !r.revoked_at && r.accepted_at !== null && r.starts_on <= today && (!r.expires_on || r.expires_on >= today);

  async function end(id: string) {
    setBusy(id); setError(null);
    try {
      const r = await revokeRepresentation(id, "Ended by the client.");
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <>
      {error && <div className="px-4 pt-3"><Alert kind="error" title="That was refused">{error}</Alert></div>}
      <ul className="divide-y divide-gray-100">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">
                {/* Who, before what. An authority you cannot put a name to is one you cannot check. */}
                {r.representative_name ?? r.invited_email ?? r.invited_phone ?? "Somebody"}
                <span className="font-normal text-gray-600">
                  {" · "}{CAPACITY_LABEL.get(r.capacity) ?? r.capacity}
                  {r.organisation_name ? ` for ${r.organisation_name}` : ""}
                </span>
              </p>
              <span className={live(r) ? "text-xs font-medium text-emerald-700" : "text-xs text-gray-500"}>
                {r.revoked_at ? "Ended"
                  : !r.accepted_at ? "Not yet taken up"
                  : r.expires_on && r.expires_on < today ? `Expired ${formatDay(r.expires_on)}`
                  : r.expires_on ? `Until ${formatDay(r.expires_on)}` : "Until you end it"}
              </span>
            </div>
            {r.representative_name && (r.invited_email || r.invited_phone) && (
              <p className="text-xs text-gray-500">
                Invited as {r.invited_email ?? r.invited_phone}
              </p>
            )}
            <p className="mt-0.5 text-xs text-gray-600">
              {firms[r.firm_id] ?? "Your firm"} · {r.scope === "all_matters" ? "all your unrestricted matters there" : "one matter"} ·
              {" "}{r.can_view_docs ? "may read your documents" : "no documents"} ·
              {" "}{r.can_pay ? "may pay on your behalf" : "no payments"} · cannot sign anything for you
            </p>
            {live(r) && (
              <Button size="sm" variant="ghost" className="mt-1" disabled={busy === r.id} onClick={() => void end(r.id)}>
                {busy === r.id ? "Ending…" : "End this authority"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
