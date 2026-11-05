"use client";

// The network dashboard's working parts: invite a firm, resend or withdraw an invitation, answer an
// invitation your firm verified, manage a connection, answer an approach, and see the joint
// matters and the work other firms have brought. Every rule is the database's; this file chooses
// which box comes first and repeats the database's words.

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import {
  inviteFirm, resendInvitation, revokeInvitation, respondInvitation, setConnectionSettings, setConnectionStatus,
  respondIntroduction, withdrawIntroduction,
} from "@/lib/actions/network";
import { CONNECTION_STATUS_LABEL, INVITATION_STATUS_LABEL, ROLE_LABEL } from "@/lib/network-copy";
import { KIND_LABEL } from "@/lib/collaboration-copy";
import { formatWhen } from "@/lib/time";
import { formatDay } from "@/lib/days";
import type {
  CollaborationInboxRow, ConnectedFirmRow, ConnectionSettings, IntroductionRow, JointMatterRow, NetworkIncomingRow, NetworkInvitationRow,
} from "@/lib/db/types";

const STATUS_TONE: Record<string, "settled" | "waiting" | "wrong" | "quiet" | "informing"> = {
  active: "settled", review: "waiting", suspended: "wrong", ended: "quiet",
  pending: "waiting", verified: "informing", accepted: "settled", declined: "quiet", expired: "quiet", revoked: "quiet",
  sent: "waiting", withdrawn: "quiet",
};

