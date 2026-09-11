// Firm overview: the whole practice on one screen — the firm's totals, a
// fourteen-day calendar of sittings and consultations side by side, the latest
// activity across every matter, and who originates work against who handles it.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS
// decides what this page can see (never a service key); staff — and only staff —
// see internal timeline entries, which are marked so nobody pastes one to a
// client; UTC in the database, rendered in ctx.timezone; money is integer minor
// units through formatMoneyMinor; the firm comes from context, never from code.

import Link from "next/link";
import {
  staffContext, firmOverview, firmStaff, firmMatters, staffLabel, requestedFirmId,
} from "@/lib/firm-data";
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { zonedDayRange, formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { CauseListRow } from "@/lib/db/types";

export const metadata = { title: "Firm overview" };

const CALENDAR_DAYS = 14;
/** How many attributed payments the fee column adds up. A cap that bites is disclosed. */
const FEE_SCAN = 5000;

const KIND_ICON: Record<string, string> = {
  court_sitting: "⚖", consultation: "🎥", appointment: "📅", filing: "📄", correspondence: "✉",
  milestone: "★", fee: "₦", document: "📎", note: "✎", status_change: "⇄",
};

type Sitting = Pick<CauseListRow,
  "court_event_id" | "matter_id" | "reference" | "cause_title" | "suit_number" | "scheduled_at" | "court" | "courtroom" | "purpose" | "purpose_kind">;

interface CalendarAppointment {
  id: string; reference: string; starts_at: string; status: string; mode: string;
  client: { full_name: string | null } | null;
}

interface FeedRow {
  id: string; matter_id: string; kind: string; visibility: string;
  title: string; body: string | null; occurred_at: string;
}

interface MatterRef { id: string; reference: string; title: string; cause_title: string | null }

export default async function FirmOverviewPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;

  // Fourteen calendar days in the viewer's own zone. Each day is derived from the
  // previous day's end so a zone that shifts its clocks still yields real days.
  const days: Array<{ ymd: string; start: Date; end: Date }> = [];
  let cursor = zonedDayRange(tz);
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    days.push(cursor);
    cursor = zonedDayRange(tz, new Date(cursor.end.getTime() + 3_600_000));
  }
  const windowStart = days[0].start.toISOString();
  const windowEnd = days[days.length - 1].end.toISOString();

  const [overview, { data: firmRow }, { data: sittingRows }, { data: apptRows }, { data: updateRows }, staff, matters] =
    await Promise.all([
      firmOverview(supabase, firmId),
      // As on Today: firm_public excludes any firm that is not active, so a pending
      // or suspended firm would read null and every money tile would claim naira.
      supabase.from("firms").select("default_currency").eq("id", firmId).maybeSingle(),
      supabase
        .from("firm_cause_list")
        .select("court_event_id, matter_id, reference, cause_title, suit_number, scheduled_at, court, courtroom, purpose, purpose_kind")
        .eq("firm_id", firmId)
        .gte("scheduled_at", windowStart)
        .lt("scheduled_at", windowEnd)
        .order("scheduled_at", { ascending: true }),
      supabase
        .from("appointments")
        .select("id, reference, starts_at, status, mode, client:profiles!appointments_client_id_fkey(full_name)")
        .eq("firm_id", firmId)
        .in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"])
        .gte("starts_at", windowStart)
        .lt("starts_at", windowEnd)
        .order("starts_at", { ascending: true }),
      supabase
        .from("updates")
        .select("id, matter_id, kind, visibility, title, body, occurred_at")
        .eq("firm_id", firmId)
        .order("occurred_at", { ascending: false })
        .limit(30),
      firmStaff(supabase, firmId),
      firmMatters(supabase, firmId, { limit: 500 }),
    ]);

  const currency = (firmRow as { default_currency: string } | null)?.default_currency ?? "NGN";
  const sittings = (sittingRows ?? []) as Sitting[];
  const appointments = (apptRows ?? []) as unknown as CalendarAppointment[];
  const feed = (updateRows ?? []) as FeedRow[];

  // The matters behind the activity feed, so every entry can name its file.
  const feedMatterIds = Array.from(new Set(feed.map((u) => u.matter_id)));
  // Soft-deleted matters are excluded everywhere else in the console, so an entry
  // on one must not list here and link to a page that answers 404.
  const { data: feedMatterRows } = feedMatterIds.length
    ? await supabase
        .from("matters")
        .select("id, reference, title, cause_title")
        .is("deleted_at", null)
        .in("id", feedMatterIds)
    : { data: [] as MatterRef[] };
  const matterById = new Map(((feedMatterRows ?? []) as MatterRef[]).map((m) => [m.id, m]));
  const visibleFeed = feed.filter((u) => matterById.has(u.matter_id));

  // Fees collected on each partner's originated work. partner_attribution reads
  // through the caller's own RLS on payments and invoices; a firm whose access
  // closes that view still gets the counts, just without the money column.
  let feesByLawyer: Map<string, Map<string, number>> | null = null;
  let feeRowsCapped = false;
  try {
    const { data, error } = await supabase
      .from("partner_attribution")
      .select("originating_lawyer_id, amount_minor, currency")
      .eq("firm_id", firmId)
      .limit(FEE_SCAN);
    if (error) throw new Error(error.message);
    const map = new Map<string, Map<string, number>>();
    feeRowsCapped = (data ?? []).length >= FEE_SCAN;
    for (const row of (data ?? []) as Array<{ originating_lawyer_id: string | null; amount_minor: number; currency: string }>) {
      if (!row.originating_lawyer_id) continue;
      const perCurrency = map.get(row.originating_lawyer_id) ?? new Map<string, number>();
      perCurrency.set(row.currency, (perCurrency.get(row.currency) ?? 0) + Number(row.amount_minor));
      map.set(row.originating_lawyer_id, perCurrency);
    }
    feesByLawyer = map;
  } catch {
    feesByLawyer = null;
  }

  const staffIds = new Set(staff.map((m) => m.user_id));
  const attribution = staff
    .map((m) => ({
      id: m.user_id,
      label: staffLabel(m),
      role: m.role,
      originated: matters.filter((x) => x.originating_lawyer_id === m.user_id).length,
      handling: matters.filter((x) => x.handling_lawyer_id === m.user_id).length,
      fees: feesByLawyer?.get(m.user_id) ?? null,
    }))
    .sort((a, b) => b.originated - a.originated || b.handling - a.handling || a.label.localeCompare(b.label));
  const unattributedOriginated = matters.filter((x) => !x.originating_lawyer_id || !staffIds.has(x.originating_lawyer_id)).length;
  const unattributedHandling = matters.filter((x) => !x.handling_lawyer_id || !staffIds.has(x.handling_lawyer_id)).length;

  const tiles = overview
    ? [
        { label: "Open matters", value: String(overview.open_matters), href: "/firm/matters" },
        { label: "Sittings to chase", value: String(overview.sittings_due), href: "/firm" },
        { label: "Court dates, 30 days", value: String(overview.court_dates_30d), href: "/firm/matters" },
        { label: "Upcoming consultations", value: String(overview.upcoming_appointments), href: "/firm/appointments?view=upcoming" },
        { label: "Unread client messages", value: String(overview.unread_messages), href: "/firm/matters" },
        { label: "Overdue tasks", value: String(overview.overdue_tasks), href: "/firm/matters" },
        { label: "Client uploads to review", value: String(overview.client_uploads), href: "/firm/matters" },
        { label: "Service to acknowledge", value: String(overview.service_to_acknowledge), href: "/firm/inbox" },
        { label: "Outstanding", value: formatMoneyByCurrency(overview.outstanding_by_currency, currency), href: "/firm/invoices" },
        { label: "Collected this month", value: formatMoneyByCurrency(overview.collected_this_month_by_currency, currency), href: "/firm/invoices" },
      ]
    : [];

  const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" });
  const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" });
  const bucketOf = (iso: string) => ymdFmt.format(new Date(iso));
  const calendarCount = sittings.length + appointments.length;

  const feeLabel = (perCurrency: Map<string, number> | null): string => {
    if (!perCurrency || perCurrency.size === 0) return formatMoneyMinor(0, currency);
    return Array.from(perCurrency.entries()).map(([cur, minor]) => formatMoneyMinor(minor, cur)).join(" · ");
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Firm overview</h1>
          <p className="text-sm text-gray-600">{ctx.firmName} · everything in {tz}</p>
        </div>
        <Link href="/firm" className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5">
          Back to Today
        </Link>
      </header>

      {overview ? (
        <section aria-label="Firm totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className="rounded-card border border-gray-200 bg-white p-4 shadow-sm hover:border-brand">
              <p className="text-xs uppercase tracking-wide text-gray-500">{t.label}</p>
              <p className="mt-1 font-heading text-xl font-semibold text-brand">{t.value}</p>
            </Link>
          ))}
        </section>
      ) : (
        <Alert kind="warning" title="Totals unavailable">
          The firm summary could not be read for {ctx.firmName}. The calendar, activity and attribution below are
          read straight from your matters and still hold.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="Next 14 days"
          action={<Link href="/firm/sittings" className="text-sm text-brand underline">Sittings →</Link>}
        />
        {calendarCount === 0 ? (
          <EmptyState
            title="Nothing listed in the next fortnight"
            hint="Court dates appear here as you post updates and next dates; consultations appear as clients book."
            action={<Link href="/firm/sittings" className="text-sm text-brand underline">Post a court update</Link>}
          />
        ) : (
          <CardBody>
            <p className="mb-3 text-xs text-gray-500">
              Court sittings and consultations, one column per day. On a phone, only days with something listed are shown.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
              {days.map((d, index) => {
                const daySittings = sittings.filter((s) => bucketOf(s.scheduled_at) === d.ymd);
                const dayAppointments = appointments.filter((a) => bucketOf(a.starts_at) === d.ymd);
                const empty = daySittings.length + dayAppointments.length === 0;
                return (
                  <div
                    key={d.ymd}
                    className={cn(
                      "rounded-card border bg-white p-3",
                      index === 0 ? "border-brand" : "border-gray-200",
                      empty && "hidden sm:block",
                    )}
                  >
                    <p className="font-heading text-sm font-semibold text-brand">
                      {index === 0 ? "Today" : weekdayFmt.format(d.start)}
                    </p>
                    <p className="text-xs text-gray-500">{dayFmt.format(d.start)}</p>
                    {empty ? (
                      <p className="mt-2 text-xs text-gray-500">Clear</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {daySittings.map((s) => (
                          <li key={s.court_event_id}>
                            <Link href={`/firm/matters/${s.matter_id}`} className="block rounded-lg bg-brand-surface px-2 py-2 hover:bg-black/5">
                              <p className="text-xs font-semibold text-brand">
                                <span aria-hidden="true">⚖ </span>
                                {formatWhen(s.scheduled_at, tz, { timeStyle: "short" })}
                              </p>
                              <p className="text-xs text-gray-800">{s.cause_title}</p>
                              <p className="text-[11px] text-gray-500">
                                {s.suit_number ?? s.reference}
                                {s.court ? ` · ${s.court}` : ""}
                                {s.courtroom ? ` · ${s.courtroom}` : ""}
                                {s.purpose || s.purpose_kind ? ` · ${s.purpose ?? (s.purpose_kind ?? "").replace("_", " ")}` : ""}
                              </p>
                            </Link>
                          </li>
                        ))}
                        {dayAppointments.map((a) => (
                          <li key={a.id}>
                            <Link href={`/firm/appointments/${a.id}`} className="block rounded-lg border border-gray-200 px-2 py-2 hover:bg-gray-50">
                              <p className="text-xs font-semibold text-gray-800">
                                <span aria-hidden="true">📅 </span>
                                {formatWhen(a.starts_at, tz, { timeStyle: "short" })}
                              </p>
                              <p className="text-xs text-gray-800">{a.client?.full_name ?? "Client"}</p>
                              <p className="text-[11px] text-gray-500">{a.reference} · {a.mode.replace("_", " ")} · {a.status.replace("_", " ")}</p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Latest activity"
            action={<Link href="/firm/matters" className="text-sm text-brand underline">All matters →</Link>}
          />
          {visibleFeed.length === 0 ? (
            <EmptyState
              title="No updates posted yet"
              hint="Every court outcome, filing and note posted on a matter shows here, newest first."
              action={<Link href="/firm/sittings" className="text-sm text-brand underline">Post a court update</Link>}
            />
          ) : (
            <>
              <ol className="divide-y divide-gray-100">
                {visibleFeed.map((u) => {
                  const matter = matterById.get(u.matter_id);
                  const internal = u.visibility === "internal";
                  return (
                    <li key={u.id} className="flex gap-3 px-5 py-4">
                      <span aria-hidden="true" className="mt-0.5 w-6 shrink-0 text-center text-base">{KIND_ICON[u.kind] ?? "•"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {u.title}
                          {internal && <Badge className="ml-2 bg-amber-100 text-amber-900">internal</Badge>}
                        </p>
                        {u.body && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{u.body}</p>}
                        <p className="mt-1 text-xs text-gray-500">
                          <Link href={`/firm/matters/${u.matter_id}`} className="text-brand underline">
                            {matter ? matter.cause_title ?? matter.title : "Open matter"}
                          </Link>
                          {matter ? ` · ${matter.reference}` : ""} · {formatWhen(u.occurred_at, tz)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <CardBody className="border-t border-gray-100 text-xs text-gray-500">
                Entries marked internal are staff-only and never reach a client.
              </CardBody>
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Originated against handling" />
          {attribution.length === 0 ? (
            <EmptyState
              title="No colleagues on this firm yet"
              hint="Invite the rest of chambers, then set an originating and a handling lawyer on each matter."
              action={<Link href="/firm/matters" className="text-sm text-brand underline">Open a matter</Link>}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Member</TH>
                    <TH className="text-right">Originated</TH>
                    <TH className="text-right">Handling</TH>
                    {feesByLawyer && <TH className="text-right">Fees collected</TH>}
                  </TR>
                </THead>
                <TBody>
                  {attribution.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <span className="font-medium text-gray-900">{row.label}</span>
                        <span className="ml-2 text-xs text-gray-500">{row.role}</span>
                      </TD>
                      <TD className="text-right tabular-nums">{row.originated}</TD>
                      <TD className="text-right tabular-nums">{row.handling}</TD>
                      {feesByLawyer && <TD className="text-right tabular-nums">{feeLabel(row.fees)}</TD>}
                    </TR>
                  ))}
                  {(unattributedOriginated > 0 || unattributedHandling > 0) && (
                    <TR>
                      <TD className="text-gray-500">Not attributed</TD>
                      <TD className="text-right tabular-nums text-gray-500">{unattributedOriginated}</TD>
                      <TD className="text-right tabular-nums text-gray-500">{unattributedHandling}</TD>
                      {feesByLawyer && <TD className="text-right text-gray-500">—</TD>}
                    </TR>
                  )}
                  <TR>
                    <TD className="font-medium text-gray-900">Total matters</TD>
                    <TD className="text-right font-medium tabular-nums text-gray-900">{matters.length}</TD>
                    <TD className="text-right font-medium tabular-nums text-gray-900">{matters.length}</TD>
                    {feesByLawyer && <TD className="text-right">&nbsp;</TD>}
                  </TR>
                </TBody>
              </Table>
              <CardBody className="border-t border-gray-100 text-xs text-gray-500">
                {feesByLawyer
                  ? "Fees are payments received against invoices on each member's originated matters, in the currency they were paid."
                  : "Fees collected are not shown: the attribution view could not be read with your access."}
                {" "}Origination is who brought the work in; handling is who runs it. Set both when you open or edit a matter.
                {matters.length >= 500 ? " Counts cover the 500 most recently opened matters." : ""}
                {feesByLawyer && feeRowsCapped ? ` Fees cover the ${FEE_SCAN.toLocaleString("en-GB")} most recent payments.` : ""}
              </CardBody>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
