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

import Link from "next/link";
import { notFound } from "next/navigation";
import { matterStatuses, requestedFirmId, staffContext } from "@/lib/firm-data";
import { siteOrigin } from "@/lib/site";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusPill, type Status } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { MatterStatus } from "@/lib/db/types";

export const metadata = { title: "Client" };

const OWING_STATUSES = new Set(["issued", "partially_paid", "overdue"]);
const SEEN_STATUSES = new Set(["confirmed", "rescheduled", "completed"]);
const LIVE_STATUSES = new Set(["pending", "awaiting_payment", "confirmed", "rescheduled"]);

/** matter_statuses.colour holds a colour name; Tailwind needs whole class names. */
const TONES: Record<string, string> = {
  slate: "border-slate-300 bg-slate-50 text-slate-800",
  gray: "border-gray-300 bg-gray-50 text-gray-700",
  grey: "border-gray-300 bg-gray-50 text-gray-700",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
  sky: "border-sky-300 bg-sky-50 text-sky-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
  violet: "border-violet-300 bg-violet-50 text-violet-900",
  purple: "border-purple-300 bg-purple-50 text-purple-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  teal: "border-teal-300 bg-teal-50 text-teal-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  orange: "border-orange-300 bg-orange-50 text-orange-900",
  red: "border-red-300 bg-red-50 text-red-900",
  rose: "border-rose-300 bg-rose-50 text-rose-900",
};

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

