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
import { cn } from "@/lib/cn";
import { PushOptIn } from "@/components/push/push-opt-in";
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

  const counters = overview
    ? [
        { label: "Open matters", value: String(overview.open_matters), href: "/firm/matters", hint: "Every live file" },
        { label: "Court dates, 30 days", value: String(overview.court_dates_30d), href: "/firm/matters", hint: "The diary sits on each matter" },
        { label: "Unread client messages", value: String(overview.unread_messages), href: "/firm/matters", hint: "Reply from the matter's messages" },
        { label: "Overdue tasks", value: String(overview.overdue_tasks), href: "/firm/matters", hint: "Past their due date" },
        { label: "Client uploads to review", value: String(overview.client_uploads), href: "/firm/matters", hint: "Sent in by clients" },
        { label: "Service to acknowledge", value: String(overview.service_to_acknowledge), href: "/firm/inbox", hint: "Served on your firm" },
        { label: "Outstanding", value: formatMoneyByCurrency(overview.outstanding_by_currency, currency), href: "/firm/invoices", hint: "Issued and unpaid" },
      ]
    : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold text-brand">Today</h1>
          <p className="text-sm text-gray-600">
            {ctx.firmName} · {todayLabel} · times in {tz}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/firm/sittings"
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
          >
            Post a court update
          </Link>
          <PushOptIn compact />
        </div>
      </header>

      {/* The chase list first: a sitting nobody reported is the firm's biggest exposure. */}
      <Card className={cn(sittings.length > 0 && "border-amber-300")}>
        <CardHeader
          title={`Sittings without an update (${sittingsTotal})`}
          action={<Link href="/firm/sittings" className="text-sm text-brand underline">All sittings →</Link>}
        />
        {sittings.length === 0 ? (
          <EmptyState
            title="Nothing to chase"
            hint="Every past sitting has an update against it. Post the next one as soon as the court rises."
            action={<Link href="/firm/sittings" className="text-sm text-brand underline">Post a court update</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {sittings.map((s: SittingDue) => (
              <li key={s.court_event_id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{s.cause_title}</p>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {s.suit_number ?? s.reference}
                    {s.court ? ` · ${s.court}` : ""}
                    {s.purpose || s.purpose_kind ? ` · ${s.purpose ?? (s.purpose_kind ?? "").replace("_", " ")}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} · {sinceLabel(s.scheduled_at, nowMs)}
                    {s.lawyer_id && staffById.has(s.lawyer_id) ? ` · ${staffById.get(s.lawyer_id)}` : ""}
                  </p>
                </div>
                <Link
                  href={`/firm/matters/${s.matter_id}?tab=timeline#post-update`}
                  className="shrink-0 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
                >
                  Post update
                </Link>
              </li>
            ))}
          </ul>
        )}
        {sittingsTotal > sittings.length && (
          <p className="px-5 pb-4 text-xs text-gray-500">
            Showing the {sittings.length} that have waited longest.{" "}
            <Link href="/firm/sittings" className="text-brand underline">See all {sittingsTotal}</Link>.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Today's appointments (${appointments.length})`}
          action={<Link href="/firm/appointments?view=upcoming" className="text-sm text-brand underline">Upcoming →</Link>}
        />
        {appointments.length === 0 ? (
          <EmptyState
            title="Nothing booked for today"
            hint="Confirmed bookings appear here with a link to the consultation room."
            action={<Link href="/firm/appointments?view=upcoming" className="text-sm text-brand underline">See upcoming appointments</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {appointments.map((a) => {
              const live = roomOpen(a);
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                  <Link href={`/firm/appointments/${a.id}`} className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {formatWhen(a.starts_at, tz, { timeStyle: "short" })} · {a.client?.full_name ?? "Client"}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {a.reference} · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}
                    </p>
                  </Link>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <StatusPill status={a.status as Status} />
                    {live && (
                      <Link
                        href={`/firm/appointments/${a.id}`}
                        className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
                      >
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
        <section aria-label="Firm counters" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {counters.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="rounded-card border border-gray-200 bg-white p-4 shadow-sm hover:border-brand"
            >
              <p className="text-xs uppercase tracking-wide text-gray-500">{c.label}</p>
              <p className="mt-1 font-heading text-2xl font-semibold text-brand">{c.value}</p>
              <p className="mt-1 text-xs text-gray-500">{c.hint}</p>
            </Link>
          ))}
        </section>
      ) : (
        <Alert kind="warning" title="Counters unavailable">
          The firm summary could not be read for {ctx.firmName}. Your matters, inbox and invoices are still
          reachable from the console navigation.
        </Alert>
      )}
    </div>
  );
}
