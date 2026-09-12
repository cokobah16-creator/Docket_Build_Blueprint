"use client";

// Open a matter: the working title, the cause title as it appears on the face of
// the process, the court and suit number, who has conduct of it, and the client —
// either someone already on the firm's books or an invitation sent the moment the
// matter exists.
//
// Rules enforced here: open_matter() and invite_matter_party() run as the signed-in
// staff member (staff_w decides, never this form, and no service key is used); the
// client search reads profiles under RLS, so it can only ever find people this firm
// already deals with; the invitation token comes back from the database and is never
// guessed here; and nothing is firm-specific — the firm, its statuses, its people and
// its courts all arrive as props from the caller's context.

import { useMemo, useState, type FormEvent, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { CourtPicker } from "@/components/firm/court-picker";
import { openMatter, inviteMatterParty, runConflictCheck } from "@/lib/actions/matters";
import { DecideCheck, MatchList } from "@/components/firm/conflict-decision";
import { statusFitsType, type ConflictMatch } from "@/lib/db/types";
import type { StaffMember } from "@/lib/firm-data";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { MATTER_TYPES, type CourtRow, type MatterStatus } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const TYPE_LABELS: Record<string, string> = { ip: "Intellectual property", debt_recovery: "Debt recovery" };
function typeLabel(type: string): string {
  const text = TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Same wording as staffLabel(); reimplemented here because firm-data.ts is server-only. */
function staffName(m: StaffMember): string {
  return m.full_name?.trim() || m.title?.trim() || m.email || "Colleague";
}

interface ClientHit {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

type ClientMode = "none" | "existing" | "invite";

export function NewMatterForm({
  firmId,
  firmName,
  statuses,
  staff,
  courts,
  currentUserId,
  timezone,
  conflictChecksRequired,
}: {
  firmId: string;
  firmName: string;
  statuses: MatterStatus[];
  staff: StaffMember[];
  courts: CourtRow[];
  currentUserId: string;
  /** The viewer's own zone: the database keeps every timestamp in UTC. */
  timezone: string;
  /** firms.conflict_checks_required: open_matter() refuses a client until a check on it is cleared. */
  conflictChecksRequired: boolean;
}) {
  const router = useRouter();

  const defaultStatus = useMemo(
    () => statuses.find((s) => s.key === "new_inquiry")?.key ?? statuses[0]?.key ?? "",
    [statuses],
  );
  const staffIds = useMemo(() => new Set(staff.map((m) => m.user_id)), [staff]);

  // ---- the matter
  const [title, setTitle] = useState("");
  const [causeTitle, setCauseTitle] = useState("");
  const [type, setType] = useState<string>("litigation");
  const [description, setDescription] = useState("");
  const [statusKey, setStatusKey] = useState(defaultStatus);

  // ---- who has conduct
  const [handlingLawyerId, setHandlingLawyerId] = useState(staffIds.has(currentUserId) ? currentUserId : "");
  const [originatingLawyerId, setOriginatingLawyerId] = useState("");

  // ---- the court
  const [courtId, setCourtId] = useState<string | null>(null);
  const [court, setCourt] = useState<CourtRow | null>(null);
  const [suitNumber, setSuitNumber] = useState("");
  const [judicialDivision, setJudicialDivision] = useState("");

  // ---- the client
  const [clientMode, setClientMode] = useState<ClientMode>("none");
  const [clientQuery, setClientQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [client, setClient] = useState<ClientHit | null>(null);
  const [noteToClient, setNoteToClient] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"client" | "contact">("client");

  // ---- the other side, and the conflict check run before the matter exists
  const [otherSide, setOtherSide] = useState("");
  const [extraNames, setExtraNames] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ id: string; matches: ConflictMatch[]; outcome: "clear" | "conflict" | "waived" | null } | null>(null);
  const staffNames = useMemo(() => Object.fromEntries(staff.map((m) => [m.user_id, staffName(m)])), [staff]);

  // ---- submission
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ matterId: string; reference: string } | null>(null);
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function chooseCourt(id: string | null, row: CourtRow | null) {
    setCourtId(id);
    setCourt(row);
    if (row?.division && !judicialDivision.trim()) setJudicialDivision(row.division);
  }

  async function searchClients(e?: SyntheticEvent) {
    e?.preventDefault();
    setSearchError(null);
    setSearched(false);
    const q = clientQuery.replace(/[,()*%]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length < 2) {
      setSearchError("Type at least two letters of a name, a phone number or an email address.");
      return;
    }
    const supabase = supabaseBrowser();
    if (!supabase) {
      setSearchError("Not configured.");
      return;
    }
    setSearching(true);
    const { data, error: searchFailed } = await supabase
      .from("profiles")
      .select("id, full_name, phone, email")
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(10);
    setSearching(false);
    setSearched(true);
    if (searchFailed) {
      setSearchError(searchFailed.message);
      setHits([]);
      return;
    }
    // A member of the firm cannot be its client on a matter — open_matter() refuses it.
    setHits(((data ?? []) as ClientHit[]).filter((p) => !staffIds.has(p.id)));
  }

  /** One line per party: "Name / alias, alias". Recorded on the matter's register as it opens. */
  function adverseParties(): Array<{ name: string; kind: "person" | "organisation"; aliases: string[] }> {
    return otherSide
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 2)
      .slice(0, 20)
      .map((line) => {
        const [namePart, aliasPart] = line.split("/");
        const name = (namePart ?? "").trim();
        const aliases = (aliasPart ?? "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 10);
        const kind: "person" | "organisation" = /\b(ltd|limited|plc|llc|llp|inc|nig(eria)?|company|bank|enterprises?|ventures?|holdings?|&)\b/i.test(name) ? "organisation" : "person";
        return { name, kind, aliases };
      })
      .filter((p) => p.name.length >= 2);
  }

  /** Everyone the form names: the client, the other side and its aliases, and anything typed to check. */
  function namesToCheck(): string[] {
    const names: string[] = [];
    if (clientMode === "existing" && client?.full_name) names.push(client.full_name);
    for (const p of adverseParties()) names.push(p.name, ...p.aliases);
    for (const n of extraNames.split(",")) if (n.trim()) names.push(n.trim());
    return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 20);
  }

  async function runCheck() {
    setCheckError(null);
    const names = namesToCheck();
    if (names.length === 0) {
      setCheckError("Name the client, the other side, or type a name to check.");
      return;
    }
    setChecking(true);
    const r = await runConflictCheck(firmId, { names });
    setChecking(false);
    if ("error" in r) { setCheckError(r.error); return; }
    setCheck({ id: r.checkId, matches: r.matches, outcome: null });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length < 2) {
      setError("Give the matter a working title — the name your firm uses for it.");
      return;
    }
    if (clientMode === "existing" && !client) {
      setError("Choose the client from the search results, or switch to \u201cNot yet\u201d and add them later.");
      return;
    }
    const wantsInvite = clientMode === "invite" && Boolean(invitePhone.trim() || inviteEmail.trim());
    if (clientMode === "invite" && !wantsInvite) {
      setError("Give a phone number or an email address to send the invitation to, or choose not to add a client yet.");
      return;
    }

    const joiningClient = (clientMode === "existing" && Boolean(client)) || (clientMode === "invite" && inviteRole === "client");
    if (conflictChecksRequired && joiningClient && !(check && (check.outcome === "clear" || check.outcome === "waived"))) {
      setError(
        check && check.outcome === "conflict"
          ? "The conflict check found a conflict. Run a new check and clear or waive it before a client is joined, or open the matter without a client."
          : "This firm requires a cleared conflict check before a client is joined. Run the check below and record your decision first, or open the matter without a client.",
      );
      return;
    }

    setBusy(true);
    const result = await openMatter({
      firmId,
      title: title.trim(),
      type,
      clientId: clientMode === "existing" ? client?.id ?? null : null,
      causeTitle: causeTitle.trim() || null,
      description: description.trim() || null,
      courtId,
      suitNumber: suitNumber.trim() || null,
      judicialDivision: judicialDivision.trim() || null,
      originatingLawyerId: originatingLawyerId || null,
      handlingLawyerId: handlingLawyerId || null,
      statusKey: statusKey || null,
      noteToClient: clientMode === "existing" && client ? noteToClient.trim() || null : null,
      conflictCheckId: check?.outcome ? check.id : null,
      adverseParties: adverseParties(),
    });

    if ("error" in result) {
      setBusy(false);
      setError(result.error);
      return;
    }

    if (!wantsInvite) {
      router.push(`/firm/matters/${result.matterId}`);
      router.refresh();
      return;
    }

    const sent = await inviteMatterParty(result.matterId, {
      phone: invitePhone.trim() || undefined,
      email: inviteEmail.trim() || undefined,
      role: inviteRole,
    });
    setBusy(false);
    setOpened({ matterId: result.matterId, reference: result.reference });
    if ("error" in sent) setInviteError(sent.error);
    else setInvite({ token: sent.token, expiresAt: sent.expiresAt });
    router.refresh();
  }

  // ------------------------------------------------------------- after the matter exists
  if (opened) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const link = invite ? `${origin}/app/join?token=${invite.token}` : "";
    const phone = normalizeNigerianPhone(invitePhone.trim());
    const message = `Good day. ${firmName} has opened matter ${opened.reference} — ${title.trim()} — for you. Follow it, read every update and send us documents here: ${link}`;
    const whatsapp = phone && link ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(message)}` : null;
    const mail =
      inviteEmail.trim() && link
        ? `mailto:${encodeURIComponent(inviteEmail.trim())}?subject=${encodeURIComponent(`Your matter ${opened.reference}`)}&body=${encodeURIComponent(message)}`
        : null;

    return (
      <div className="space-y-5">
        <Alert kind="success" title={`Matter ${opened.reference} opened`}>
          {title.trim()} is now on the firm&rsquo;s books.
        </Alert>

        {inviteError && (
          <Alert kind="warning" title="The matter was opened, but the invitation was not sent">
            {inviteError} You can invite the client again from the matter itself.
          </Alert>
        )}

        {invite && (
          <Card>
            <CardHeader title="Send the client their link" />
            <CardBody className="space-y-3">
              <p className="text-sm text-gray-600">
                This link signs the client in to their own app and puts them on this matter. It lasts until{" "}
                {invite.expiresAt
                  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(invite.expiresAt))
                  : "it expires"}
                . Anyone holding it can join the matter, so send it only to the person it is for.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={link}
                  aria-label="Invitation link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
                  >
                    Send on WhatsApp
                  </a>
                )}
                {mail && (
                  <a
                    href={mail}
                    className="flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:bg-black/5"
                  >
                    Send by email
                  </a>
                )}
              </div>
              {!whatsapp && !mail && (
                <p className="text-sm text-gray-600">Copy the link and send it however the client prefers.</p>
              )}
            </CardBody>
          </Card>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/firm/matters/${opened.matterId}`}
            className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
          >
            Open the matter
          </Link>
          <Link
            href="/firm/matters"
            className="flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:bg-black/5"
          >
            Back to matters
          </Link>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- the form
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardHeader title="The matter" />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="title" className="text-sm font-medium text-gray-900">
              Working title <span className="text-red-700">*</span>
            </label>
            <p className="text-xs text-gray-500">What your firm calls this file. The client sees it too.</p>
            <input
              id="title" type="text" required maxLength={200} value={title}
              onChange={(e) => setTitle(e.target.value)} className={field}
            />
          </div>

          <div>
            <label htmlFor="cause_title" className="text-sm font-medium text-gray-900">Cause title</label>
            <p className="text-xs text-gray-500">
              The caption on the face of the process, for example <em>Okonkwo v Eze &amp; 3 Ors</em>. Leave it empty for non-contentious work.
            </p>
            <input
              id="cause_title" type="text" maxLength={300} value={causeTitle}
              onChange={(e) => setCauseTitle(e.target.value)} className={field}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="type" className="text-sm font-medium text-gray-900">
                Type of matter <span className="text-red-700">*</span>
              </label>
              <select id="type" value={type} onChange={(e) => setType(e.target.value)} className={field}>
                {MATTER_TYPES.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="status" className="text-sm font-medium text-gray-900">Status</label>
              {statuses.length === 0 ? (
                <p className={cn(field, "text-gray-600")}>
                  This firm has no matter statuses yet, so the matter opens without one.
                </p>
              ) : (
                <select id="status" value={statusKey} onChange={(e) => setStatusKey(e.target.value)} className={field}>
                  {statuses.filter((s) => statusFitsType(s, type) && !s.is_terminal).map((s) => (
                    <option key={s.id} value={s.key}>{s.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="description" className="text-sm font-medium text-gray-900">What the matter is about</label>
            <p className="text-xs text-gray-500">A short brief for whoever picks the file up. The client can read it.</p>
            <textarea
              id="description" rows={4} maxLength={8000} value={description}
              onChange={(e) => setDescription(e.target.value)} className={field}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Court" />
        <CardBody className="space-y-4">
          <CourtPicker courts={courts} firmId={firmId} value={courtId} onChange={chooseCourt} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="suit_number" className="text-sm font-medium text-gray-900">Suit number</label>
              <p className="text-xs text-gray-500">
                {court?.suit_number_hint
                  ? `Suit numbers at this court read like ${court.suit_number_hint}.`
                  : "As the registry assigned it. Leave it empty until the process is filed."}
              </p>
              <input
                id="suit_number" type="text" maxLength={120} value={suitNumber}
                onChange={(e) => setSuitNumber(e.target.value)}
                placeholder={court?.suit_number_hint ?? ""} className={field}
              />
            </div>
            <div>
              <label htmlFor="judicial_division" className="text-sm font-medium text-gray-900">Judicial division or district</label>
              <p className="text-xs text-gray-500">Filled in from the court you chose; change it if the file sits elsewhere.</p>
              <input
                id="judicial_division" type="text" maxLength={120} value={judicialDivision}
                onChange={(e) => setJudicialDivision(e.target.value)} className={field}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Who is on it" />
        <CardBody className="space-y-4">
          {staff.length === 0 ? (
            <Alert kind="warning">
              No colleagues could be read for this firm, so the matter opens in your own name. Ask an owner to check the firm&rsquo;s members.
            </Alert>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="handling" className="text-sm font-medium text-gray-900">Conduct of the matter</label>
                <p className="text-xs text-gray-500">Becomes the lead lawyer on the file.</p>
                <select id="handling" value={handlingLawyerId} onChange={(e) => setHandlingLawyerId(e.target.value)} className={field}>
                  <option value="">Me</option>
                  {staff.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{staffName(m)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="originating" className="text-sm font-medium text-gray-900">Originating lawyer</label>
                <p className="text-xs text-gray-500">Who brought the client in. Feeds partner attribution.</p>
                <select id="originating" value={originatingLawyerId} onChange={(e) => setOriginatingLawyerId(e.target.value)} className={field}>
                  <option value="">Same as the lawyer with conduct</option>
                  {staff.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{staffName(m)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The client" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {([
              ["none", "Not yet"],
              ["existing", "Someone we already act for"],
              ["invite", "Invite them"],
            ] as Array<[ClientMode, string]>).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setClientMode(mode); setError(null); setCheck(null); }}
                aria-pressed={clientMode === mode}
                className={cn(
                  "flex min-h-[44px] items-center rounded-full border px-4 text-sm",
                  clientMode === mode ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700 hover:border-brand",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {clientMode === "none" && (
            <p className="text-sm text-gray-600">
              The matter opens without a client. Nobody outside the firm can see it until you add one, and you can invite them at any time from the matter.
            </p>
          )}

          {clientMode === "existing" && (
            <div className="space-y-3">
              <div>
                <label htmlFor="client_query" className="text-sm font-medium text-gray-900">Find the client</label>
                <p className="text-xs text-gray-500">
                  Searches the people your firm already deals with, by name, phone number or email address.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="client_query" type="search" inputMode="search" maxLength={80} value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchClients(); } }}
                    className={cn(field, "min-w-0 flex-1")}
                  />
                  <Button type="button" variant="ghost" onClick={() => void searchClients()} disabled={searching} className="mt-1">
                    {searching ? "Searching…" : "Search"}
                  </Button>
                </div>
              </div>

              {searchError && <Alert kind="error">{searchError}</Alert>}

              {client && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{client.full_name ?? "Client"}</p>
                    <p className="text-xs text-gray-600">{[client.phone, client.email].filter(Boolean).join(" · ") || "No contact details on file"}</p>
                  </div>
                  <button type="button" onClick={() => { setClient(null); setCheck(null); }} className="text-sm text-gray-600 underline">Change</button>
                </div>
              )}

              {!client && hits.length > 0 && (
                <ul className="space-y-1">
                  {hits.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => { setClient(p); setHits([]); setCheck(null); }}
                        className="flex min-h-[44px] w-full flex-col justify-center rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-brand"
                      >
                        <span className="text-sm font-medium text-gray-900">{p.full_name ?? "Client"}</span>
                        <span className="text-xs text-gray-500">{[p.phone, p.email].filter(Boolean).join(" · ") || "No contact details on file"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!client && searched && hits.length === 0 && !searchError && (
                <div className="rounded-lg border border-dashed border-gray-300 px-3 py-3">
                  <p className="text-sm text-gray-700">
                    Nobody on your firm&rsquo;s books matches that. Only people who have booked a consultation or are already on a matter here can be found.
                  </p>
                  <button type="button" onClick={() => setClientMode("invite")} className="mt-1 text-sm font-medium text-brand underline">
                    Invite them instead
                  </button>
                </div>
              )}

              {client && (
                <div>
                  <label htmlFor="note_to_client" className="text-sm font-medium text-gray-900">First update for the client</label>
                  <p className="text-xs text-gray-500">
                    Posted to their timeline as the matter opens. Leave it empty to send the standard wording.
                  </p>
                  <textarea
                    id="note_to_client" rows={3} maxLength={4000} value={noteToClient}
                    onChange={(e) => setNoteToClient(e.target.value)} className={field}
                  />
                </div>
              )}
            </div>
          )}

          {clientMode === "invite" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                The invitation is created the moment the matter is opened. You then get a link to send over WhatsApp, SMS or email — nothing is sent automatically.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="invite_phone" className="text-sm font-medium text-gray-900">Phone number</label>
                  <input
                    id="invite_phone" type="tel" inputMode="tel" maxLength={40} value={invitePhone}
                    onChange={(e) => setInvitePhone(e.target.value)} placeholder="0803 000 0000" className={field}
                  />
                </div>
                <div>
                  <label htmlFor="invite_email" className="text-sm font-medium text-gray-900">Email address</label>
                  <input
                    id="invite_email" type="email" inputMode="email" maxLength={200} value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)} className={field}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="invite_role" className="text-sm font-medium text-gray-900">They join as</label>
                <select
                  id="invite_role" value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value === "contact" ? "contact" : "client")}
                  className={field}
                >
                  <option value="client">The client</option>
                  <option value="contact">A contact on the matter</option>
                </select>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The other side, and conflicts" />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="other_side" className="text-sm font-medium text-gray-900">Who is on the other side</label>
            <p className="text-xs text-gray-500">
              One per line, as on the process. Other spellings after a slash, separated by commas:{" "}
              <em>Emeka Eze / E. Eze, Chief Eze</em>. Recorded on the matter; never shown to the client. Changing
              this, or the client, discards a check already run: the database admits only the names it searched.
            </p>
            <textarea id="other_side" rows={3} maxLength={4000} value={otherSide} onChange={(e) => { setOtherSide(e.target.value); setCheck(null); }} className={field} />
          </div>
          <div>
            <label htmlFor="extra_names" className="text-sm font-medium text-gray-900">Also check</label>
            <p className="text-xs text-gray-500">
              Anyone else the check should look for — a director, a spouse, a trading name — separated by commas.
              {clientMode === "invite" ? " The client you are inviting has no name on file yet, so type it here." : ""}
            </p>
            <input id="extra_names" type="text" maxLength={1000} value={extraNames} onChange={(e) => setExtraNames(e.target.value)} className={field} />
          </div>

          {conflictChecksRequired ? (
            <p className="text-sm text-gray-700">
              This firm requires a cleared conflict check before a client is joined to a matter. Run it here and record your
              decision; the matter then opens on the client with the check attached.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              A check searches your firm&rsquo;s own register — its clients, the other sides it has recorded, cause titles — and
              records what it found and what you decided. It is optional for this firm, and it is never decided for you.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="ghost" onClick={() => void runCheck()} disabled={checking}>
              {checking ? "Searching…" : check ? "Run the check again" : "Run the conflict check"}
            </Button>
            {check?.outcome && (
              <span className="text-sm text-emerald-800">
                Recorded as {check.outcome === "clear" ? "clear" : check.outcome === "waived" ? "waived" : "a conflict"}.
              </span>
            )}
          </div>
          {checkError && <Alert kind="error">{checkError}</Alert>}
          {check && (
            <div className="space-y-2">
              <MatchList matches={check.matches} names={staffNames} />
              {!check.outcome && (
                <DecideCheck checkId={check.id} matterId={null} onDone={(outcome) => setCheck((c) => (c ? { ...c, outcome } : c))} />
              )}
              {check.outcome === "conflict" && (
                <Alert kind="warning">
                  A conflict is recorded. {conflictChecksRequired ? "The matter cannot open on a client until a later check clears or waives it." : "The matter can still open; the record stays with it."}
                </Alert>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
          {busy ? "Opening…" : "Open the matter"}
        </Button>
        <Link href="/firm/matters" className="text-sm text-brand underline">Cancel</Link>
      </div>
      <p className="text-xs text-gray-500">
        The reference is minted by the database when the matter opens, so it always follows this firm&rsquo;s own numbering.
      </p>
    </form>
  );
}