export function NetworkPanels({
  firmId, firmName, verified, canInvite, connected, outgoing, incoming, joint, work, approaches, firmNames, timezone, today,
}: {
  firmId: string;
  firmName: string;
  verified: boolean;
  canInvite: boolean;
  connected: ConnectedFirmRow[];
  outgoing: NetworkInvitationRow[];
  incoming: NetworkIncomingRow[];
  joint: JointMatterRow[];
  work: CollaborationInboxRow[];
  approaches: IntroductionRow[];
  firmNames: Record<string, string>;
  timezone: string;
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [representative, setRepresentative] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ email: string; expiresAt: string } | null>(null);

  async function run(id: string, fn: () => Promise<{ error: string } | undefined>, said: string) {
    setBusy(id); setError(null); setDone(null);
    try {
      const r = await fn();
      if (r?.error) setError({ id, message: r.error });
      else { setDone(said); router.refresh(); }
    } catch {
      setError({ id, message: "Nothing changed — the connection may have dropped. Try again." });
    } finally { setBusy(null); }
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    setBusy("invite"); setInviteError(null); setInvited(null);
    const r = await inviteFirm(firmId, { email, reason, representative });
    setBusy(null);
    if ("error" in r) { setInviteError(r.error); return; }
    setInvited({ email: r.toEmail, expiresAt: r.expiresAt });
    setEmail(""); setReason("");
    router.refresh();
  }

  const live = connected.filter((c) => c.status !== "ended");
  const ended = connected.filter((c) => c.status === "ended");
  const openOutgoing = outgoing.filter((i) => i.status === "pending" || i.status === "verified");
  const closedOutgoing = outgoing.filter((i) => !(i.status === "pending" || i.status === "verified"));
  const toAnswer = approaches.filter((a) => a.to_firm_id === firmId && a.status === "sent");
  const sentByUs = approaches.filter((a) => a.from_firm_id === firmId);
  const liveWork = work.filter((w) => w.accepted_at && (!w.ends_on || w.ends_on >= today));
  const askedOfUs = work.filter((w) => !w.accepted_at);

  return (
    <div className="flex flex-col gap-3.5">
      {done && <Alert kind="success" title="Done">{done}</Alert>}

      {/* ------------------------------------------------------------ invite */}
      <Card>
        <CardHeader title="Connect with a law firm" />
        <CardBody className="space-y-3">
          {!canInvite ? (
            <p className="text-15 text-ink-muted">
              {verified
                ? "Inviting a firm needs the invite firms permission at your firm. Ask an owner or an administrator."
                : "Your firm invites other firms once Docket has verified it."}
            </p>
          ) : (
            <form onSubmit={submitInvite} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="The firm's official email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partners@firm.example" hint="Where the verification code goes. Their authorised representative enters it." />
                <Input label="Your name, as they will read it (optional)" value={representative} onChange={(e) => setRepresentative(e.target.value)} maxLength={120} placeholder="Ngozi Okafor, Partner" />
              </div>
              <Textarea label="Why you are asking to connect" required minLength={10} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="We have a commercial matter with a defendant in your jurisdiction and would like local counsel we can instruct through Docket." hint="Goes in the email, with your firm's name, country, practice areas and your name. No client details here." />
              {inviteError && <Alert kind="error" title="That was refused">{inviteError}</Alert>}
              {invited && (
                <Alert kind="success" title={`Invitation sent to ${invited.email}`}>
                  The email carries a single use code that expires {formatWhen(invited.expiresAt, timezone)}, and a link. You will be told when the code is entered and when their firm answers. Docket sends it; nothing to copy.
                </Alert>
              )}
              <Button type="submit" size="lg" disabled={busy === "invite"} className="w-full sm:w-auto">{busy === "invite" ? "Sending…" : "Send the invitation"}</Button>
            </form>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ incoming */}
      <Card>
        <CardHeader title="Invitations waiting for your firm's answer" action={incoming.length > 0 ? <Badge tone="waiting" icon="clock">{incoming.length}</Badge> : undefined} />
        <CardBody className="space-y-3" >
          <div id="incoming" />
          {incoming.length === 0 ? (
            <EmptyState title="Nothing waiting" hint="When a member of your firm enters the code from another firm's invitation, it appears here for an owner or administrator to accept or decline." />
          ) : incoming.map((i) => (
            <div key={i.id} className="rounded-lg border border-hairline bg-raised p-4">
              <p className="font-medium text-ink">{i.from_firm_name}{i.from_country ? ` · ${i.from_country}` : ""}</p>
              <p className="text-13 text-ink-muted">{i.from_representative ? `${i.from_representative} · ` : ""}code entered {formatWhen(i.verified_at, timezone)} · sent to {i.to_email}</p>
              {i.from_practice_areas?.length > 0 && <p className="mt-1 text-13 text-ink-muted">{i.from_practice_areas.join(", ")}</p>}
              <p className="mt-2 whitespace-pre-wrap text-15 text-ink">{i.reason}</p>
              {error?.id === i.id && <Alert kind="error" title="That was refused" className="mt-2">{error.message}</Alert>}
              {canInvite && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy === i.id} onClick={() => run(i.id, async () => { const r = await respondInvitation(i.id, firmId, true); return "error" in r ? r : undefined; }, `Connected with ${i.from_firm_name}. A connection shares nothing by itself.`)}>Accept and connect</Button>
                  <Button size="sm" variant="ghost" disabled={busy === i.id} onClick={() => { const why = window.prompt("A word to them (optional)") ?? ""; run(i.id, async () => { const r = await respondInvitation(i.id, firmId, false, why); return "error" in r ? r : undefined; }, `Declined ${i.from_firm_name}.`); }}>Decline</Button>
                </div>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ connected */}
      <Card>
        <CardHeader title="Connected firms" action={live.length > 0 ? <Badge>{live.length}</Badge> : undefined} />
        <CardBody className="space-y-3">
          <div id="connected" />
          {live.length === 0 ? (
            <EmptyState title="No firm is connected yet" hint="Invite a firm's official email above, or find one in the directory. A connection is verified both ways before it exists." />
          ) : live.map((c) => (
            <ConnectionCard key={c.connection_id} c={c} firmId={firmId} busy={busy} error={error} run={run} timezone={timezone} canManage={canInvite} />
          ))}
          {ended.length > 0 && (
            <details className="rounded-lg border border-hairline">
              <summary className="min-h-[44px] cursor-pointer px-3 py-2.5 text-15 text-ink">Ended connections ({ended.length})</summary>
              <ul className="divide-y divide-hairline px-3">
                {ended.map((c) => (
                  <li key={c.connection_id} className="py-2 text-15 text-ink-muted">
                    {c.other_firm_name} · ended {c.ended_at ? formatWhen(c.ended_at, timezone) : ""}{c.end_reason ? ` · ${c.end_reason}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ outgoing */}
      <Card>
        <CardHeader title="Invitations you have sent" action={openOutgoing.length > 0 ? <Badge>{openOutgoing.length} open</Badge> : undefined} />
        <CardBody className="space-y-3">
          <div id="outgoing" />
          {outgoing.length === 0 ? (
            <EmptyState title="No invitation sent yet" hint="Each one you send is listed here with where it has got to: waiting for the code, code entered, accepted, declined." />
          ) : (
            <>
              {openOutgoing.map((i) => (
                <div key={i.id} className="rounded-lg border border-hairline bg-raised p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-medium text-ink">{i.to_email}</p>
                      <p className="text-13 text-ink-muted">sent {formatWhen(i.created_at, timezone)}{i.resends > 0 ? ` · resent ${i.resends} of ${i.max_resends}` : ""} · code expires {formatWhen(i.code_expires_at, timezone)}{i.attempts > 0 ? ` · ${i.attempts} wrong ${i.attempts === 1 ? "attempt" : "attempts"}` : ""}</p>
                    </div>
                    <Badge tone={STATUS_TONE[i.status] ?? "quiet"} icon={i.status === "verified" ? "check" : "clock"}>{INVITATION_STATUS_LABEL[i.status] ?? i.status}</Badge>
                  </div>
                  {error?.id === i.id && <Alert kind="error" title="That was refused" className="mt-2">{error.message}</Alert>}
                  {canInvite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {i.status === "pending" && (
                        <Button size="sm" variant="ghost" disabled={busy === i.id || i.resends >= i.max_resends} onClick={() => run(i.id, () => resendInvitation(i.id), `A fresh code went to ${i.to_email}. The earlier code no longer works.`)}>
                          {i.resends >= i.max_resends ? "No resends left" : "Resend with a fresh code"}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busy === i.id} onClick={() => run(i.id, () => revokeInvitation(i.id), `Withdrawn. The code for ${i.to_email} no longer works.`)}>Withdraw</Button>
                    </div>
                  )}
                </div>
              ))}
              {closedOutgoing.length > 0 && (
                <details className="rounded-lg border border-hairline">
                  <summary className="min-h-[44px] cursor-pointer px-3 py-2.5 text-15 text-ink">Answered, expired and withdrawn ({closedOutgoing.length})</summary>
                  <ul className="divide-y divide-hairline px-3">
                    {closedOutgoing.map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-15">
                        <span className="break-all text-ink-muted">{i.to_email}{i.decline_reason ? ` · ${i.decline_reason}` : ""}</span>
                        <Badge tone={STATUS_TONE[i.status] ?? "quiet"} icon="dot">{INVITATION_STATUS_LABEL[i.status] ?? i.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ joint matters */}
      <Card>
        <CardHeader title="Joint matters: your files with another firm on them" action={joint.length > 0 ? <Badge>{joint.length}</Badge> : undefined} />
        <CardBody className="space-y-3">
          <div id="joint" />
          {joint.length === 0 ? (
            <EmptyState title="No joint matter yet" hint="Open a matter, then bring a connected firm onto it from the matter's Working with tab: as lead, supporting, local or foreign counsel, co counsel or a specialist. You choose exactly what they see." />
          ) : (
            <ul className="divide-y divide-hairline">
              {joint.map((j) => (
                <li key={j.matter_id} className="py-2">
                  <Link href={`/firm/matters/${j.matter_id}?tab=working`} className="block min-h-[44px] rounded-lg px-2 py-1.5 hover:bg-hover">
                    <p className="font-medium text-ink">{j.title} <span className="text-13 font-normal text-ink-muted">· {j.reference}{j.suit_number ? ` · ${j.suit_number}` : ""}</span></p>
                    <p className="text-13 text-ink-muted">
                      {j.participants.map((p) => `${p.firm_name}${p.role ? ` (${ROLE_LABEL.get(p.role) ?? p.role})` : ` (${KIND_LABEL.get(p.kind) ?? p.kind})`}`).join(", ")}
                      {j.open_tasks > 0 ? ` · ${j.open_tasks} open ${j.open_tasks === 1 ? "task" : "tasks"}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {(liveWork.length > 0 || askedOfUs.length > 0) && (
            <p className="text-15 text-ink-muted">
              Other firms&rsquo; files you work on: {liveWork.length} live{askedOfUs.length > 0 ? `, ${askedOfUs.length} waiting on your answer` : ""}.{" "}
              <Link href="/firm/collaborations" className="font-medium text-brand underline">Open work from other firms</Link>.
            </p>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------ approaches */}
      <Card>
        <CardHeader title="Introductions and referral requests" action={toAnswer.length > 0 ? <Badge tone="waiting" icon="clock">{toAnswer.length} to answer</Badge> : undefined} />
        <CardBody className="space-y-3">
          <div id="approaches" />
          {approaches.length === 0 ? (
            <EmptyState title="No approach yet" hint="Ask a firm in the directory for an introduction or send a referral request, with no client confidential information. Their answer lands here." />
          ) : (
            <ul className="divide-y divide-hairline">
              {approaches.map((a) => {
                const mine = a.from_firm_id === firmId;
                const other = firmNames[mine ? a.to_firm_id : a.from_firm_id] ?? "A firm";
                return (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{mine ? `To ${other}` : `From ${other}`} <span className="text-13 font-normal text-ink-muted">· {a.kind === "referral_request" ? "referral request" : "introduction"}{a.practice_area ? ` · ${a.practice_area}` : ""}{a.country_code ? ` · ${a.country_code}` : ""}</span></p>
                        <p className="mt-1 whitespace-pre-wrap text-15 text-ink">{a.brief}</p>
                        {a.response && <p className="mt-1 text-15 text-ink-muted">Their answer: {a.response}</p>}
                      </div>
                      <Badge tone={STATUS_TONE[a.status] ?? "quiet"} icon="dot">{a.status}</Badge>
                    </div>
                    {error?.id === a.id && <Alert kind="error" title="That was refused" className="mt-2">{error.message}</Alert>}
                    {canInvite && a.status === "sent" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mine ? (
                          <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => run(a.id, () => withdrawIntroduction(a.id), "Withdrawn.")}>Withdraw</Button>
                        ) : (
                          <>
                            <Button size="sm" disabled={busy === a.id} onClick={() => { const say = window.prompt("A word back to them (optional)") ?? ""; run(a.id, () => respondIntroduction(a.id, true, say), `Accepted. ${other} has been told.`); }}>Accept</Button>
                            <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => { const say = window.prompt("A word back to them (optional)") ?? ""; run(a.id, () => respondIntroduction(a.id, false, say), `Declined. ${other} has been told.`); }}>Decline</Button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {sentByUs.length === 0 && <p className="text-13 text-ink-muted"><Link href="/firm/network/discover" className="font-medium text-brand underline">Find a firm to approach</Link>.</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function ConnectionCard({
  c, firmId, busy, error, run, timezone, canManage,
}: {
  c: ConnectedFirmRow;
  firmId: string;
  busy: string | null;
  error: { id: string; message: string } | null;
  run: (id: string, fn: () => Promise<{ error: string } | undefined>, said: string) => Promise<void>;
  timezone: string;
  canManage: boolean;
}) {
  const [settings, setSettings] = useState<ConnectionSettings>(c.my_settings);
  const id = c.connection_id;
  const suspendedByUs = c.status === "suspended" && c.suspended_by_firm_id === firmId;
  const changed = JSON.stringify(settings) !== JSON.stringify(c.my_settings);
  return (
    <div className="rounded-lg border border-hairline bg-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">{c.other_firm_name}{c.other_legal_name && c.other_legal_name !== c.other_firm_name ? ` (${c.other_legal_name})` : ""}</p>
          <p className="text-13 text-ink-muted">
            {[c.city, c.region, c.country_code ?? c.other_jurisdiction_code].filter(Boolean).join(", ")} · connected {formatWhen(c.connected_at, timezone)}
          </p>
          {c.practice_areas && c.practice_areas.length > 0 && <p className="text-13 text-ink-muted">{c.practice_areas.join(", ")}{c.languages?.length ? ` · ${c.languages.join(", ")}` : ""}</p>}
        </div>
        <Badge tone={STATUS_TONE[c.status] ?? "quiet"} icon={c.status === "active" ? "check" : c.status === "suspended" ? "alert" : "clock"}>{CONNECTION_STATUS_LABEL[c.status] ?? c.status}</Badge>
      </div>
      {c.status === "review" && <p className="mt-2 text-15 text-ink-muted">The invited address matched nothing this firm has told Docket about itself, so Docket is checking it. Nothing can start until it is settled.</p>}
      {c.status === "suspended" && <p className="mt-2 text-15 text-ink-muted">Suspended {c.suspended_at ? formatWhen(c.suspended_at, timezone) : ""} by {suspendedByUs ? "your firm" : c.other_firm_name}{c.suspend_reason ? `: ${c.suspend_reason}` : ""}. No new work can start; what is already shared stays as it is.</p>}
      {(c.official_email || c.telephone || c.office_address || (c.contacts && c.contacts.length > 0)) ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-15 sm:grid-cols-2">
          {c.official_email && <div><dt className="text-13 text-ink-muted">Email</dt><dd className="break-all text-ink">{c.official_email}</dd></div>}
          {c.telephone && <div><dt className="text-13 text-ink-muted">Telephone</dt><dd className="text-ink">{c.telephone}</dd></div>}
          {c.office_address && <div className="sm:col-span-2"><dt className="text-13 text-ink-muted">Office</dt><dd className="text-ink">{c.office_address}</dd></div>}
          {c.contacts && c.contacts.length > 0 && (
            <div className="sm:col-span-2"><dt className="text-13 text-ink-muted">Authorised contacts</dt><dd className="text-ink">{c.contacts.map((p) => `${p.name} (${p.title})${p.email ? ` ${p.email}` : ""}`).join(" · ")}</dd></div>
          )}
        </dl>
      ) : (
        <p className="mt-2 text-13 text-ink-muted">This firm keeps its contact details to itself on this connection.</p>
      )}
      {error?.id === id && <Alert kind="error" title="That was refused" className="mt-2">{error.message}</Alert>}
      {canManage && c.status !== "review" && (
        <details className="mt-3 rounded-lg border border-hairline bg-sunken">
          <summary className="min-h-[44px] cursor-pointer px-3 py-2.5 text-15 font-medium text-ink">What your firm allows {c.other_firm_name}</summary>
          <div className="space-y-2 border-t border-hairline p-3">
            {([
              ["share_contacts", "See your official email, telephone, address and owners"],
              ["allow_joint_matters", "Be brought onto your matters, and bring you onto theirs"],
              ["allow_referrals", "Send you referral requests"],
              ["allow_introductions", "Ask you for introductions"],
            ] as Array<[keyof ConnectionSettings, string]>).map(([key, label]) => (
              <label key={key} className="flex min-h-[44px] items-center gap-2 text-15 text-ink">
                <input type="checkbox" className="h-5 w-5" checked={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.currentTarget.checked })} />
                {label}
              </label>
            ))}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="ghost" disabled={busy === id || !changed} onClick={() => run(id, () => setConnectionSettings(id, firmId, settings), `Saved what ${c.other_firm_name} may do.`)}>Save</Button>
              {c.status === "active" && (
                <Button size="sm" variant="ghost" disabled={busy === id} onClick={() => { const why = window.prompt("Why? They will read it.") ?? ""; run(id, () => setConnectionStatus(id, firmId, "suspended", why), `Suspended. ${c.other_firm_name} has been told; no new work can start until you lift it.`); }}>Suspend</Button>
              )}
              {suspendedByUs && (
                <Button size="sm" variant="ghost" disabled={busy === id} onClick={() => run(id, () => setConnectionStatus(id, firmId, "active"), `Lifted. ${c.other_firm_name} has been told.`)}>Lift the suspension</Button>
              )}
              <Button size="sm" variant="danger" disabled={busy === id} onClick={() => { if (!window.confirm(`End the connection with ${c.other_firm_name}? Every live arrangement between the firms ends at once. Nothing already downloaded is recalled.`)) return; const why = window.prompt("Why? They will read it.") ?? ""; run(id, () => setConnectionStatus(id, firmId, "ended", why), `Ended. Every live arrangement with ${c.other_firm_name} ended with it.`); }}>End the connection</Button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
