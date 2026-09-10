// Clients: everyone the firm acts for — the union of the people who have booked
// a consultation (appointments.client_id) and the people named on one of its
// matters (matter_parties.user_id). Name, phone, email, how many matters, how
// many consultations, what is outstanding, and when they were last seen.
//
// Rules enforced here: the database is the authorization layer — every read runs
// as the signed-in staff member and profiles come back only because
// can_see_profile() lets a firm member see its own clients (never a service key);
// timestamps are UTC in the database and rendered in ctx.timezone with
// Intl.DateTimeFormat; money is integer minor units through formatMoneyMinor and
// is grouped by the currency it was billed in; nothing is firm-specific — the
// firm, its name, its zone and its public booking address all come from context;
// and the empty state names the next action instead of leaving a dead end.

import Link from "next/link";
import { staffContext, requestedFirmId } from "@/lib/firm-data";
import { firmById } from "@/lib/tenant";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { normalizeNigerianPhone } from "@/lib/nigeria";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export const metadata = { title: "Clients" };

/** How far back each scan reaches. A cap that bites is said out loud on the page. */
const APPOINTMENT_SCAN = 1000;
const PARTY_SCAN = 2000;
const MATTER_SCAN = 2000;
const INVOICE_SCAN = 2000;
const UPDATE_SCAN = 2000;
const SHOW = 200;

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

/** Statuses that mean the person actually turned up (or was billed for turning up). */
const SEEN_STATUSES = new Set(["confirmed", "rescheduled", "completed"]);
const LIVE_STATUSES = new Set(["pending", "awaiting_payment", "confirmed", "rescheduled"]);
const OWING_STATUSES = ["issued", "partially_paid", "overdue"];

interface PersonRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  client_type: string | null;
  company_name: string | null;
}

interface AppointmentScanRow {
  id: string;
  client_id: string;
  starts_at: string;
  status: string;
  client: PersonRow | PersonRow[] | null;
}

interface PartyScanRow {
  matter_id: string;
  user_id: string;
  role: string;
  client: PersonRow | PersonRow[] | null;
}

interface InvoiceScanRow {
  client_id: string;
  currency: string;
  total_minor: number;
  paid_minor: number;
  status: string;
}

interface ClientCard {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  clientType: string | null;
  company: string | null;
  matters: number;
  openMatters: number;
  appointments: number;
  outstanding: Map<string, number>;
  owed: number;
  lastSeen: string | null;
  nextAt: string | null;
}

