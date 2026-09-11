// One client: who they are, every consultation they have booked with this firm,
// every matter they are a party to, every invoice raised against them with the
// link to send them to pay, and the consents they have given this firm.
//
// Rules enforced here: the database is the authorization layer — the profile is
// readable only because can_see_profile() lets a firm member see its own clients,
// and a person who is neither a party on one of this firm's matters nor a client
// on one of its appointments is a 404 here, not a lookup tool; a client's profile
// is theirs (profiles_update is id = auth.uid()), so this screen states that
// plainly instead of rendering a form the database would refuse; timestamps are
// UTC in the database and rendered in ctx.timezone, while date columns are
// calendar days and rendered as the day they are; money is integer minor units
// through formatMoneyMinor; nothing is firm-specific — the firm comes from
// context; and a client with no email is flagged wherever a receipt depends on it.

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { matterStatuses, requestedFirmId, staffContext } from "@/lib/firm-data";
import { siteOrigin } from "@/lib/site";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { type Status } from "@/components/ui/badge";
import {
  AppAccentPill,
  AppButtonLink,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  AppPill,
  AppStatusPill,
  Footnote,
} from "@/components/app";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export const metadata = { title: "Client" };

const OWING_STATUSES = new Set(["issued", "partially_paid", "overdue"]);
const SEEN_STATUSES = new Set(["confirmed", "rescheduled", "completed"]);
const LIVE_STATUSES = new Set(["pending", "awaiting_payment", "confirmed", "rescheduled"]);

const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In the app",
  push: "Push notification",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

const CONSENT_LABELS: Record<string, string> = {
  terms: "Terms of use",
  privacy: "Privacy notice",
  engagement: "Engagement terms",
  recording: "Recording of consultations",
  marketing: "Marketing messages",
};

const PARTY_ROLE_LABELS: Record<string, string> = {
  client: "Client",
  contact: "Contact",
  co_counsel: "Co-counsel",
};

interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  country: string | null;
  state: string | null;
  address: string | null;
  client_type: string | null;
  company_name: string | null;
  timezone: string;
  preferred_channel: string;
  created_at: string;
}

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  ends_at: string;
  status: string;
  mode: string;
  service_id: string | null;
  cancellation_reason: string | null;
}

interface PartyRow {
  matter_id: string;
  role: string;
  can_view_docs: boolean;
  can_pay: boolean;
}

interface MatterRowLite {
  id: string;
  reference: string;
  title: string;
  cause_title: string | null;
  status_id: string | null;
  court_name: string | null;
  suit_number: string | null;
  next_event_at: string | null;
  next_event_note: string | null;
  opened_at: string;
  closed_at: string | null;
}

interface InvoiceRowLite {
  id: string;
  number: string;
  matter_id: string | null;
  appointment_id: string | null;
  currency: string;
  total_minor: number;
  paid_minor: number;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  created_at: string;
}

interface ConsentRow {
  id: string;
  kind: string;
  version: string;
  accepted_at: string;
}

/** A date column is a calendar day, not an instant: render it as the day it is. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

function moneyLabel(byCurrency: Map<string, number>): string {
  return Array.from(byCurrency.entries())
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoneyMinor(minor, currency))
    .join(" · ");
}

/** The label/value pair the profile card is made of. */
function ProfileRowItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.06em] text-dk-muted">{label}</p>
      <p className="mt-0.5 text-[13.5px] font-semibold leading-[1.4] text-dk-strong">{children}</p>
    </div>
  );
}

