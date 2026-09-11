// Staff "Today": the day's appointments in the viewer's own zone, the standing
// chase list of sittings with no update posted, and the firm's counters — each
// counter linking to the screen that clears it.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS is
// the authorization (never a service key); timestamps are UTC in the database
// and rendered in ctx.timezone; money is integer minor units formatted with
// formatMoneyMinor; nothing firm-specific is hard-coded — the firm, its name,
// its zone and its currency all come from context.
//
// Laid out as the artboard's lawyer feed (design/pwa): the chase list first
// because a sitting nobody reported is the firm's biggest exposure, then the
// day, then the counters. Colour is the console's only exception to neutral —
// overdue tasks and unacknowledged service carry their own ink, and both are
// named in words as well, never by colour alone.

import Link from "next/link";
import { staffContext, firmOverview, sittingsDue, firmStaff, staffLabel, requestedFirmId } from "@/lib/firm-data";
import { formatMoneyByCurrency } from "@/lib/money";
import { zonedDayRange, formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppButtonLink,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  AppStatusPill,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { CheckIcon, SearchIcon, WarningIcon } from "@/components/ui/icons";
import type { Status } from "@/components/ui/badge";
import type { SittingDue } from "@/lib/db/types";

export const metadata = { title: "Today" };

interface ApptRow {
  id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string;
  client: { full_name: string | null } | null;
  service: { name: string } | null;
}

/** "yesterday", "3 days ago", "2 weeks ago" — how long a sitting has gone unreported. */
function sinceLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const hours = Math.round((nowMs - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return rtf.format(-Math.max(1, hours), "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return rtf.format(-days, "day");
  if (days < 60) return rtf.format(-Math.round(days / 7), "week");
  return rtf.format(-Math.round(days / 30), "month");
}

export default async function StaffToday({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
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
  const { start, end } = zonedDayRange(tz);

  const [{ data: apptRows }, sittings, overview, { data: firmRow }, staff] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, reference, starts_at, ends_at, status, mode, client:profiles!appointments_client_id_fkey(full_name), service:services(name)")
      .eq("firm_id", firmId)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true }),
    sittingsDue(supabase, firmId),
    firmOverview(supabase, firmId),
    // firm_public is filtered to active firms, so a pending or suspended firm would
    // read null here and fall back to naira. firms_select (is_firm_member) already
    // shows staff their own row whatever its status, so read the table itself.
    supabase.from("firms").select("default_currency").eq("id", firmId).maybeSingle(),
    firmStaff(supabase, firmId),
  ]);

  const appointments = (apptRows ?? []) as unknown as ApptRow[];
  const currency = (firmRow as { default_currency: string } | null)?.default_currency ?? "NGN";
  // sittingsDue() caps the rows it fetches; firm_overview counts every one of them.
  // The heading must be the real number, and a cap that bites is said out loud below.
  const sittingsTotal = overview?.sittings_due ?? sittings.length;
  const staffById = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));
  const nowMs = Date.now();
  const todayLabel = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(new Date());

  // The consultation room opens 10 minutes before the start and closes an hour after the end.
  const roomOpen = (a: ApptRow) =>
    a.mode === "virtual" &&
    (a.status === "confirmed" || a.status === "rescheduled") &&
    nowMs >= new Date(a.starts_at).getTime() - 10 * 60 * 1000 &&
    nowMs <= new Date(a.ends_at).getTime() + 60 * 60 * 1000;

  // Six tiles, then Outstanding on its own. `ink` is the console's one use of
  // colour: a count that means somebody is late, or that process is sitting
  // unacknowledged. The label says the same thing in words.
  const counters = overview
    ? [
        { label: "Open matters", value: String(overview.open_matters), href: "/firm/matters", hint: "Every live file", ink: "text-dk-strong" },
        { label: "Court dates, 30 days", value: String(overview.court_dates_30d), href: "/firm/matters", hint: "The diary sits on each matter", ink: "text-dk-strong" },
        { label: "Unread messages", value: String(overview.unread_messages), href: "/firm/matters", hint: "Reply from the matter", ink: "text-dk-strong" },
        { label: "Overdue tasks", value: String(overview.overdue_tasks), href: "/firm/matters", hint: "Past their due date", ink: "text-[#B42318]" },
        { label: "Uploads to review", value: String(overview.client_uploads), href: "/firm/matters", hint: "Sent in by clients", ink: "text-dk-strong" },
        { label: "Service to acknowledge", value: String(overview.service_to_acknowledge), href: "/firm/inbox", hint: "Served on your firm", ink: "text-[#92400E]" },
      ]
    : [];

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Today</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · {todayLabel} · times in {tz}
          </p>
        </div>
        {/* Reaching this screen at all proves aal2 — the console layout redirects
            to enrolment otherwise — so the state is fact, not a claim. */}
        <Link
          href="/firm/security/mfa"
          className="flex min-h-[44px] flex-none items-center gap-1.5 self-start rounded-full border border-dk-line bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-dk-soft"
        >
          <CheckIcon size={12} className="text-[#16A34A]" />
          MFA
          <span className="sr-only">verified — two-factor is on for this session</span>
        </Link>
      </header>

      {/* Straight to the matter search: the thing a lawyer in a corridor is
          usually looking for is a file, by its suit number. */}
      <form method="get" action="/firm/matters" className="flex items-center gap-2">
        {firmParam && <input type="hidden" name="firm" value={firmParam} />}
        <label htmlFor="today-search" className="sr-only">
          Search matters by reference, cause title or suit number
        </label>
        <div className="flex min-h-[46px] flex-1 items-center gap-2.5 rounded-[10px] border border-dk-line bg-white px-[13px]">
          <SearchIcon size={17} className="flex-none text-dk-soft" />
          <input
            id="today-search"
            name="q"
            type="search"
            inputMode="search"
            maxLength={80}
            placeholder="Reference, cause title or suit number"
            className="w-full min-w-0 bg-transparent text-[13.5px] text-dk-strong placeholder:text-dk-muted focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="flex min-h-[46px] flex-none items-center rounded-[9px] border border-dk-field bg-white px-[13px] text-[12.5px] font-semibold text-dk-pri"
        >
          Search
        </button>
      </form>

      {/* The chase list first: a sitting nobody reported is the firm's biggest
          exposure. Its amber edge is the artboard's, and the warning icon and
          the heading carry the same message without it. */}
      <section className="overflow-hidden rounded-card border border-[#E7B84B] bg-white shadow-card">
        <header className="flex items-center justify-between gap-3.5 border-b border-[#F3E2B3] bg-[#FFFBEB] px-[15px] py-3">
          <h2 className="flex min-w-0 items-center gap-2 font-app-head text-[13.5px] font-bold text-[#7A3E0A]">
            <WarningIcon size={16} className="flex-none text-[#92400E]" />
            Sittings without an update ({sittingsTotal})
          </h2>
          <Link href="/firm/sittings" className="flex-none text-[12.5px] font-medium text-dk-pri underline underline-offset-2">
            All
          </Link>
        </header>
        {sittings.length === 0 ? (
          <AppEmpty
            title="Nothing to chase"
            hint="Every past sitting has an update against it. Post the next one as soon as the court rises."
            action={<AppLink href="/firm/sittings">Post a court update</AppLink>}
          />
        ) : (
          <AppCardList>
            {sittings.map((s: SittingDue) => (
              <div key={s.court_event_id} className="flex items-start justify-between gap-3 px-[15px] py-[13px]">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{s.cause_title}</p>
                  <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                    <span className="font-mono">{s.suit_number ?? s.reference}</span>
                    {s.court ? ` · ${s.court}` : ""}
                  </p>
                  {(s.purpose || s.purpose_kind || (s.lawyer_id && staffById.has(s.lawyer_id))) && (
                    <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                      {[
                        s.purpose ?? (s.purpose_kind ? s.purpose_kind.replace("_", " ") : null),
                        s.lawyer_id ? staffById.get(s.lawyer_id) ?? null : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <p className="mt-1 text-[11.5px] font-semibold leading-[1.45] text-[#92400E]">
                    Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {sinceLabel(s.scheduled_at, nowMs)}
                  </p>
                </div>
                <AppButtonLink
                  href={`/firm/matters/${s.matter_id}?tab=timeline#post-update`}
                  variant="primary-sm"
                  className="px-[14px] text-[12.5px]"
                >
                  Post update
                </AppButtonLink>
              </div>
            ))}
          </AppCardList>
        )}
        {sittingsTotal > sittings.length && (
          <Footnote className="px-[15px] pb-3.5">
            Showing the {sittings.length} that have waited longest.{" "}
            <Link href="/firm/sittings" className="text-dk-pri underline underline-offset-2">
              See all {sittingsTotal}
            </Link>
            .
          </Footnote>
        )}
      </section>

      <AppCard>
        <AppCardHeader
          title={`Today's consultations (${appointments.length})`}
          action={<AppLink href="/firm/appointments?view=upcoming">All</AppLink>}
        />
        {appointments.length === 0 ? (
          <AppEmpty
            title="Nothing booked for today"
            hint="Confirmed bookings appear here with a link to the consultation room."
            action={<AppLink href="/firm/appointments?view=upcoming">See upcoming consultations</AppLink>}
          />
        ) : (
          <AppCardList>
            {appointments.map((a) => {
              const live = roomOpen(a);
              return (
                <div key={a.id} className="flex items-start justify-between gap-2.5 px-[15px] py-[13px]">
                  <Link href={`/firm/appointments/${a.id}`} className="flex min-w-0 flex-1 items-start gap-[11px]">
                    <span className="flex-none pt-px font-mono text-[13px] font-bold text-dk-strong">
                      {formatWhen(a.starts_at, tz, { timeStyle: "short" })}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-dk-strong">
                        {a.client?.full_name ?? "Client"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-dk-soft">
                        <span className="font-mono">{a.reference}</span> · {a.service?.name ?? "Consultation"} ·{" "}
                        {a.mode.replace("_", " ")}
                      </span>
                    </span>
                  </Link>
                  <div className="flex flex-none flex-col items-end gap-2">
                    <AppStatusPill status={a.status as Status} />
                    {live && (
                      <AppButtonLink
                        href={`/firm/appointments/${a.id}`}
                        variant="primary-sm"
                        className="px-[13px] text-[12.5px]"
                      >
                        Open room
                      </AppButtonLink>
                    )}
                  </div>
                </div>
              );
            })}
          </AppCardList>
        )}
      </AppCard>

      {overview ? (
        <>
          <section aria-label="Firm counters" className="grid grid-cols-2 gap-[9px] md:grid-cols-3 lg:grid-cols-6">
            {counters.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className="rounded-[11px] border border-dk-line bg-white p-[13px] shadow-card"
              >
                <span className="block text-[10.5px] uppercase leading-[1.35] tracking-[0.06em] text-dk-soft">
                  {c.label}
                </span>
                <span className={`mt-[5px] block font-app-head text-[24px] font-bold leading-none ${c.ink}`}>
                  {c.value}
                </span>
                <span className="mt-1 block text-[11px] leading-[1.35] text-dk-soft">{c.hint}</span>
              </Link>
            ))}
          </section>

          <section className="flex items-center justify-between gap-3 rounded-[11px] border border-dk-line bg-white px-[15px] py-3.5 shadow-card">
            <div className="min-w-0">
              <p className="text-[10.5px] uppercase tracking-[0.06em] text-dk-soft">Outstanding</p>
              <p className="mt-1 font-app-head text-[22px] font-bold leading-none text-dk-strong">
                {formatMoneyByCurrency(overview.outstanding_by_currency, currency)}
              </p>
              <p className="mt-1.5 text-[11px] leading-[1.35] text-dk-soft">Issued and unpaid</p>
            </div>
            <AppButtonLink href="/firm/invoices" variant="ghost-sm" className="min-h-[44px]">
              Invoices
            </AppButtonLink>
          </section>
        </>
      ) : (
        <Alert kind="warning" title="Counters unavailable">
          The firm summary could not be read for {ctx.firmName}. Your matters, inbox and invoices are still
          reachable from the console navigation.
        </Alert>
      )}
    </div>
  );
}
