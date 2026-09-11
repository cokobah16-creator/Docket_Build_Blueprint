// Firm overview: the whole practice on one screen — the firm's totals, a
// fourteen-day calendar of sittings and consultations side by side, the latest
// activity across every matter, and who originates work against who handles it.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS
// decides what this page can see (never a service key); staff — and only staff —
// see internal timeline entries, which are marked so nobody pastes one to a
// client; UTC in the database, rendered in ctx.timezone; money is integer minor
// units through formatMoneyMinor; the firm comes from context, never from code.
//
// Drawn on the phone kit (design/pwa). Two things changed shape for the phone:
// the activity feed's emoji kind column is now the app's own line icons, on the
// same pattern as src/components/portal/timeline.tsx and with the kind carried
// as screen-reader text; and the attribution table is a list of rows rather
// than a four-column grid, because a 36rem table on a 390px screen is a
// sideways scroll. Colour is the console's one exception to neutral: overdue
// tasks, unacknowledged service and money still owed, each named in words too.

import Link from "next/link";
import {
  staffContext, firmOverview, firmStaff, firmMatters, staffLabel, requestedFirmId,
} from "@/lib/firm-data";
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { zonedDayRange, formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppButtonLink,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import type { IconProps } from "@/components/ui/icons";
import {
  CalendarIcon,
  DocumentIcon,
  LockIcon,
  MailIcon,
  NairaIcon,
  PaperclipIcon,
  PencilIcon,
  ScalesIcon,
  StarIcon,
  SwapIcon,
  VideoIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { CauseListRow } from "@/lib/db/types";

export const metadata = { title: "Firm overview" };

const CALENDAR_DAYS = 14;
/** How many attributed payments the fee column adds up. A cap that bites is disclosed. */
const FEE_SCAN = 5000;

type IconGlyph = (p: IconProps) => React.JSX.Element;

/**
 * The ten `update_kind` values, each with its mark and its name — the same map
 * the client timeline uses, for the same reason: an emoji carries a weight and
 * a colour the design did not choose. Typed as possibly-missing because the
 * enum can grow in a migration before it grows here.
 */
const KINDS: Record<string, { Icon: IconGlyph; label: string } | undefined> = {
  court_sitting: { Icon: ScalesIcon, label: "Court sitting" },
  consultation: { Icon: VideoIcon, label: "Consultation" },
  appointment: { Icon: CalendarIcon, label: "Appointment" },
  filing: { Icon: DocumentIcon, label: "Filing" },
  correspondence: { Icon: MailIcon, label: "Correspondence" },
  milestone: { Icon: StarIcon, label: "Milestone" },
  fee: { Icon: NairaIcon, label: "Fee" },
  document: { Icon: PaperclipIcon, label: "Document" },
  note: { Icon: PencilIcon, label: "Note" },
  status_change: { Icon: SwapIcon, label: "Status change" },
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

  // `ink` is the console's one use of colour: a number that means somebody is
  // late, that process is sitting unacknowledged, or that money is owed. Each
  // one says the same thing in its label.
  const tiles = overview
    ? [
        { label: "Open matters", value: String(overview.open_matters), href: "/firm/matters", ink: "text-dk-strong" },
        { label: "Sittings to chase", value: String(overview.sittings_due), href: "/firm", ink: "text-[#92400E]" },
        { label: "Court dates, 30 days", value: String(overview.court_dates_30d), href: "/firm/matters", ink: "text-dk-strong" },
        { label: "Upcoming consultations", value: String(overview.upcoming_appointments), href: "/firm/appointments?view=upcoming", ink: "text-dk-strong" },
        { label: "Unread client messages", value: String(overview.unread_messages), href: "/firm/matters", ink: "text-dk-strong" },
        { label: "Overdue tasks", value: String(overview.overdue_tasks), href: "/firm/matters", ink: "text-[#B42318]" },
        { label: "Client uploads to review", value: String(overview.client_uploads), href: "/firm/matters", ink: "text-dk-strong" },
        { label: "Service to acknowledge", value: String(overview.service_to_acknowledge), href: "/firm/inbox", ink: "text-[#92400E]" },
        { label: "Outstanding", value: formatMoneyByCurrency(overview.outstanding_by_currency, currency), href: "/firm/invoices", ink: "text-[#92400E]" },
        { label: "Collected this month", value: formatMoneyByCurrency(overview.collected_this_month_by_currency, currency), href: "/firm/invoices", ink: "text-dk-strong" },
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
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Firm overview</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · everything in {tz}
          </p>
        </div>
        <AppButtonLink href="/firm" variant="ghost-sm" className="self-start">
          Today
        </AppButtonLink>
      </header>

      {overview ? (
        <section aria-label="Firm totals" className="grid grid-cols-2 gap-[9px] sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="rounded-[11px] border border-dk-line bg-white p-[13px] shadow-card"
            >
              <span className="block text-[10.5px] uppercase leading-[1.35] tracking-[0.06em] text-dk-soft">
                {t.label}
              </span>
              <span className={cn("mt-[5px] block font-app-head text-[20px] font-bold leading-tight", t.ink)}>
                {t.value}
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <Alert kind="warning" title="Totals unavailable">
          The firm summary could not be read for {ctx.firmName}. The calendar, activity and attribution below are
          read straight from your matters and still hold.
        </Alert>
      )}

      <AppCard>
        <AppCardHeader title="Next 14 days" action={<AppLink href="/firm/sittings" className="-my-3 inline-flex min-h-[44px] items-center">Sittings</AppLink>} />
        {calendarCount === 0 ? (
          <AppEmpty
            title="Nothing listed in the next fortnight"
            hint="Court dates appear here as you post updates and next dates; consultations appear as clients book."
            action={<AppLink href="/firm/sittings" className="inline-flex min-h-[44px] items-center">Post a court update</AppLink>}
          />
        ) : (
          <AppCardBody>
            <Footnote className="mb-3">
              Court sittings and consultations, one column per day. On a phone, only days with something listed are shown.
            </Footnote>
            <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7">
              {days.map((d, index) => {
                const daySittings = sittings.filter((s) => bucketOf(s.scheduled_at) === d.ymd);
                const dayAppointments = appointments.filter((a) => bucketOf(a.starts_at) === d.ymd);
                const empty = daySittings.length + dayAppointments.length === 0;
                return (
                  <div
                    key={d.ymd}
                    className={cn(
                      "rounded-[11px] border bg-white p-3",
                      index === 0 ? "border-dk-pri" : "border-dk-line",
                      empty && "hidden sm:block",
                    )}
                  >
                    <p className="font-app-head text-[13px] font-semibold text-dk-strong">
                      {index === 0 ? "Today" : weekdayFmt.format(d.start)}
                    </p>
                    <p className="text-[11px] text-dk-muted">{dayFmt.format(d.start)}</p>
                    {empty ? (
                      <p className="mt-2 text-[11px] text-dk-muted">Clear</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-2">
                        {daySittings.map((s) => (
                          <li key={s.court_event_id}>
                            <Link
                              href={`/firm/matters/${s.matter_id}`}
                              className="block rounded-[8px] bg-dk-tint px-2 py-2"
                            >
                              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-dk-strong">
                                <ScalesIcon size={13} className="flex-none text-dk-soft" />
                                <span className="sr-only">Court sitting: </span>
                                <span className="font-mono">{formatWhen(s.scheduled_at, tz, { timeStyle: "short" })}</span>
                              </span>
                              <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-dk-body">{s.cause_title}</span>
                              <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-dk-muted">
                                {s.suit_number ?? s.reference}
                                {s.court ? ` · ${s.court}` : ""}
                                {s.courtroom ? ` · ${s.courtroom}` : ""}
                                {s.purpose || s.purpose_kind ? ` · ${s.purpose ?? (s.purpose_kind ?? "").replace("_", " ")}` : ""}
                              </span>
                            </Link>
                          </li>
                        ))}
                        {dayAppointments.map((a) => (
                          <li key={a.id}>
                            <Link
                              href={`/firm/appointments/${a.id}`}
                              className="block rounded-[8px] border border-dk-line px-2 py-2"
                            >
                              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-dk-strong">
                                <CalendarIcon size={13} className="flex-none text-dk-soft" />
                                <span className="sr-only">Consultation: </span>
                                <span className="font-mono">{formatWhen(a.starts_at, tz, { timeStyle: "short" })}</span>
                              </span>
                              <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-dk-body">
                                {a.client?.full_name ?? "Client"}
                              </span>
                              <span className="mt-0.5 block text-[10.5px] leading-[1.4] text-dk-muted">
                                {a.reference} · {a.mode.replace("_", " ")} · {a.status.replace("_", " ")}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </AppCardBody>
        )}
      </AppCard>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <AppCard>
          <AppCardHeader title="Latest activity" action={<AppLink href="/firm/matters" className="-my-3 inline-flex min-h-[44px] items-center">All matters</AppLink>} />
          {visibleFeed.length === 0 ? (
            <AppEmpty
              title="No updates posted yet"
              hint="Every court outcome, filing and note posted on a matter shows here, newest first."
              action={<AppLink href="/firm/sittings" className="inline-flex min-h-[44px] items-center">Post a court update</AppLink>}
            />
          ) : (
            <>
              <ol className="divide-y divide-dk-rule">
                {visibleFeed.map((u) => {
                  const matter = matterById.get(u.matter_id);
                  const internal = u.visibility === "internal";
                  const kind = KINDS[u.kind];
                  const Glyph = kind?.Icon;
                  return (
                    <li key={u.id} className="flex gap-[11px] px-[15px] py-[13px]">
                      <span
                        aria-hidden="true"
                        className="mt-[1px] grid h-7 w-7 flex-none place-items-center rounded-full bg-dk-rule text-dk-soft"
                      >
                        {Glyph ? <Glyph size={15} /> : <span className="h-[5px] w-[5px] rounded-full bg-dk-muted" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        {internal && (
                          <p className="mb-1">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E7B84B] bg-[#FFFBEB] px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] text-[#7A3E0A]">
                              <LockIcon size={12} className="flex-none" />
                              Internal — never shown to a client
                            </span>
                          </p>
                        )}
                        <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                          <span className="sr-only">{kind?.label ?? "Update"}. </span>
                          {u.title}
                        </p>
                        {u.body && (
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-dk-body">{u.body}</p>
                        )}
                        <p className="mt-[3px] text-[11px] leading-[1.45] text-dk-muted">
                          <Link
                            href={`/firm/matters/${u.matter_id}`}
                            className="font-medium text-dk-pri underline underline-offset-2"
                          >
                            {matter ? matter.cause_title ?? matter.title : "Open matter"}
                          </Link>
                          {matter ? ` · ${matter.reference}` : ""} · {formatWhen(u.occurred_at, tz)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="border-t border-dk-rule px-[15px] py-3">
                <Footnote>Entries marked internal are staff-only and never reach a client.</Footnote>
              </div>
            </>
          )}
        </AppCard>

        <AppCard>
          <AppCardHeader title="Originated against handling" />
          {attribution.length === 0 ? (
            <AppEmpty
              title="No colleagues on this firm yet"
              hint="Invite the rest of chambers, then set an originating and a handling lawyer on each matter."
              action={<AppLink href="/firm/matters" className="inline-flex min-h-[44px] items-center">Open a matter</AppLink>}
            />
          ) : (
            <>
              {/* One row per member rather than a four-column table: the console is
                  390px wide before it is anything else, and the numbers read as a
                  label-and-value line without a sideways scroll. */}
              <AppCardList>
                {attribution.map((row) => (
                  <div key={row.id} className="px-[15px] py-[13px]">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-semibold text-dk-strong">
                      {row.label}
                      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-dk-muted">{row.role}</span>
                    </p>
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] leading-[1.45] text-dk-soft">
                      <div>
                        <dt className="inline text-dk-muted">Originated: </dt>
                        <dd className="inline font-semibold tabular-nums text-dk-strong">{row.originated}</dd>
                      </div>
                      <div>
                        <dt className="inline text-dk-muted">Handling: </dt>
                        <dd className="inline font-semibold tabular-nums text-dk-strong">{row.handling}</dd>
                      </div>
                      {feesByLawyer && (
                        <div>
                          <dt className="inline text-dk-muted">Fees collected: </dt>
                          <dd className="inline font-semibold tabular-nums text-dk-strong">{feeLabel(row.fees)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}

                {(unattributedOriginated > 0 || unattributedHandling > 0) && (
                  <div className="px-[15px] py-[13px]">
                    <p className="text-[13.5px] font-semibold text-dk-soft">Not attributed</p>
                    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] leading-[1.45] text-dk-soft">
                      <div>
                        <dt className="inline text-dk-muted">Originated: </dt>
                        <dd className="inline font-semibold tabular-nums">{unattributedOriginated}</dd>
                      </div>
                      <div>
                        <dt className="inline text-dk-muted">Handling: </dt>
                        <dd className="inline font-semibold tabular-nums">{unattributedHandling}</dd>
                      </div>
                    </dl>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 bg-dk-tint px-[15px] py-[13px]">
                  <p className="text-[13.5px] font-semibold text-dk-strong">Total matters</p>
                  <p className="font-app-head text-[17px] font-bold tabular-nums leading-none text-dk-strong">
                    {matters.length}
                  </p>
                </div>
              </AppCardList>

              <div className="border-t border-dk-rule px-[15px] py-3">
                <Footnote>
                  {feesByLawyer
                    ? "Fees are payments received against invoices on each member's originated matters, in the currency they were paid."
                    : "Fees collected are not shown: the attribution view could not be read with your access."}
                  {" "}Origination is who brought the work in; handling is who runs it. Set both when you open or edit a matter.
                  {matters.length >= 500 ? " Counts cover the 500 most recently opened matters." : ""}
                  {feesByLawyer && feeRowsCapped ? ` Fees cover the ${FEE_SCAN.toLocaleString("en-GB")} most recent payments.` : ""}
                </Footnote>
              </div>
            </>
          )}
        </AppCard>
      </div>
    </div>
  );
}