/** PostgREST returns a to-one embed as an object; tolerate an array all the same. */
function one(value: PersonRow | PersonRow[] | null | undefined): PersonRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** "yesterday", "3 weeks ago" — how long since the firm last dealt with someone. */
function sinceLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const hours = Math.round((nowMs - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return rtf.format(-Math.max(1, hours), "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return rtf.format(-days, "day");
  if (days < 60) return rtf.format(-Math.round(days / 7), "week");
  if (days < 365) return rtf.format(-Math.round(days / 30), "month");
  return rtf.format(-Math.round(days / 365), "year");
}

function moneyLabel(byCurrency: Map<string, number>): string {
  return Array.from(byCurrency.entries())
    .filter(([, minor]) => minor > 0)
    .map(([currency, minor]) => formatMoneyMinor(minor, currency))
    .join(" · ");
}

function add(map: Map<string, number>, currency: string, minor: number): void {
  map.set(currency, (map.get(currency) ?? 0) + minor);
}

type Filter = "all" | "owing" | "matter" | "no_email";
const FILTERS: Array<[Filter, string]> = [
  ["all", "Everyone"],
  ["owing", "Owing"],
  ["matter", "On a matter"],
  ["no_email", "No email"],
];

export default async function FirmClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; q?: string; filter?: string }>;
}) {
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
  const search = (sp.q ?? "").trim().slice(0, 80);
  const filter: Filter = (FILTERS.map((f) => f[0]) as string[]).includes(sp.filter ?? "")
    ? (sp.filter as Filter)
    : "all";

  const [{ data: apptRows }, { data: partyRows }, { data: matterRows }, { data: invoiceRows }, { data: updateRows }, firm] =
    await Promise.all([
      supabase
        .from("appointments")
        .select("id, client_id, starts_at, status, client:profiles!appointments_client_id_fkey(id, full_name, phone, email, client_type, company_name)")
        .eq("firm_id", firmId)
        .order("starts_at", { ascending: false })
        .limit(APPOINTMENT_SCAN),
      supabase
        .from("matter_parties")
        .select("matter_id, user_id, role, client:profiles!matter_parties_user_id_fkey(id, full_name, phone, email, client_type, company_name)")
        .eq("firm_id", firmId)
        .limit(PARTY_SCAN),
      supabase
        .from("matters")
        .select("id, closed_at")
        .eq("firm_id", firmId)
        .is("deleted_at", null)
        .limit(MATTER_SCAN),
      supabase
        .from("invoices")
        .select("client_id, currency, total_minor, paid_minor, status")
        .eq("firm_id", firmId)
        .in("status", OWING_STATUSES)
        .limit(INVOICE_SCAN),
      supabase
        .from("updates")
        .select("matter_id, occurred_at")
        .eq("firm_id", firmId)
        .order("occurred_at", { ascending: false })
        .limit(UPDATE_SCAN),
      firmById(firmId),
    ]);

  const appointments = (apptRows ?? []) as unknown as AppointmentScanRow[];
  const parties = (partyRows ?? []) as unknown as PartyScanRow[];
  const matters = (matterRows ?? []) as Array<{ id: string; closed_at: string | null }>;
  const invoices = (invoiceRows ?? []) as InvoiceScanRow[];
  const updates = (updateRows ?? []) as Array<{ matter_id: string; occurred_at: string }>;

  const matterById = new Map(matters.map((m) => [m.id, m]));

  // The newest update on each matter — the reads come back newest first, so the
  // first sighting of a matter is its latest entry. Internal entries count here:
  // this is the firm's own record of when it last touched the file, and nothing
  // from an internal entry is rendered.
  const latestUpdateByMatter = new Map<string, string>();
  for (const u of updates) if (!latestUpdateByMatter.has(u.matter_id)) latestUpdateByMatter.set(u.matter_id, u.occurred_at);

  const nowMs = Date.now();
  const byClient = new Map<string, ClientCard>();

  const ensure = (person: PersonRow | null, id: string): ClientCard => {
    const existing = byClient.get(id);
    if (existing) {
      if (existing.name === "Client" && person?.full_name) existing.name = person.full_name;
      return existing;
    }
    const card: ClientCard = {
      id,
      name: person?.full_name?.trim() || person?.company_name?.trim() || "Client",
      phone: person?.phone ?? null,
      email: person?.email ?? null,
      clientType: person?.client_type ?? null,
      company: person?.company_name ?? null,
      matters: 0,
      openMatters: 0,
      appointments: 0,
      outstanding: new Map<string, number>(),
      owed: 0,
      lastSeen: null,
      nextAt: null,
    };
    byClient.set(id, card);
    return card;
  };

  for (const a of appointments) {
    const card = ensure(one(a.client), a.client_id);
    card.appointments += 1;
    const startsMs = new Date(a.starts_at).getTime();
    if (startsMs <= nowMs && SEEN_STATUSES.has(a.status)) {
      if (!card.lastSeen || a.starts_at > card.lastSeen) card.lastSeen = a.starts_at;
    }
    if (startsMs > nowMs && LIVE_STATUSES.has(a.status)) {
      if (!card.nextAt || a.starts_at < card.nextAt) card.nextAt = a.starts_at;
    }
  }

  for (const p of parties) {
    const matter = matterById.get(p.matter_id);
    if (!matter) continue; // deleted, or beyond the matter scan
    const card = ensure(one(p.client), p.user_id);
    card.matters += 1;
    if (!matter.closed_at) card.openMatters += 1;
    const touched = latestUpdateByMatter.get(p.matter_id);
    if (touched && (!card.lastSeen || touched > card.lastSeen)) card.lastSeen = touched;
  }

  for (const inv of invoices) {
    const card = byClient.get(inv.client_id);
    if (!card) continue; // billed but no longer on a matter or an appointment in range
    const due = Number(inv.total_minor) - Number(inv.paid_minor);
    if (due <= 0) continue;
    add(card.outstanding, inv.currency, due);
    card.owed += due;
  }

  // Search matches a name, a company, an email or a phone number; a Nigerian
  // number typed as 0803… is matched against the +234 form the database holds.
  const needle = search.toLowerCase();
  const phoneNeedle = search ? normalizeNigerianPhone(search) : null;
  const digits = search.replace(/\D/g, "");

  const everyone = Array.from(byClient.values());
  const matched = everyone.filter((c) => {
    if (filter === "owing" && c.owed <= 0) return false;
    if (filter === "matter" && c.matters === 0) return false;
    if (filter === "no_email" && c.email) return false;
    if (!search) return true;
    const phone = (c.phone ?? "").replace(/\D/g, "");
    return (
      c.name.toLowerCase().includes(needle) ||
      (c.company ?? "").toLowerCase().includes(needle) ||
      (c.email ?? "").toLowerCase().includes(needle) ||
      (phoneNeedle !== null && c.phone === phoneNeedle) ||
      (digits.length >= 4 && phone.includes(digits))
    );
  });

  matched.sort((a, b) => {
    if (a.lastSeen && b.lastSeen && a.lastSeen !== b.lastSeen) return b.lastSeen.localeCompare(a.lastSeen);
    if (a.lastSeen && !b.lastSeen) return -1;
    if (!a.lastSeen && b.lastSeen) return 1;
    return a.name.localeCompare(b.name);
  });
  const shown = matched.slice(0, SHOW);

  const totalOutstanding = new Map<string, number>();
  for (const c of matched) for (const [currency, minor] of c.outstanding) add(totalOutstanding, currency, minor);
  const missingEmail = everyone.filter((c) => !c.email).length;

  const filtered = filter !== "all" || search.length > 0;
  const capped = appointments.length === APPOINTMENT_SCAN || parties.length === PARTY_SCAN || matters.length === MATTER_SCAN;

  const query = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      firm: sp.firm ?? null,
      filter: filter === "all" ? null : filter,
      q: search || null,
      ...patch,
    };
    for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/firm/clients?${qs}` : "/firm/clients";
  };

  const chipClass = (active: boolean) =>
    cn(
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm",
      active ? "border-brand bg-brand text-white" : "border-gray-300 bg-white text-gray-700 hover:border-brand",
    );

  const bookingHref = firm ? `/${firm.slug}/book` : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold text-brand">Clients</h1>
          <p className="text-sm text-gray-600">
            {ctx.firmName} · {everyone.length} {everyone.length === 1 ? "person" : "people"} the firm acts for · times in {tz}
          </p>
        </div>
        {bookingHref && (
          <Link
            href={bookingHref}
            className="flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:bg-black/5"
          >
            Booking page
          </Link>
        )}
      </header>

      {everyone.length > 0 && totalOutstanding.size > 0 && (
        <Alert kind="info" title="Outstanding across these clients">
          {moneyLabel(totalOutstanding)} on invoices that are issued, part-paid or overdue.{" "}
          <Link href="/firm/invoices" className="font-medium underline">Go to invoices</Link>.
        </Alert>
      )}

      <nav aria-label="Filter clients" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map(([key, label]) => (
          <Link
            key={key}
            href={query({ filter: key === "all" ? null : key })}
            aria-current={filter === key ? "page" : undefined}
            className={chipClass(filter === key)}
          >
            {label}
            {key === "no_email" && missingEmail > 0 ? ` (${missingEmail})` : ""}
          </Link>
        ))}
      </nav>

      <Card>
        <form method="get" action="/firm/clients" className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-end">
          {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <div>
            <label htmlFor="q" className="text-sm font-medium text-gray-900">Search</label>
            <input
              id="q" name="q" type="search" inputMode="search" defaultValue={search} maxLength={80}
              placeholder="Name, company, phone or email" className={field}
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:opacity-90">
              Search
            </button>
            {filtered && <Link href="/firm/clients" className="text-sm text-brand underline">Clear</Link>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={filtered ? `Matching clients (${matched.length})` : `All clients (${matched.length})`}
          action={<Link href="/firm/matters/new" className="text-sm text-brand underline">Open a matter →</Link>}
        />
        {shown.length === 0 ? (
          filtered ? (
            <EmptyState
              title="Nobody matches"
              hint="Try part of a name, a company, an email address, or the last few digits of a phone number."
              action={<Link href="/firm/clients" className="text-sm text-brand underline">Clear the search</Link>}
            />
          ) : (
            <EmptyState
              title="No clients yet"
              hint={
                bookingHref
                  ? "A person lands here the moment they book a consultation on your public site, or the moment you add them to a matter."
                  : "A person lands here the moment they book a consultation, or the moment you add them to a matter. Your public booking page goes live once Docket verifies the firm."
              }
              action={
                bookingHref ? (
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Link
                      href={bookingHref}
                      className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:opacity-90"
                    >
                      Open the booking page
                    </Link>
                    <Link href="/firm/matters/new" className="text-sm text-brand underline">Open a matter instead</Link>
                  </div>
                ) : (
                  <Link href="/firm/matters/new" className="text-sm text-brand underline">Open a matter</Link>
                )
              }
            />
          )
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map((c) => {
              const owed = moneyLabel(c.outstanding);
              return (
                <li key={c.id}>
                  <Link
                    href={`/firm/clients/${c.id}${sp.firm ? `?firm=${sp.firm}` : ""}`}
                    className="block px-5 py-4 hover:bg-gray-50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {c.name}
                          {c.clientType === "business" && <Badge className="ml-2">business</Badge>}
                        </p>
                        {c.company && c.company.trim() !== c.name && (
                          <p className="mt-0.5 text-xs text-gray-600">{c.company}</p>
                        )}
                      </div>
                      {owed && (
                        <p className="shrink-0 text-sm font-semibold text-amber-800">{owed} due</p>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-gray-600">
                      {c.phone ?? "no phone on file"}
                      {" · "}
                      {c.email ? c.email : <span className="font-medium text-amber-800">no email — receipts cannot be sent</span>}
                    </p>

                    <p className="mt-1 text-xs text-gray-600">
                      {c.matters === 0
                        ? "No matter"
                        : `${c.matters} ${c.matters === 1 ? "matter" : "matters"}${c.openMatters > 0 ? ` (${c.openMatters} open)` : ""}`}
                      {" · "}
                      {c.appointments === 0
                        ? "no consultations"
                        : `${c.appointments} ${c.appointments === 1 ? "consultation" : "consultations"}`}
                      {" · "}
                      {c.lastSeen
                        ? `last seen ${formatWhen(c.lastSeen, tz, { dateStyle: "medium" })} (${sinceLabel(c.lastSeen, nowMs)})`
                        : "not seen yet"}
                    </p>

                    {c.nextAt && (
                      <p className="mt-1 text-xs font-medium text-brand">
                        Next consultation {formatWhen(c.nextAt, tz, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-gray-500">
        &ldquo;Last seen&rdquo; is the later of the most recent consultation that had already begun and was not cancelled,
        and the most recent entry posted on one of their matters. Outstanding is what is left on invoices that are issued,
        part-paid or overdue, in the currency each was billed in.
        {matched.length > SHOW ? ` Showing the ${SHOW} most recent of ${matched.length} — search to reach the rest.` : ""}
        {capped
          ? ` This screen reads the ${APPOINTMENT_SCAN} most recent consultations and up to ${PARTY_SCAN} matter parties; an older client may not appear.`
          : ""}
      </p>
    </div>
  );
}