export default async function FirmClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ firm?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const backHref = sp.firm ? `/firm/clients?firm=${sp.firm}` : "/firm/clients";

  const [{ data: profileRow }, { data: apptRows }, { data: partyRows }, { data: invoiceRows }, { data: consentRows }, statuses, origin] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, phone, email, country, state, address, client_type, company_name, timezone, preferred_channel, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("appointments")
        .select("id, reference, starts_at, ends_at, status, mode, service_id, cancellation_reason")
        .eq("firm_id", firmId)
        .eq("client_id", id)
        .order("starts_at", { ascending: false })
        .limit(100),
      supabase
        .from("matter_parties")
        .select("matter_id, role, can_view_docs, can_pay")
        .eq("firm_id", firmId)
        .eq("user_id", id)
        .limit(200),
      supabase
        .from("invoices")
        .select("id, number, matter_id, appointment_id, currency, total_minor, paid_minor, status, issued_at, due_at, created_at")
        .eq("firm_id", firmId)
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("consent_records")
        .select("id, kind, version, accepted_at")
        .eq("user_id", id)
        .eq("firm_id", firmId)
        .order("accepted_at", { ascending: false })
        .limit(50),
      matterStatuses(supabase, firmId),
      siteOrigin(),
    ]);

  const appointments = (apptRows ?? []) as AppointmentRow[];
  const parties = (partyRows ?? []) as PartyRow[];

  // Not a client of this firm — this screen is not a directory of everyone on Docket.
  if (appointments.length === 0 && parties.length === 0) notFound();

  const profile = (profileRow ?? null) as ProfileRow | null;
  const invoices = (invoiceRows ?? []) as InvoiceRowLite[];
  const consents = (consentRows ?? []) as ConsentRow[];

  const matterIds = parties.map((p) => p.matter_id);
  const serviceIds = Array.from(new Set(appointments.map((a) => a.service_id).filter((s): s is string => Boolean(s))));

  const [{ data: matterRows }, { data: serviceRows }, { data: lastUpdateRow }] = await Promise.all([
    matterIds.length
      ? supabase
          .from("matters")
          .select("id, reference, title, cause_title, status_id, court_name, suit_number, next_event_at, next_event_note, opened_at, closed_at")
          .in("id", matterIds)
          .is("deleted_at", null)
          .order("opened_at", { ascending: false })
      : Promise.resolve({ data: [] as MatterRowLite[] }),
    serviceIds.length
      ? supabase.from("services").select("id, name").in("id", serviceIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    // The last time anything was posted on one of their files. Internal entries
    // count towards the date — none of their content is rendered here.
    matterIds.length
      ? supabase
          .from("updates")
          .select("occurred_at")
          .in("matter_id", matterIds)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const matters = (matterRows ?? []) as MatterRowLite[];
  const services = new Map(((serviceRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const roleByMatter = new Map(parties.map((p) => [p.matter_id, p]));

  const name = profile?.full_name?.trim() || profile?.company_name?.trim() || "This client";
  const nowMs = Date.now();

  const outstanding = new Map<string, number>();
  const billed = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === "cancelled" || inv.status === "draft") continue;
    billed.set(inv.currency, (billed.get(inv.currency) ?? 0) + Number(inv.total_minor));
    paid.set(inv.currency, (paid.get(inv.currency) ?? 0) + Number(inv.paid_minor));
    if (!OWING_STATUSES.has(inv.status)) continue;
    const due = Number(inv.total_minor) - Number(inv.paid_minor);
    if (due > 0) outstanding.set(inv.currency, (outstanding.get(inv.currency) ?? 0) + due);
  }
  const owedLabel = moneyLabel(outstanding);

  const seenAppointments = appointments
    .filter((a) => new Date(a.starts_at).getTime() <= nowMs && SEEN_STATUSES.has(a.status))
    .map((a) => a.starts_at);
  const lastConsultation = seenAppointments.length ? seenAppointments.reduce((a, b) => (a > b ? a : b)) : null;
  const lastPosted = (lastUpdateRow as { occurred_at: string } | null)?.occurred_at ?? null;
  const lastSeen =
    lastConsultation && lastPosted
      ? lastConsultation > lastPosted
        ? lastConsultation
        : lastPosted
      : (lastConsultation ?? lastPosted);
  const nextAppointment = appointments
    .filter((a) => new Date(a.starts_at).getTime() > nowMs && LIVE_STATUSES.has(a.status))
    .map((a) => a.starts_at)
    .sort()[0] ?? null;

  const openMatters = matters.filter((m) => !m.closed_at).length;
  const hasEmail = Boolean(profile?.email);
  const channel = profile?.preferred_channel ?? "sms";
  const channelUnreachable = channel === "email" && !hasEmail;
  const addressLine = [profile?.address, profile?.state, profile?.country]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(", ");

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      {/* The whole row is the target: 44px tall and as wide as its words. */}
      <Link
        href={backHref}
        className="-ml-1 inline-flex min-h-[44px] w-fit items-center gap-1 pr-2 text-[13px] font-medium text-dk-pri"
      >
        <ChevronLeftIcon size={17} className="flex-none" />
        Clients
      </Link>

      <header>
        <h1 className="font-app-head text-[20px] font-bold leading-[1.25] tracking-[-0.02em] text-dk-strong">
          {name}
          {profile?.client_type === "business" && (
            <span className="ml-2 inline-flex align-middle rounded-[4px] bg-dk-rule px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.03em] text-dk-soft">
              business
            </span>
          )}
        </h1>
        <p className="mt-1 text-[12.5px] leading-snug text-dk-soft">
          {ctx.firmName} · {matters.length} {matters.length === 1 ? "matter" : "matters"}
          {openMatters > 0 ? ` (${openMatters} open)` : ""} ·{" "}
          {appointments.length} {appointments.length === 1 ? "consultation" : "consultations"} · times in {tz}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-dk-soft">
          {lastSeen
            ? `Last seen ${formatWhen(lastSeen, tz, { dateStyle: "full", timeStyle: "short" })}`
            : "Not seen yet — no consultation has taken place and nothing has been posted on their matters."}
          {nextAppointment ? ` · next ${formatWhen(nextAppointment, tz, { dateStyle: "medium", timeStyle: "short" })}` : ""}
        </p>
      </header>

      {/* Money owed is the figure a lawyer opens this screen to check, so it is
          set at heading size and carries the console's amber and the word
          "outstanding" together. Each currency stands on its own line of the
          label — kobo is never added to cents. */}
      {owedLabel && (
        <section className="flex items-center justify-between gap-3 rounded-[11px] border border-dk-line bg-white px-[15px] py-3.5 shadow-card">
          <div className="min-w-0">
            <p className="text-[10.5px] uppercase tracking-[0.06em] text-dk-soft">Outstanding</p>
            <p className="mt-1 font-app-head text-[24px] font-bold leading-none text-[#92400E]">{owedLabel}</p>
            <p className="mt-1.5 text-[11px] leading-[1.35] text-dk-soft">
              On invoices that are issued, part-paid or overdue
            </p>
          </div>
          <AppButtonLink href="/firm/invoices" variant="ghost-sm">
            Invoices
          </AppButtonLink>
        </section>
      )}

      {!profile && (
        <Alert kind="warning" title="Profile not readable">
          This person is on your firm&rsquo;s books, but their profile row could not be read with your access, so their
          name and contact details are not shown. Everything below is read from your own firm&rsquo;s records.
        </Alert>
      )}

      {profile && !hasEmail && (
        <Alert kind="warning" title="No email address on file">
          Receipts and invoice copies are emailed, so nothing can be sent to {name} by email until they add an address.
          Only they can add it — send the payment link below by{" "}
          {channelUnreachable ? "SMS or WhatsApp" : CHANNEL_LABELS[channel] ?? channel} instead.
        </Alert>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="flex flex-col gap-3.5 lg:col-span-2">
          <AppCard>
            <AppCardHeader
              title={`Consultations (${appointments.length})`}
              action={<AppLink href="/firm/appointments">All</AppLink>}
            />
            {appointments.length === 0 ? (
              <AppEmpty
                title="No consultation booked"
                hint="This person came to the firm through a matter, not a booking. They can book a consultation on your public site, or you can add a court date and updates to their matter."
                action={<AppLink href="/firm/appointments">Go to consultations</AppLink>}
              />
            ) : (
              <AppCardList>
                {appointments.map((a) => (
                  <Link key={a.id} href={`/firm/appointments/${a.id}`} className="block px-[15px] py-[13px]">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                          {formatWhen(a.starts_at, tz, { dateStyle: "medium", timeStyle: "short" })}
                          {" · "}
                          {a.service_id ? services.get(a.service_id) ?? "Consultation" : "Consultation"}
                        </p>
                        <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                          <span className="font-mono">{a.reference}</span> · {a.mode.replace("_", " ")} ·{" "}
                          {Math.max(1, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000))} min
                        </p>
                      </div>
                      <AppStatusPill status={a.status as Status} />
                    </div>
                    {a.cancellation_reason && (
                      <p className="mt-1 text-[11.5px] leading-[1.45] text-dk-soft">Cancelled: {a.cancellation_reason}</p>
                    )}
                  </Link>
                ))}
              </AppCardList>
            )}
          </AppCard>

          <AppCard>
            <AppCardHeader
              title={`Matters (${matters.length})`}
              action={<AppLink href="/firm/matters/new">Open a matter</AppLink>}
            />
            {matters.length === 0 ? (
              <AppEmpty
                title="Not on a matter yet"
                hint={
                  parties.length > 0
                    ? "They were added to a matter that has since been deleted. Open a new one to bring them back onto a file."
                    : "Open a matter for them, then invite them from the matter so they can follow it in their app."
                }
                action={
                  <AppButtonLink href="/firm/matters/new" variant="primary-sm">
                    Open a matter
                  </AppButtonLink>
                }
              />
            ) : (
              <AppCardList>
                {matters.map((m) => {
                  const status = m.status_id ? statusById.get(m.status_id) ?? null : null;
                  const party = roleByMatter.get(m.id);
                  const causeDiffers = Boolean(m.cause_title && m.cause_title.trim() !== m.title.trim());
                  const nextDatePassed = Boolean(m.next_event_at && new Date(m.next_event_at).getTime() < nowMs);
                  return (
                    <Link key={m.id} href={`/firm/matters/${m.id}`} className="block px-[15px] py-[13px]">
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{m.title}</p>
                          {causeDiffers && (
                            <p className="mt-[3px] text-[11.5px] italic leading-[1.45] text-dk-soft">{m.cause_title}</p>
                          )}
                        </div>
                        {/* The firm names and colours its own statuses; the console
                            shows the name only, in its own grey, because no console
                            token reads a firm token. */}
                        <div className="flex flex-none flex-wrap items-center gap-1.5">
                          {status && <AppAccentPill>{status.label}</AppAccentPill>}
                          {m.closed_at && <AppPill kind="completed">Closed</AppPill>}
                        </div>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-[1.45] text-dk-soft">
                        <span className="font-mono">{m.reference}</span>
                        {party ? ` · ${PARTY_ROLE_LABELS[party.role] ?? party.role} on this file` : ""}
                        {party && !party.can_view_docs ? " · cannot see documents" : ""}
                        {party && !party.can_pay ? " · cannot pay" : ""}
                        {` · opened ${dayLabel(m.opened_at)}`}
                      </p>
                      {(m.court_name || m.suit_number) && (
                        <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                          {m.court_name ?? "Court not recorded"}
                          {m.suit_number ? " · " : ""}
                          {m.suit_number ? <span className="font-mono">{m.suit_number}</span> : null}
                        </p>
                      )}
                      {m.next_event_at && (
                        <p
                          className={cn(
                            "mt-1 text-[11.5px] leading-[1.45]",
                            nextDatePassed ? "font-semibold text-[#92400E]" : "text-dk-body",
                          )}
                        >
                          {nextDatePassed ? "Court date has passed: " : "Next court date: "}
                          <strong>{formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}</strong>
                          {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </AppCardList>
            )}
          </AppCard>

          <AppCard>
            <AppCardHeader
              title={`Invoices (${invoices.length})`}
              action={<AppLink href="/firm/invoices">All</AppLink>}
            />
            {invoices.length === 0 ? (
              <AppEmpty
                title="Nothing billed yet"
                hint="Raise an invoice against this client from Invoices — consultation fees raised at booking appear here automatically."
                action={<AppLink href="/firm/invoices">Go to invoices</AppLink>}
              />
            ) : (
              <>
                <AppCardList>
                  {invoices.map((inv) => {
                    const due = Number(inv.total_minor) - Number(inv.paid_minor);
                    const payable = inv.status !== "draft" && inv.status !== "cancelled";
                    const owing = due > 0 && OWING_STATUSES.has(inv.status);
                    const link = `${origin}/app/payments/${inv.id}`;
                    return (
                      <div key={inv.id} className="px-[15px] py-[13px]">
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                              <span className="font-mono">{inv.number}</span>
                            </p>
                            <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                              {inv.issued_at ? `Issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium" })}` : "Not issued"}
                              {inv.due_at ? ` · due ${dayLabel(inv.due_at)}` : ""}
                              {Number(inv.paid_minor) > 0 ? ` · paid ${formatMoneyMinor(Number(inv.paid_minor), inv.currency)}` : ""}
                            </p>
                            {inv.matter_id && (
                              <p className="mt-[3px] text-[11.5px] leading-[1.45]">
                                <Link href={`/firm/matters/${inv.matter_id}`} className="text-dk-pri underline underline-offset-2">
                                  On this client&rsquo;s matter
                                </Link>
                              </p>
                            )}
                          </div>
                          {/* The amount, then what is left on it. Colour only
                              where money is still owed, and the word says so. */}
                          <div className="flex flex-none flex-col items-end gap-1.5">
                            <p className="font-app-head text-[16px] font-bold leading-none text-dk-strong">
                              {formatMoneyMinor(Number(inv.total_minor), inv.currency)}
                            </p>
                            {owing && (
                              <p className="text-[11.5px] font-semibold leading-none text-[#92400E]">
                                {formatMoneyMinor(due, inv.currency)} outstanding
                              </p>
                            )}
                            <AppStatusPill status={inv.status as Status} />
                          </div>
                        </div>

                        {payable ? (
                          <p className="mt-2 break-all text-[11.5px] leading-[1.45] text-dk-soft">
                            {due > 0 ? "Payment link to send them: " : "Receipt link: "}
                            <Link href={`/app/payments/${inv.id}`} className="text-dk-pri underline underline-offset-2">{link}</Link>
                          </p>
                        ) : inv.status === "draft" ? (
                          <p className="mt-2 text-[11.5px] leading-[1.45] text-dk-muted">
                            A draft is invisible to the client — the database refuses them a draft invoice. Issue it from
                            Invoices and the payment link appears here.
                          </p>
                        ) : (
                          <p className="mt-2 text-[11.5px] leading-[1.45] text-dk-muted">Cancelled — nothing to collect.</p>
                        )}
                      </div>
                    );
                  })}
                </AppCardList>
                <div className="border-t border-dk-rule px-[17px] py-[13px]">
                  <Footnote>
                    {billed.size > 0 && (
                      <>
                        Billed {moneyLabel(billed)} in all, {moneyLabel(paid) || formatMoneyMinor(0, invoices[0].currency)} received.{" "}
                      </>
                    )}
                    {hasEmail
                      ? "A receipt goes to the client's email address as soon as a payment succeeds."
                      : "No email address on file, so no receipt can be emailed. Send the link above by their preferred channel."}
                  </Footnote>
                </div>
              </>
            )}
          </AppCard>
        </div>

        <div className="flex flex-col gap-3.5">
          <AppCard>
            <AppCardHeader title="Profile" />
            <AppCardBody>
              <div className="flex flex-col gap-3">
                <ProfileRowItem label="Name">{profile?.full_name ?? "—"}</ProfileRowItem>
                <ProfileRowItem label="Phone">
                  {profile?.phone ? (
                    <a href={`tel:${profile.phone}`} className="text-dk-pri underline underline-offset-2">{profile.phone}</a>
                  ) : (
                    "—"
                  )}
                </ProfileRowItem>
                <ProfileRowItem label="Email">
                  {profile?.email ? (
                    <a href={`mailto:${profile.email}`} className="break-all text-dk-pri underline underline-offset-2">
                      {profile.email}
                    </a>
                  ) : (
                    /* No email is the console's amber: a receipt cannot be sent. */
                    <span className="text-[#92400E]">None on file — receipts need one</span>
                  )}
                </ProfileRowItem>
                <ProfileRowItem label="Client type">
                  {profile?.client_type === "business" ? "Business" : profile?.client_type === "individual" ? "Individual" : "—"}
                </ProfileRowItem>
                <ProfileRowItem label="Company">{profile?.company_name ?? "—"}</ProfileRowItem>
                <ProfileRowItem label="Their time zone">
                  {profile?.timezone ?? "—"}
                  {profile && profile.timezone !== tz ? " (yours is " + tz + ")" : ""}
                </ProfileRowItem>
                <ProfileRowItem label="Preferred channel">
                  {CHANNEL_LABELS[channel] ?? channel}
                  {channelUnreachable && <span className="text-[#92400E]"> — but there is no email address on file</span>}
                </ProfileRowItem>
                {addressLine && (
                  <ProfileRowItem label="Address">
                    <span className="whitespace-pre-wrap">{addressLine}</span>
                  </ProfileRowItem>
                )}
                {profile && (
                  <ProfileRowItem label="On Docket since">
                    {formatWhen(profile.created_at, tz, { dateStyle: "medium" })}
                  </ProfileRowItem>
                )}
              </div>
            </AppCardBody>
            <div className="border-t border-dk-rule px-[17px] py-[13px]">
              <Footnote>
                A profile belongs to the person, not to the firm: the database lets someone edit their own details and
                nobody else&rsquo;s, so there is no form here that would work. If something is wrong, ask {name} to correct
                it in their own app, and record what they told you as an internal note on the matter.
              </Footnote>
            </div>
          </AppCard>

          <AppCard>
            <AppCardHeader title="Consents given to this firm" />
            {consents.length === 0 ? (
              <AppEmpty
                title="No consent recorded"
                hint="A consent is written when the client accepts your terms, your privacy notice or a recording — usually as they book or as they first open the client app."
              />
            ) : (
              <>
                <AppCardList>
                  {consents.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-3 px-[15px] py-[13px]">
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                          {CONSENT_LABELS[c.kind] ?? c.kind}
                        </p>
                        {/* The version and the moment it was accepted: what a
                            consent is worth as a record. */}
                        <p className="mt-[3px] font-mono text-[11.5px] leading-[1.45] text-dk-soft">
                          Version {c.version}
                        </p>
                      </div>
                      <p className="flex-none text-right text-[11.5px] leading-[1.45] text-dk-soft">
                        {formatWhen(c.accepted_at, tz)}
                      </p>
                    </div>
                  ))}
                </AppCardList>
                <div className="border-t border-dk-rule px-[17px] py-[13px]">
                  <Footnote>
                    Only consents given to {ctx.firmName} are shown. Consents this person gave to another firm, or to
                    Docket itself, are theirs and are not readable here.
                  </Footnote>
                </div>
              </>
            )}
          </AppCard>
        </div>
      </div>

      <Footnote>
        Everything on this screen is read as you, from {ctx.firmName}&rsquo;s own records: consultations and matters
        belonging to another firm this person also instructs are not shown. &ldquo;Last seen&rdquo; is the later of their
        most recent consultation that had already begun and the most recent entry posted on one of their matters.
        A payment link opens the client&rsquo;s own app: they sign in as themselves to see the invoice and pay it, and
        the database shows it to nobody else.
      </Footnote>
    </div>
  );
}
