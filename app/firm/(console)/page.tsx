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
import { PracticeOverview } from "@/components/firm/practice-overview";
import { WithAside } from "@/components/shell/layout";
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
      <Alert kind="warning" title="Your workspace is unavailable">
        This account is not a member of a firm, or the workspace could not be reached. Ask your
        firm&apos;s owner to add you, or try again in a moment.
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

  // The firm's work queues. Each line is a count and the door to the exact
  // queue it counts. A count that means something is late or waiting on this
  // firm says so in words and in its tone; a zero is quiet.
  type Tone = "quiet" | "waiting" | "wrong";
  const queues: Array<{ label: string; value: number; href: string; hint: string; tone: Tone }> = overview
    ? [
        { label: "Open matters", value: overview.open_matters, href: "/firm/matters?open=1", hint: "Every live file", tone: "quiet" },
        { label: "Court dates, next 30 days", value: overview.court_dates_30d, href: "/firm/sittings", hint: "The cause list and the chase list", tone: "quiet" },
        {
          label: "Awaiting your firm's reply", value: overview.threads_awaiting_reply ?? 0, href: "/firm/messages?view=awaiting",
          hint: overview.unread_messages > 0 ? `${overview.unread_messages} unread by you` : "Nothing unread by you",
          tone: (overview.threads_awaiting_reply ?? 0) > 0 ? "waiting" : "quiet",
        },
        {
          label: "Overdue tasks", value: overview.overdue_tasks, href: "/firm/tasks?view=overdue",
          hint: (overview.next_actions_overdue ?? 0) > 0 ? `${overview.next_actions_overdue} next ${overview.next_actions_overdue === 1 ? "action" : "actions"} overdue too` : "Past their due date",
          tone: overview.overdue_tasks > 0 || (overview.next_actions_overdue ?? 0) > 0 ? "wrong" : "quiet",
        },
        { label: "Client uploads to review", value: overview.client_uploads, href: "/firm/uploads", hint: "Sent in by clients", tone: overview.client_uploads > 0 ? "waiting" : "quiet" },
        { label: "Service to acknowledge", value: overview.service_to_acknowledge, href: "/firm/inbox", hint: "Processes served on your firm", tone: overview.service_to_acknowledge > 0 ? "waiting" : "quiet" },
      ]
    : [];
  const toneInk: Record<Tone, string> = { quiet: "text-ink-strong", waiting: "text-waiting-ink", wrong: "text-wrong-ink" };

  const counterCards = overview && (
    <section aria-labelledby="queues-heading" className="overflow-hidden rounded-card border border-hairline bg-raised">
      <h2 id="queues-heading" className="flex min-h-11 items-center border-b border-hairline bg-sunken px-3 text-13 font-semibold text-ink-strong">
        Work queues
      </h2>
      <ul className="divide-y divide-hairline">
        {queues.map((q) => (
          <li key={q.label}>
            <Link href={q.href} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 hover:bg-hover">
              <span className="min-w-0">
                <span className="block text-13 font-medium text-ink">{q.label}</span>
                <span className="block text-11 text-ink-muted">{q.hint}</span>
              </span>
              <span className={cn("shrink-0 text-17 font-semibold tabular-nums", toneInk[q.tone])}>
                {q.value}
                {q.tone !== "quiet" && q.value > 0 && <span className="sr-only"> — needs attention</span>}
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link href="/firm/invoices" className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 hover:bg-hover">
            <span className="min-w-0">
              <span className="block text-13 font-medium text-ink">Outstanding fees</span>
              <span className="block text-11 text-ink-muted">Issued, part-paid or overdue</span>
            </span>
            <span className="shrink-0 text-13 font-semibold tabular-nums text-ink-strong">
              {formatMoneyByCurrency(overview.outstanding_by_currency, currency)}
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="workspace-heading flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="workspace-title">Today</h1><p className="text-13 text-ink-muted">{todayLabel} · {ctx.firmName}</p></div>
        <PushOptIn compact />
      </header>

      <PracticeOverview ctx={ctx} />

      <WithAside
        from="xl"
        aside={
          counterCards || (
            <Alert kind="warning" title="Counters unavailable">
              The firm summary could not be read for {ctx.firmName}. Your matters, inbox and invoices
              are still reachable from the navigation.
            </Alert>
          )
        }
      >
        {/* The chase list first: a sitting nobody reported is the firm's biggest exposure. */}
        <Card className={cn(sittings.length > 0 && "border-waiting-line")}>
          {sittings.length === 0 ? (
            <>
              <CardHeader
                title="Sittings without an update (0)"
                action={<Link href="/firm/sittings" className="text-13 font-medium text-ink-strong underline underline-offset-2">All</Link>}
              />
              <EmptyState
                title="Nothing to chase"
                hint="Every past sitting has an update against it. Post the next one as soon as the court rises."
                action={<Link href="/firm/sittings" className="text-13 font-medium text-ink-strong underline underline-offset-2">Post a court update</Link>}
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-waiting-line bg-waiting-bg px-3 py-2.5">
                <Icon name="warning" size={16} strokeWidth={1.8} className="shrink-0 text-waiting-ink" />
                <p className="min-w-0 text-13 font-semibold text-waiting-ink">
                  Sittings without an update ({sittingsTotal})
                </p>
              </div>
              <ul>
                {sittings.map((s: SittingDue) => (
                  <li
                    key={s.court_event_id}
                    className="flex flex-col gap-2.5 border-t border-hairline px-3 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-semibold leading-snug text-ink-strong">{s.cause_title}</p>
                      <p className="mt-0.5 text-11 leading-[1.45] text-ink-muted">
                        <span className="font-mono">{s.suit_number ?? s.reference}</span>
                        {s.court ? ` · ${s.court}` : ""}
                      </p>
                      {(s.purpose || s.purpose_kind || (s.lawyer_id && staffById.has(s.lawyer_id))) && (
                        <p className="mt-0.5 text-11 leading-[1.45] text-ink-muted">
                          {s.purpose ?? (s.purpose_kind ?? "").replace("_", " ")}
                          {s.lawyer_id && staffById.has(s.lawyer_id) ? ` · ${staffById.get(s.lawyer_id)}` : ""}
                        </p>
                      )}
                      <p className="mt-1 text-11 font-semibold text-waiting-ink">
                        Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} · {sinceLabel(s.scheduled_at, nowMs)}
                      </p>
                    </div>
                    <Link
                      href={`/firm/matters/${s.matter_id}?tab=timeline#post-update`}
                      className={buttonClasses("neutral", "sm", "w-full shrink-0 whitespace-nowrap sm:w-auto")}
                    >
                      Post update
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sittingsTotal > sittings.length && (
            <p className="border-t border-hairline px-3 py-3 text-11 text-ink-muted">
              Showing the {sittings.length} that have waited longest.{" "}
              <Link href="/firm/sittings" className="underline underline-offset-2">See all {sittingsTotal}</Link>.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title={`Today's consultations (${appointments.length})`}
            action={<Link href="/firm/appointments?view=upcoming" className="text-13 font-medium text-ink-strong underline underline-offset-2">All</Link>}
          />
          {appointments.length === 0 ? (
            <EmptyState
              title="Nothing booked for today"
              hint="Confirmed bookings appear here with a link to the consultation room."
              action={<Link href="/firm/appointments?view=upcoming" className="text-13 font-medium text-ink-strong underline underline-offset-2">See upcoming consultations</Link>}
            />
          ) : (
            <ul>
              {appointments.map((a) => {
                const live = roomOpen(a);
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-2 border-t border-hairline px-3 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-2.5"
                  >
                    <Link href={`/firm/appointments/${a.id}`} className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5">
                      <span className="shrink-0 pt-px font-mono text-13 font-bold text-ink-strong">
                        {formatWhen(a.starts_at, tz, { timeStyle: "short" })}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-13 font-semibold text-ink-strong">{a.client?.full_name ?? "Client"}</span>
                        <span className="mt-0.5 block truncate text-11 text-ink-muted">
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
      </WithAside>
    </div>
  );
}
