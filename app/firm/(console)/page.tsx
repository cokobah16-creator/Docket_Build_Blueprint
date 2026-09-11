// Staff "Today": the day's appointments in the viewer's own zone, the standing
// chase list of sittings with no update posted, and the firm's counters — each
// counter linking to the screen that clears it.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS is
// the authorization (never a service key); timestamps are UTC in the database
// and rendered in ctx.timezone; money is integer minor units formatted with
// formatMoneyMinor; nothing firm-specific is hard-coded — the firm, its name,
// its zone and its currency all come from context.

import Link from "next/link";
import { staffContext, firmOverview, sittingsDue, firmStaff, staffLabel, requestedFirmId } from "@/lib/firm-data";
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { zonedDayRange, formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { PushOptIn } from "@/components/push/push-opt-in";
import { MatterSearch } from "@/components/firm/matter-search";
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

  // Counters are ink-black unless the number means something is late or is
  // waiting on this firm — the only colour the console spends. Each one opens
  // the exact queue it counts, filtered to what it counts: five of these used
  // to land on the bare matters list, where nothing said which matter.
  const counters = overview
    ? [
        { label: "Open matters", value: String(overview.open_matters), href: "/firm/matters?open=1", hint: "Every live file", ink: "text-[#141414]" },
        { label: "Court dates, 30 days", value: String(overview.court_dates_30d), href: "/firm/sittings", hint: "The cause list and the chase list", ink: "text-[#141414]" },
        // Two facts, kept apart: what the firm owes (shared) and what this person has not read.
        { label: "Awaiting reply", value: String(overview.threads_awaiting_reply ?? 0), href: "/firm/messages?view=awaiting", hint: overview.unread_messages > 0 ? `${overview.unread_messages} unread by you` : "Nothing unread by you", ink: (overview.threads_awaiting_reply ?? 0) > 0 ? "text-[#92400E]" : "text-[#141414]" },
        { label: "Overdue tasks", value: String(overview.overdue_tasks), href: "/firm/tasks?view=overdue", hint: (overview.next_actions_overdue ?? 0) > 0 ? `${overview.next_actions_overdue} next ${overview.next_actions_overdue === 1 ? "action" : "actions"} overdue too` : "Past their due date", ink: overview.overdue_tasks > 0 || (overview.next_actions_overdue ?? 0) > 0 ? "text-[#B42318]" : "text-[#141414]" },
        { label: "Uploads to review", value: String(overview.client_uploads), href: "/firm/uploads", hint: "Sent in by clients", ink: overview.client_uploads > 0 ? "text-[#92400E]" : "text-[#141414]" },
        { label: "Service to acknowledge", value: String(overview.service_to_acknowledge), href: "/firm/inbox", hint: "Served on your firm", ink: overview.service_to_acknowledge > 0 ? "text-[#92400E]" : "text-[#141414]" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Today</h1>
          <p className="mt-0.5 text-[12.5px] text-[#57534E]">
            {ctx.firmName} · {todayLabel}
          </p>
        </div>
        <PushOptIn compact />
      </header>

      {/* Search sits at the top of the feed: a lawyer arrives knowing the cause
          title or the suit number, not which screen it lives on. */}
      <MatterSearch />

      {/* The chase list first: a sitting nobody reported is the firm's biggest exposure. */}
      <Card className={cn(sittings.length > 0 && "border-[#E7B84B]")}>
        {sittings.length === 0 ? (
          <>
            <CardHeader
              title="Sittings without an update (0)"
              action={<Link href="/firm/sittings" className="text-[12.5px] font-medium text-[#141414] underline underline-offset-2">All</Link>}
            />
            <EmptyState
              title="Nothing to chase"
              hint="Every past sitting has an update against it. Post the next one as soon as the court rises."
              action={<Link href="/firm/sittings" className="text-[12.5px] font-medium text-[#141414] underline underline-offset-2">Post a court update</Link>}
            />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[#F3E2B3] bg-[#FFFBEB] px-[15px] py-3">
              <Icon name="warning" size={16} strokeWidth={1.8} className="shrink-0 text-[#92400E]" />
              <p className="min-w-0 text-[13.5px] font-bold text-[#7A3E0A]">
                Sittings without an update ({sittingsTotal})
              </p>
            </div>
            <ul>
              {sittings.map((s: SittingDue) => (
                <li key={s.court_event_id} className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold leading-snug text-[#141414]">{s.cause_title}</p>
                    <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[#57534E]">
                      <span className="font-mono">{s.suit_number ?? s.reference}</span>
                      {s.court ? ` · ${s.court}` : ""}
                    </p>
                    {(s.purpose || s.purpose_kind || (s.lawyer_id && staffById.has(s.lawyer_id))) && (
                      <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[#57534E]">
                        {s.purpose ?? (s.purpose_kind ?? "").replace("_", " ")}
                        {s.lawyer_id && staffById.has(s.lawyer_id) ? ` · ${staffById.get(s.lawyer_id)}` : ""}
                      </p>
                    )}
                    <p className="mt-1 text-[11.5px] font-semibold text-[#92400E]">
                      Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} · {sinceLabel(s.scheduled_at, nowMs)}
                    </p>
                  </div>
                  <Link
                    href={`/firm/matters/${s.matter_id}?tab=timeline#post-update`}
                    className={buttonClasses("neutral", "sm", "shrink-0 whitespace-nowrap")}
                  >
                    Post update
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {sittingsTotal > sittings.length && (
          <p className="border-t border-[#F0EEEA] px-[15px] py-3 text-[11.5px] text-[#57534E]">
            Showing the {sittings.length} that have waited longest.{" "}
            <Link href="/firm/sittings" className="underline underline-offset-2">See all {sittingsTotal}</Link>.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Today's consultations (${appointments.length})`}
          action={<Link href="/firm/appointments?view=upcoming" className="text-[12.5px] font-medium text-[#141414] underline underline-offset-2">All</Link>}
        />
        {appointments.length === 0 ? (
          <EmptyState
            title="Nothing booked for today"
            hint="Confirmed bookings appear here with a link to the consultation room."
            action={<Link href="/firm/appointments?view=upcoming" className="text-[12.5px] font-medium text-[#141414] underline underline-offset-2">See upcoming consultations</Link>}
          />
        ) : (
          <ul>
            {appointments.map((a) => {
              const live = roomOpen(a);
              return (
                <li key={a.id} className="flex items-start justify-between gap-2.5 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
                  <Link href={`/firm/appointments/${a.id}`} className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span className="shrink-0 pt-px font-mono text-[13px] font-bold text-[#141414]">
                      {formatWhen(a.starts_at, tz, { timeStyle: "short" })}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-[#141414]">{a.client?.full_name ?? "Client"}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[#57534E]">
                        <span className="font-mono">{a.reference}</span> · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}
                      </span>
                    </span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill status={a.status as Status} />
                    {live && (
                      <Link href={`/firm/appointments/${a.id}`} className={buttonClasses("neutral", "sm", "whitespace-nowrap")}>
                        Open room
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {overview ? (
        <>
          <section aria-label="Firm counters" className="grid grid-cols-2 gap-2.5">
            {counters.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className="rounded-[11px] border border-[#DDD9D2] bg-white p-3.5 hover:border-[#141414]"
              >
                <p className="text-[10.5px] uppercase leading-snug tracking-[0.06em] text-[#57534E]">{c.label}</p>
                <p className={cn("mt-1.5 font-heading text-2xl font-bold leading-none", c.ink)}>{c.value}</p>
                <p className="mt-1 text-[11px] leading-snug text-[#57534E]">{c.hint}</p>
              </Link>
            ))}
          </section>
          <Link
            href="/firm/invoices"
            className="flex items-center justify-between gap-3 rounded-[11px] border border-[#DDD9D2] bg-white px-[15px] py-3.5"
          >
            <span className="min-w-0">
              <span className="block text-[10.5px] uppercase tracking-[0.06em] text-[#57534E]">Outstanding</span>
              <span className="mt-1 block font-heading text-[22px] font-bold text-[#141414]">
                {formatMoneyByCurrency(overview.outstanding_by_currency, currency)}
              </span>
            </span>
            <span className={buttonClasses("ghost", "sm", "shrink-0 border-[#D6D3CE] text-[#141414]")}>Invoices</span>
          </Link>
        </>
      ) : (
        <Alert kind="warning" title="Counters unavailable">
          The firm summary could not be read for {ctx.firmName}. Your matters, inbox and invoices are still
          reachable from Me.
        </Alert>
      )}
    </div>
  );
}
