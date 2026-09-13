"use client";

// Who may act for this client — granted against a recorded authority, scoped, dated, and endable
// by the firm or by the client themselves.
//
// The panel decides nothing. grant_representation() refuses a principal who is not this firm's
// client, an authority that has already expired, and a grant with nothing recorded against it;
// revoke_representation() admits the firm or the principal. Every refusal below is the database's
// own sentence, shown as it was written.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { formatDay } from "@/lib/days";
import { grantRepresentation, revokeRepresentation } from "@/lib/actions/delegation";
import { AUTHORITY_KINDS, CAPACITIES } from "@/lib/delegation-copy";
import type { RepresentationRow } from "@/lib/db/types";

const field =
  "mt-1 block w-full min-h-11 rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900 focus:border-[#141414] focus:outline-none";

const CAPACITY_LABEL = new Map<string, string>(CAPACITIES.map((c) => [c.value, c.label]));
const AUTHORITY_LABEL = new Map<string, string>(AUTHORITY_KINDS.map((a) => [a.value, a.label]));

export function RepresentationsPanel({
  firmId, principalId, principalName, matters, rows, names, canWrite, today,
}: {
  firmId: string;
  principalId: string;
  principalName: string;
  /** The client's matters at this firm, for a per-matter authority. */
  matters: Array<{ id: string; reference: string; title: string }>;
  rows: RepresentationRow[];
  /** user_id → name, for whoever the firm can already see. */
  names: Record<string, string>;
  canWrite: boolean;
  /** Today in the firm's timezone, as a calendar day. Expiry is a day, never an instant. */
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; who: string } | null>(null);
  const [form, setForm] = useState({
    capacity: "company_officer", authorityKind: "board_resolution", matterId: "",
    organisation: "", canViewDocs: false, canPay: false, expiresOn: "",
    authorityRef: "", note: "", invitedEmail: "", invitedPhone: "",
  });

  const live = (r: RepresentationRow) =>
    !r.revoked_at && r.accepted_at !== null && r.starts_on <= today && (!r.expires_on || r.expires_on >= today);

  function stateOf(r: RepresentationRow): string {
    if (r.revoked_at) return "Ended";
    if (!r.accepted_at) return "Invited — not yet taken up";
    if (r.expires_on && r.expires_on < today) return `Expired ${formatDay(r.expires_on)}`;
    if (r.starts_on > today) return `Starts ${formatDay(r.starts_on)}`;
    return r.expires_on ? `Live until ${formatDay(r.expires_on)}` : "Live, until ended";
  }

  async function grant(e: FormEvent) {
    e.preventDefault();
    setBusy("grant"); setError(null); setIssued(null);
    try {
      const r = await grantRepresentation({
        firmId, principalId,
        capacity: form.capacity, authorityKind: form.authorityKind,
        matterId: form.matterId || null,
        organisation: form.organisation.trim() || null,
        canViewDocs: form.canViewDocs, canPay: form.canPay,
        expiresOn: form.expiresOn || null,
        authorityRef: form.authorityRef.trim() || null,
        note: form.note.trim() || null,
        invitedEmail: form.invitedEmail.trim() || null,
        invitedPhone: form.invitedPhone.trim() || null,
      });
      if ("error" in r) { setError(r.error); return; }
      setIssued({ token: r.token, who: form.invitedEmail.trim() || form.invitedPhone.trim() || "the person you named" });
      setOpen(false);
      setForm({ ...form, organisation: "", authorityRef: "", note: "", invitedEmail: "", invitedPhone: "", expiresOn: "" });
      router.refresh();
    } catch { setError("Nothing was granted — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function end(id: string) {
    const reason = window.prompt("Why is this authority ending? (kept on the record)") ?? "";
    setBusy(id); setError(null);
    try {
      const r = await revokeRepresentation(id, reason);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader
        title="Who may act for this client"
        action={canWrite ? <Button size="sm" onClick={() => { setOpen((o) => !o); setIssued(null); }}>{open ? "Cancel" : "Authorise someone"}</Button> : undefined}
      />

      {error && <CardBody><Alert kind="error" title="That was refused">{error}</Alert></CardBody>}

      {issued && (
        <CardBody>
          <Alert kind="success" title="Authority recorded — now send the link">
            <p className="text-sm">
              Send this one-time link to {issued.who}. It is shown here once and Docket does not email it.
              It works only for the person you named, signed in as themselves, and only once.
            </p>
            <code className="mt-2 block break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11.5px] text-gray-900">
              {typeof window === "undefined" ? "" : `${window.location.origin}/app/authority/accept?token=${issued.token}`}
            </code>
            <p className="mt-2 text-xs">
              {principalName} has been told that you recorded it, on the channel they chose.
            </p>
          </Alert>
        </CardBody>
      )}

      {open && canWrite && (
        <CardBody className="border-t border-gray-100">
          <form onSubmit={grant} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-gray-900">In what capacity
                <select value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className={field}>
                  {CAPACITIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <span className="mt-1 block text-xs text-gray-500">{CAPACITIES.find((c) => c.value === form.capacity)?.hint}</span>
              </label>
              <label className="block text-sm text-gray-900">Acting for which body (optional)
                <input type="text" maxLength={200} value={form.organisation} placeholder="Acme Holdings Ltd"
                       onChange={(e) => setForm({ ...form, organisation: e.target.value })} className={field} />
              </label>
            </div>

            <label className="block text-sm text-gray-900">Over what
              <select value={form.matterId} onChange={(e) => setForm({ ...form, matterId: e.target.value })} className={field}>
                <option value="">Every unrestricted matter this client has with us, now and later</option>
                {matters.map((m) => <option key={m.id} value={m.id}>{m.reference} — {m.title}</option>)}
              </select>
            </label>

            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-800">What they may do</legend>
              <p className="text-xs text-gray-500">
                They can always read the matter, its timeline and its court dates, and exchange messages with you.
                Signing is never delegated: an instrument is executed by the client, not by their representative.
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm text-gray-900">
                <input type="checkbox" checked={form.canViewDocs} onChange={(e) => setForm({ ...form, canViewDocs: e.target.checked })} />
                Read and add documents on the file
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-gray-900">
                <input type="checkbox" checked={form.canPay} onChange={(e) => setForm({ ...form, canPay: e.target.checked })} />
                See and pay what this client owes
              </label>
            </fieldset>

            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-800">What you saw</legend>
              <p className="text-xs text-gray-500">
                Docket does not verify anybody&rsquo;s identity and never claims to. It records that you did, against
                this, today — and the record cannot afterwards be edited.
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-gray-900">Kind
                  <select value={form.authorityKind} onChange={(e) => setForm({ ...form, authorityKind: e.target.value })} className={field}>
                    {AUTHORITY_KINDS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm text-gray-900">Its reference
                  <input type="text" maxLength={200} value={form.authorityRef} placeholder="Board resolution of 3 September 2026"
                         onChange={(e) => setForm({ ...form, authorityRef: e.target.value })} className={field} />
                </label>
              </div>
              <label className="mt-2 block text-sm text-gray-900">Note
                <input type="text" maxLength={2000} value={form.note} placeholder="Seen in the minute book, original returned"
                       onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} />
              </label>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm text-gray-900">Their email
                <input type="email" value={form.invitedEmail} onChange={(e) => setForm({ ...form, invitedEmail: e.target.value })} className={field} />
              </label>
              <label className="block text-sm text-gray-900">or their phone
                <input type="tel" maxLength={32} value={form.invitedPhone} onChange={(e) => setForm({ ...form, invitedPhone: e.target.value })} className={field} />
              </label>
              <label className="block text-sm text-gray-900">Ends on (optional)
                <input type="date" min={today} value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className={field} />
              </label>
            </div>
            <p className="text-xs text-gray-500">
              One of the two is required. Whoever opens the link must be signed in as that exact person, measured
              against the address or number they authenticated with — not one typed into a profile afterwards. An
              address on its own gives nobody access, and neither does the link on its own.
            </p>

            <Button type="submit" disabled={busy === "grant"}>{busy === "grant" ? "Recording…" : "Record the authority"}</Button>
          </form>
        </CardBody>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody else may act for this client"
          hint="A company officer, an attorney under a power, or a family member the client has authorised — each with what they may do and when it ends."
        />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="border-t border-gray-100 px-[15px] py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-gray-900">
                  {r.representative_name ?? (r.representative_id ? (names[r.representative_id] ?? "A person") : (r.invited_email ?? r.invited_phone ?? "Invited"))}
                  <span className="font-normal text-gray-600"> · {CAPACITY_LABEL.get(r.capacity) ?? r.capacity}</span>
                  {r.organisation_name ? <span className="font-normal text-gray-600"> for {r.organisation_name}</span> : null}
                </p>
                <span className={live(r) ? "text-xs font-medium text-[#15803D]" : "text-xs text-gray-500"}>{stateOf(r)}</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-600">
                {r.scope === "all_matters" ? "Every matter of this client" : "One matter"} ·
                {" "}{r.can_view_docs ? "documents" : "no documents"} ·
                {" "}{r.can_pay ? "may pay" : "no money"} · never signs
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {AUTHORITY_LABEL.get(r.authority_kind) ?? r.authority_kind}
                {r.authority_ref ? ` · ${r.authority_ref}` : ""}
                {r.verified_by && names[r.verified_by] ? ` · verified by ${names[r.verified_by]}` : ""}
              </p>
              {r.revoked_at && r.revoke_reason && <p className="mt-0.5 text-xs text-gray-500">Ended: {r.revoke_reason}</p>}
              {canWrite && !r.revoked_at && (
                <Button size="sm" variant="ghost" className="mt-1" disabled={busy === r.id} onClick={() => void end(r.id)}>
                  {busy === r.id ? "Ending…" : "End this authority"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <CardBody className="border-t border-gray-100 text-xs text-gray-500">
        Ending an authority stops it at once. It cannot recall a document already downloaded or a page already read —
        the record of what was open to them, and when, is in the audit log and the document reads.
        {principalName} can end any of these themselves, from their own app.
      </CardBody>
    </Card>
  );
}
