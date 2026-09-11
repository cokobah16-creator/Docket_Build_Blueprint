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
import { AppButton, appButtonClass } from "@/components/app/button";
import { CopyButton } from "./matter-tabs";
import { isE164, normalizeNigerianPhone } from "@/lib/nigeria";

/**
 * Where an invited client lands. accept_invite(token) joins them to the matter
 * once they have signed in; the console only ever hands over the link.
 */
const INVITE_PATH = "/app/join";

const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
const sectionHeading = "font-app-head text-[15.5px] font-semibold text-dk-strong";

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

/**
 * wa.me wants a country code and no leading zero, so the number must already be
 * E.164 before its digits are taken. A local "0803…" stripped to digits gives
 * WhatsApp "number shared via url is invalid" and the client never gets the link.
 */
function digitsOf(phone: string | null): string | null {
  if (!phone || !isE164(phone)) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

/** The number the database will have stored, so the hand-off matches the invite. */
function asStored(typed: string): string | null {
  const trimmed = typed.trim();
  if (!trimmed) return null;
  return normalizeNigerianPhone(trimmed) ?? (isE164(trimmed) ? trimmed : null);
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
    setInvited({ token: result.token, expiresAt: result.expiresAt, phone: asStored(phone) });
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
    const result = await revokeMatterInvite(inviteId, matterId);
    setWorking(null);
    setConfirming(null);
    if (result?.error) { setError(result.error); return; }
    router.refresh();
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div className="divide-y divide-dk-rule">
      {error && <div className="px-[15px] py-[15px]"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <section className="px-[15px] py-[15px]">
        <h3 className={sectionHeading}>On this matter</h3>
        {parties.length === 0 ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-dk-soft">
            Nobody on the client side yet. Invite your client below — they then see the timeline, the documents you share and their invoices in their app.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-dk-rule">
            {parties.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{p.full_name ?? "Client"}</p>
                  <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                    {ROLE_LABELS[p.role] ?? p.role.replace(/_/g, " ")}
                    {p.phone ? ` · ${p.phone}` : ""}
                    {p.email ? ` · ${p.email}` : ""}
                  </p>
                  <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-muted">
                    {p.can_view_docs ? "Can read shared documents" : "No document access"} · {p.can_pay ? "Can pay invoices" : "Cannot pay invoices"}
                  </p>
                </div>
                {confirming === p.user_id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[11.5px] leading-snug text-dk-soft">They lose this matter in their app at once.</span>
                    {/* Taking somebody off a matter is not undoable from here, so the
                        one destructive control on the panel keeps its own red — with
                        the word "Remove" on it. */}
                    <AppButton
                      variant="ghost-sm"
                      className="border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]"
                      disabled={working === p.user_id}
                      onClick={() => remove(p.user_id)}
                    >
                      {working === p.user_id ? "Removing…" : "Remove"}
                    </AppButton>
                    <AppButton variant="ghost-sm" onClick={() => setConfirming(null)}>Keep</AppButton>
                  </span>
                ) : (
                  <AppButton variant="ghost-sm" onClick={() => setConfirming(p.user_id)}>Take off the matter</AppButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-[15px] py-[15px]">
        <h3 className={sectionHeading}>Invite your client</h3>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-dk-soft">
          A phone number, an email address, or both. Send them the link over WhatsApp or SMS — it expires in fourteen days.
          They sign in with the number or email you invited here, and the matter then appears in their app.
        </p>
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="invite-phone" className={labelClass}>Phone</label>
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
              <label htmlFor="invite-email" className={labelClass}>Email</label>
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
            <label htmlFor="invite-role" className={labelClass}>They join as</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value === "contact" ? "contact" : "client")} className={field}>
              <option value="client">Client — the matter is theirs</option>
              <option value="contact">Contact — follows the matter with the client&rsquo;s knowledge</option>
            </select>
          </div>
          <AppButton type="submit" variant="primary-sm" disabled={busy}>
            {busy ? "Creating the invitation…" : "Create the invitation"}
          </AppButton>
        </form>

        {invited && (
          <div className="mt-3.5 rounded-[10px] border border-dk-line bg-dk-tint p-3.5">
            <p className="text-[13px] font-semibold text-dk-strong">Invitation ready — send it now.</p>
            <p className="mt-1 break-all font-mono text-[11.5px] leading-[1.5] text-dk-body">{linkFor(invited.token)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <CopyButton path={`${INVITE_PATH}?token=${encodeURIComponent(invited.token)}`} label="Copy the link" />
              {digitsOf(invited.phone) && (
                <>
                  <a
                    href={`https://wa.me/${digitsOf(invited.phone)}?text=${encodeURIComponent(messageFor(invited.token))}`}
                    target="_blank"
                    rel="noreferrer"
                    className={appButtonClass("primary-sm")}
                  >
                    Send on WhatsApp
                  </a>
                  <a
                    href={`sms:${invited.phone ?? ""}?&body=${encodeURIComponent(messageFor(invited.token))}`}
                    className={appButtonClass("ghost-sm")}
                  >
                    Send by SMS
                  </a>
                </>
              )}
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-dk-muted">
              Expires {invited.expiresAt ? fmt.format(new Date(invited.expiresAt)) : "in fourteen days"}.
            </p>
          </div>
        )}
      </section>

      <section className="px-[15px] py-[15px]">
        <h3 className={sectionHeading}>Invitations waiting</h3>
        {invites.length === 0 ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-dk-soft">
            No invitation is outstanding. Everyone invited to this matter has either accepted or been revoked.
          </p>
        ) : (
          <ul className="mt-2.5 divide-y divide-dk-rule">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-dk-strong">
                    {i.phone ?? i.email ?? "Invitation"}
                    <span className="ml-2 text-[11px] font-medium uppercase tracking-[0.04em] text-dk-muted">
                      {ROLE_LABELS[i.role] ?? i.role}
                    </span>
                  </p>
                  <p className="text-[11.5px] text-dk-muted">Expires {fmt.format(new Date(i.expires_at))}</p>
                </div>
                <p className="break-all font-mono text-[11.5px] leading-[1.5] text-dk-soft">
                  {origin ? linkFor(i.token) : `${INVITE_PATH}?token=…`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton path={`${INVITE_PATH}?token=${encodeURIComponent(i.token)}`} label="Copy the link" />
                  {digitsOf(i.phone) && (
                    <a
                      href={`https://wa.me/${digitsOf(i.phone)}?text=${encodeURIComponent(messageFor(i.token))}`}
                      target="_blank"
                      rel="noreferrer"
                      className={appButtonClass("ghost-sm")}
                    >
                      WhatsApp
                    </a>
                  )}
                  {confirming === i.id ? (
                    <>
                      {/* Revoking kills a live link; it keeps its own red and its word. */}
                      <AppButton
                        variant="ghost-sm"
                        className="border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]"
                        disabled={working === i.id}
                        onClick={() => revoke(i.id)}
                      >
                        {working === i.id ? "Revoking…" : "Revoke it"}
                      </AppButton>
                      <AppButton variant="ghost-sm" onClick={() => setConfirming(null)}>Leave it</AppButton>
                    </>
                  ) : (
                    <AppButton variant="ghost-sm" onClick={() => setConfirming(i.id)}>Revoke</AppButton>
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