function StatusChip({ status }: { status: MatterStatus }) {
  const colour = (status.colour ?? "").trim();
  const hex = colour.startsWith("#");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        hex ? "bg-white" : TONES[colour.toLowerCase()] ?? "border-gray-300 bg-gray-50 text-gray-700",
      )}
      style={hex ? { borderColor: colour, color: colour } : undefined}
    >
      {status.label}
    </span>
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
    <div className="space-y-5">
      <p className="text-sm"><Link href={backHref} className="text-brand underline">← Clients</Link></p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">
            {name}
            {profile?.client_type === "business" && <Badge className="ml-2 align-middle">business</Badge>}
          </h1>
          <p className="text-sm text-gray-600">
            {ctx.firmName} · {matters.length} {matters.length === 1 ? "matter" : "matters"}
            {openMatters > 0 ? ` (${openMatters} open)` : ""} ·{" "}
            {appointments.length} {appointments.length === 1 ? "consultation" : "consultations"} · times in {tz}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {lastSeen
              ? `Last seen ${formatWhen(lastSeen, tz, { dateStyle: "full", timeStyle: "short" })}`
              : "Not seen yet — no consultation has taken place and nothing has been posted on their matters."}
            {nextAppointment ? ` · next ${formatWhen(nextAppointment, tz, { dateStyle: "medium", timeStyle: "short" })}` : ""}
          </p>
        </div>
        {owedLabel && (
          <div className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-wide text-amber-900">Outstanding</p>
            <p className="font-heading text-xl font-semibold text-amber-900">{owedLabel}</p>
          </div>
        )}
      </header>

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

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Consultations"
              action={<Link href="/firm/appointments" className="text-sm text-brand underline">All consultations →</Link>}
            />
            {appointments.length === 0 ? (
              <EmptyState
                title="No consultation booked"
                hint="This person came to the firm through a matter, not a booking. They can book a consultation on your public site, or you can add a court date and updates to their matter."
                action={<Link href="/firm/appointments" className="text-sm text-brand underline">Go to consultations</Link>}
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {appointments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/firm/appointments/${a.id}`} className="block px-5 py-4 hover:bg-gray-50">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {formatWhen(a.starts_at, tz, { dateStyle: "medium", timeStyle: "short" })}
                            {" · "}
                            {a.service_id ? services.get(a.service_id) ?? "Consultation" : "Consultation"}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-600">
                            {a.reference} · {a.mode.replace("_", " ")} ·{" "}
                            {Math.max(1, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000))} min
                          </p>
                        </div>
                        <StatusPill status={a.status as Status} />
                      </div>
                      {a.cancellation_reason && (
                        <p className="mt-1 text-xs text-gray-600">Cancelled: {a.cancellation_reason}</p>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Matters"
              action={<Link href="/firm/matters/new" className="text-sm text-brand underline">Open a matter →</Link>}
            />
            {matters.length === 0 ? (
              <EmptyState
                title="Not on a matter yet"
                hint={
                  parties.length > 0
                    ? "They were added to a matter that has since been deleted. Open a new one to bring them back onto a file."
                    : "Open a matter for them, then invite them from the matter so they can follow it in their app."
                }
                action={
                  <Link
                    href="/firm/matters/new"
                    className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
                  >
                    Open a matter
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {matters.map((m) => {
                  const status = m.status_id ? statusById.get(m.status_id) ?? null : null;
                  const party = roleByMatter.get(m.id);
                  const causeDiffers = Boolean(m.cause_title && m.cause_title.trim() !== m.title.trim());
                  const nextDatePassed = Boolean(m.next_event_at && new Date(m.next_event_at).getTime() < nowMs);
                  return (
                    <li key={m.id}>
                      <Link href={`/firm/matters/${m.id}`} className="block px-5 py-4 hover:bg-gray-50">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">{m.title}</p>
                            {causeDiffers && <p className="mt-0.5 text-xs italic text-gray-600">{m.cause_title}</p>}
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {status && <StatusChip status={status} />}
                            {m.closed_at && (
                              <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                                Closed
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          {m.reference}
                          {party ? ` · ${PARTY_ROLE_LABELS[party.role] ?? party.role} on this file` : ""}
                          {party && !party.can_view_docs ? " · cannot see documents" : ""}
                          {party && !party.can_pay ? " · cannot pay" : ""}
                          {` · opened ${dayLabel(m.opened_at)}`}
                        </p>
                        {(m.court_name || m.suit_number) && (
                          <p className="mt-1 text-xs text-gray-600">
                            {m.court_name ?? "Court not recorded"}
                            {m.suit_number ? ` · ${m.suit_number}` : ""}
                          </p>
                        )}
                        {m.next_event_at && (
                          <p className={cn("mt-1 text-xs", nextDatePassed ? "text-amber-800" : "text-gray-800")}>
                            {nextDatePassed ? "Court date has passed: " : "Next court date: "}
                            <strong>{formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}</strong>
                            {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Invoices"
              action={<Link href="/firm/invoices" className="text-sm text-brand underline">All invoices →</Link>}
            />
            {invoices.length === 0 ? (
              <EmptyState
                title="Nothing billed yet"
                hint="Raise an invoice against this client from Invoices — consultation fees raised at booking appear here automatically."
                action={<Link href="/firm/invoices" className="text-sm text-brand underline">Go to invoices</Link>}
              />
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {invoices.map((inv) => {
                    const due = Number(inv.total_minor) - Number(inv.paid_minor);
                    const payable = inv.status !== "draft" && inv.status !== "cancelled";
                    const link = `${origin}/app/payments/${inv.id}`;
                    return (
                      <li key={inv.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {inv.number} · {formatMoneyMinor(Number(inv.total_minor), inv.currency)}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-600">
                              {inv.issued_at ? `Issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium" })}` : "Not issued"}
                              {inv.due_at ? ` · due ${dayLabel(inv.due_at)}` : ""}
                              {Number(inv.paid_minor) > 0 ? ` · paid ${formatMoneyMinor(Number(inv.paid_minor), inv.currency)}` : ""}
                              {due > 0 && OWING_STATUSES.has(inv.status)
                                ? ` · ${formatMoneyMinor(due, inv.currency)} outstanding`
                                : ""}
                            </p>
                            {inv.matter_id && (
                              <p className="mt-0.5 text-xs">
                                <Link href={`/firm/matters/${inv.matter_id}`} className="text-brand underline">
                                  On this client&rsquo;s matter
                                </Link>
                              </p>
                            )}
                          </div>
                          <StatusPill status={inv.status as Status} />
                        </div>

                        {payable ? (
                          <p className="mt-2 break-all text-xs text-gray-600">
                            {due > 0 ? "Payment link to send them: " : "Receipt link: "}
                            <Link href={`/app/payments/${inv.id}`} className="text-brand underline">{link}</Link>
                          </p>
                        ) : inv.status === "draft" ? (
                          <p className="mt-2 text-xs text-gray-500">
                            A draft is invisible to the client — the database refuses them a draft invoice. Issue it from
                            Invoices and the payment link appears here.
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-gray-500">Cancelled — nothing to collect.</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <CardBody className="border-t border-gray-100 text-xs text-gray-500">
                  {billed.size > 0 && (
                    <>
                      Billed {moneyLabel(billed)} in all, {moneyLabel(paid) || formatMoneyMinor(0, invoices[0].currency)} received.{" "}
                    </>
                  )}
                  {hasEmail
                    ? "A receipt goes to the client's email address as soon as a payment succeeds."
                    : "No email address on file, so no receipt can be emailed. Send the link above by their preferred channel."}
                </CardBody>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Name</dt>
                  <dd className="font-medium text-gray-900">{profile?.full_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Phone</dt>
                  <dd className="font-medium text-gray-900">
                    {profile?.phone ? <a href={`tel:${profile.phone}`} className="text-brand underline">{profile.phone}</a> : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Email</dt>
                  <dd className="font-medium text-gray-900">
                    {profile?.email ? (
                      <a href={`mailto:${profile.email}`} className="break-all text-brand underline">{profile.email}</a>
                    ) : (
                      <span className="text-amber-800">None on file — receipts need one</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Client type</dt>
                  <dd className="font-medium text-gray-900">
                    {profile?.client_type === "business" ? "Business" : profile?.client_type === "individual" ? "Individual" : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Company</dt>
                  <dd className="font-medium text-gray-900">{profile?.company_name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Their time zone</dt>
                  <dd className="font-medium text-gray-900">
                    {profile?.timezone ?? "—"}
                    {profile && profile.timezone !== tz ? " (yours is " + tz + ")" : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Preferred channel</dt>
                  <dd className="font-medium text-gray-900">
                    {CHANNEL_LABELS[channel] ?? channel}
                    {channelUnreachable && <span className="text-amber-800"> — but there is no email address on file</span>}
                  </dd>
                </div>
                {addressLine && (
                  <div>
                    <dt className="text-gray-500">Address</dt>
                    <dd className="whitespace-pre-wrap font-medium text-gray-900">{addressLine}</dd>
                  </div>
                )}
                {profile && (
                  <div>
                    <dt className="text-gray-500">On Docket since</dt>
                    <dd className="font-medium text-gray-900">{formatWhen(profile.created_at, tz, { dateStyle: "medium" })}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
            <CardBody className="border-t border-gray-100 text-xs text-gray-500">
              A profile belongs to the person, not to the firm: the database lets someone edit their own details and
              nobody else&rsquo;s, so there is no form here that would work. If something is wrong, ask {name} to correct
              it in their own app, and record what they told you as an internal note on the matter.
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Consents given to this firm" />
            {consents.length === 0 ? (
              <EmptyState
                title="No consent recorded"
                hint="A consent is written when the client accepts your terms, your privacy notice or a recording — usually as they book or as they first open the client app."
              />
            ) : (
              <>
                <ul className="divide-y divide-gray-100">
                  {consents.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{CONSENT_LABELS[c.kind] ?? c.kind}</p>
                        <p className="text-xs text-gray-500">Version {c.version}</p>
                      </div>
                      <p className="text-xs text-gray-600">{formatWhen(c.accepted_at, tz)}</p>
                    </li>
                  ))}
                </ul>
                <CardBody className="border-t border-gray-100 text-xs text-gray-500">
                  Only consents given to {ctx.firmName} are shown. Consents this person gave to another firm, or to
                  Docket itself, are theirs and are not readable here.
                </CardBody>
              </>
            )}
          </Card>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Everything on this screen is read as you, from {ctx.firmName}&rsquo;s own records: consultations and matters
        belonging to another firm this person also instructs are not shown. &ldquo;Last seen&rdquo; is the later of their
        most recent consultation that had already begun and the most recent entry posted on one of their matters.
        A payment link opens the client&rsquo;s own app: they sign in as themselves to see the invoice and pay it, and
        the database shows it to nobody else.
      </p>
    </div>
  );
}
