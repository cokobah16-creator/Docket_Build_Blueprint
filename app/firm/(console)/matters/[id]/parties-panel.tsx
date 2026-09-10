"use client";

// Who is on the matter on the client side, and how they got there.
//
// Rules enforced here:
//  · invite_matter_party() mints the token — it is never guessable from the
//    client side, and it is the only thing that puts a person on a matter
//    (accept_invite() does the rest when they open the link). Every write goes
//    through a server action that runs as the signed-in staff member, so
//    staff_w() decides and no service key is used.
//  · Refusals from the database are shown word for word ("that person is
//    already on this matter"), never a shrug.
//  · Nothing firm-specific: the firm's name arrives from context and is used
//    only in the message the client will read.

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { inviteMatterParty, removeMatterParty, revokeMatterInvite } from "@/lib/actions/matters";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./matter-tabs";

/**
 * Where an invited client lands. accept_invite(token) joins them to the matter
 * once they have signed in; the console only ever hands over the link.
 */
const INVITE_PATH = "/app/join";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export interface MatterPartyRow {
  user_id: string;
  role: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  can_view_docs: boolean;
  can_pay: boolean;
}

export interface PendingInvite {
  id: string;
  phone: string | null;
  email: string | null;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  client: "Client",
  contact: "Contact",
  co_counsel: "Co-counsel",
};

function digitsOf(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function PartiesPanel({
  matterId, matterReference, matterTitle, firmName, parties, invites, timezone,
}: {
  matterId: string;
  matterReference: string;
  matterTitle: string;
  firmName: string;
  parties: MatterPartyRow[];
  invites: PendingInvite[];
  timezone: string;
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"client" | "contact">("client");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ token: string; expiresAt: string; phone: string | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const linkFor = (token: string) => `${origin}${INVITE_PATH}?token=${encodeURIComponent(token)}`;
  const messageFor = (token: string) =>
    `${firmName}: you have been added to "${matterTitle}" (${matterReference}). Open this link to follow your matter, read updates and send us documents: ${linkFor(token)}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInvited(null);
    setBusy(true);
    const result = await inviteMatterParty(matterId, { phone: phone.trim(), email: email.trim(), role });
    setBusy(false);
    if ("error" in result) { setError(result.error); return; }
    setInvited({ token: result.token, expiresAt: result.expiresAt, phone: phone.trim() || null });
    setPhone("");
    setEmail("");
    router.refresh();
  }

  async function remove(userId: string) {
    setError(null);
    setWorking(userId);
    const result = await removeMatterParty(matterId, userId);
    setWorking(null);
    setConfirming(null);
    if (result?.error) { setError(result.error); return; }
    router.refresh();
  }

  async function revoke(inviteId: string) {
    setError(null);
    setWorking(inviteId);
    const result = await revokeMatterInvite(inviteId);
    setWorking(null);
    setConfirming(null);
    if (result?.error) { setError(result.error); return; }
    router.refresh();
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div className="divide-y divide-gray-100">
      {error && <div className="px-4 py-4 sm:px-5"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <section className="px-4 py-4 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">On this matter</h3>
        {parties.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            Nobody on the client side yet. Invite your client below — they then see the timeline, the documents you share and their invoices in their app.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {parties.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.full_name ?? "Client"}</p>
                  <p className="text-xs text-gray-500">
                    {ROLE_LABELS[p.role] ?? p.role.replace(/_/g, " ")}
                    {p.phone ? ` · ${p.phone}` : ""}
                    {p.email ? ` · ${p.email}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.can_view_docs ? "Can read shared documents" : "No document access"} · {p.can_pay ? "Can pay invoices" : "Cannot pay invoices"}
                  </p>
                </div>
                {confirming === p.user_id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-600">They lose this matter in their app at once.</span>
                    <Button size="sm" variant="danger" disabled={working === p.user_id} onClick={() => remove(p.user_id)}>
                      {working === p.user_id ? "Removing…" : "Remove"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Keep</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(p.user_id)}>Take off the matter</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 py-4 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">Invite your client</h3>
        <p className="mt-0.5 text-sm text-gray-600">
          A phone number, an email address, or both. Send them the link over WhatsApp or SMS — it expires in fourteen days.
        </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="invite-phone" className="text-sm font-medium text-gray-900">Phone</label>
              <input
                id="invite-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0803 000 0000"
                className={field}
              />
            </div>
            <div>
              <label htmlFor="invite-email" className="text-sm font-medium text-gray-900">Email</label>
              <input
                id="invite-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className={field}
              />
            </div>
          </div>
          <div>
            <label htmlFor="invite-role" className="text-sm font-medium text-gray-900">They join as</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value === "contact" ? "contact" : "client")} className={field}>
              <option value="client">Client — the matter is theirs</option>
              <option value="contact">Contact — follows the matter with the client&rsquo;s knowledge</option>
            </select>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Creating the invitation…" : "Create the invitation"}</Button>
        </form>

        {invited && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-900">Invitation ready — send it now.</p>
            <p className="mt-1 break-all text-xs text-emerald-900">{linkFor(invited.token)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyButton path={`${INVITE_PATH}?token=${encodeURIComponent(invited.token)}`} label="Copy the link" />
              {digitsOf(invited.phone) && (
                <>
                  <a
                    href={`https://wa.me/${digitsOf(invited.phone)}?text=${encodeURIComponent(messageFor(invited.token))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-3 text-sm font-medium text-white hover:opacity-90"
                  >
                    Send on WhatsApp
                  </a>
                  <a
                    href={`sms:${invited.phone ?? ""}?&body=${encodeURIComponent(messageFor(invited.token))}`}
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-brand hover:bg-black/5"
                  >
                    Send by SMS
                  </a>
                </>
              )}
            </div>
            <p className="mt-2 text-xs text-emerald-900">Expires {invited.expiresAt ? fmt.format(new Date(invited.expiresAt)) : "in fourteen days"}.</p>
          </div>
        )}
      </section>

      <section className="px-4 py-4 sm:px-5">
        <h3 className="font-heading text-base font-semibold text-gray-900">Invitations waiting</h3>
        {invites.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">
            No invitation is outstanding. Everyone invited to this matter has either accepted or been revoked.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {invites.map((i) => (
              <li key={i.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">
                    {i.phone ?? i.email ?? "Invitation"}
                    <span className="ml-2 text-xs font-normal text-gray-500">{ROLE_LABELS[i.role] ?? i.role}</span>
                  </p>
                  <p className="text-xs text-gray-500">Expires {fmt.format(new Date(i.expires_at))}</p>
                </div>
                <p className="break-all text-xs text-gray-600">{origin ? linkFor(i.token) : `${INVITE_PATH}?token=…`}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton path={`${INVITE_PATH}?token=${encodeURIComponent(i.token)}`} label="Copy the link" />
                  {digitsOf(i.phone) && (
                    <a
                      href={`https://wa.me/${digitsOf(i.phone)}?text=${encodeURIComponent(messageFor(i.token))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-brand hover:bg-black/5"
                    >
                      WhatsApp
                    </a>
                  )}
                  {confirming === i.id ? (
                    <>
                      <Button size="sm" variant="danger" disabled={working === i.id} onClick={() => revoke(i.id)}>
                        {working === i.id ? "Revoking…" : "Revoke it"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Leave it</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(i.id)}>Revoke</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
