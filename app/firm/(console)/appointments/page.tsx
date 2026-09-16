import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { PageHeader } from "@/components/shell/layout";
import { StatusPill, type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { zonedDayRange } from "@/lib/time";
import { requestedFirmId, staffContext } from "@/lib/firm-data";

export const metadata = { title: "Consultations" };

interface Row {
  id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string;
  hold_expires_at: string | null;
  client: { full_name: string | null; phone: string | null } | null;
  service: { name: string } | null;
}

type View = "today" | "upcoming" | "past";

export default async function FirmAppointments({ searchParams }: { searchParams: Promise<{ view?: string; firm?: string }> }) {
  const { view: rawView, firm: firmParam } = await searchParams;
  const view: View = rawView === "upcoming" || rawView === "past" ? rawView : "today";
  // One firm's diary. RLS would let a member of two firms read both, and this screen used to
  // show them merged with nothing saying which was which.
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));
  const supabase = ctx?.supabase ?? null;

  let rows: Row[] = [];
  const tz = ctx?.timezone ?? "Africa/Lagos";
  if (supabase && ctx) {
    const { start: startUtc, end: endUtc } = zonedDayRange(tz);

    let q = supabase
      .from("appointments")
      .select("id, reference, starts_at, ends_at, status, mode, hold_expires_at, client:profiles!appointments_client_id_fkey(full_name, phone), service:services(name)")
      .eq("firm_id", ctx.firmId);
    if (view === "today") q = q.gte("starts_at", startUtc.toISOString()).lt("starts_at", endUtc.toISOString()).order("starts_at", { ascending: true });
    if (view === "upcoming") q = q.gte("starts_at", endUtc.toISOString()).order("starts_at", { ascending: true }).limit(50);
    if (view === "past") q = q.lt("starts_at", startUtc.toISOString()).order("starts_at", { ascending: false }).limit(50);
    const { data } = await q;
    rows = (data ?? []) as unknown as Row[];
  }

  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(new Date(iso));

  /**
   * The one line that says what this consultation needs from the firm. An
   * unpaid hold is the only one that is actually urgent, so it is the only one
   * that gets colour.
   */
  const note = (a: Row): { text: string; ink: string } | null => {
    if (a.status === "awaiting_payment") {
      return {
        text: a.hold_expires_at
          ? `Hold expires ${time(a.hold_expires_at)} — nothing is booked yet`
          : "Not paid — nothing is booked yet",
        ink: "text-[#92400E]",
      };
    }
    if (a.status === "pending") return { text: "Held — yours to confirm once what you asked for is in", ink: "text-[#92400E]" };
    if (a.status === "rescheduled") return { text: "Rescheduled", ink: "text-[#57534E]" };
    if (a.mode === "virtual" && a.status === "confirmed") {
      return { text: `Room opens ${time(new Date(new Date(a.starts_at).getTime() - 10 * 60 * 1000).toISOString())}`, ink: "text-[#15803D]" };
    }
    return null;
  };

  const tabs: Array<[View, string]> = [["today", "Today"], ["upcoming", "Upcoming"], ["past", "Past"]];

  // Grouped by day so a week of "upcoming" reads as a diary rather than a list.
  // Today's view is one day by definition, so it keeps a single heading.
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(new Date(iso));
  const days: Array<[string, Row[]]> = [];
  for (const r of rows) {
    const key = dayKey(r.starts_at);
    const last = days[days.length - 1];
    if (last && last[0] === key) last[1].push(r);
    else days.push([key, [r]]);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        tone="neutral"
        title="Consultations"
        description={`${view === "today" ? "Today" : view === "upcoming" ? "Upcoming" : "Past"}${ctx && ctx.memberships.length > 1 ? ` · ${ctx.firmName}` : ""} · times in ${tz}`}
      />

      <nav aria-label="Consultation views" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/firm/appointments?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium",
              view === key ? "border-[#141414] bg-[#141414] text-white" : "border-[#D6D3CE] bg-raised text-[#57534E]",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* A diary row is a time, a name and a status. Left to fill a 1400px
          workspace it becomes a name at one edge and a pill at the other, so
          the agenda keeps its own width and the rest of the desk stays empty. */}
      <div className="flex flex-col gap-4 xl:max-w-4xl">
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={view === "today" ? "Nothing booked for today" : view === "upcoming" ? "No upcoming consultations" : "No past consultations"}
            hint="Confirmed bookings from the public site appear here."
          />
        </Card>
      ) : (
        days.map(([day, inDay]) => (
          <Card key={day}>
            <CardHeader title={day} />
            <ul>
              {inDay.map((a) => {
                const n = note(a);
                return (
                  <li key={a.id}>
                    <Link
                      href={`/firm/appointments/${a.id}`}
                      className="flex flex-col gap-1.5 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0 hover:bg-sunken sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        {/* The time is the column a diary is read down. */}
                        <span className="w-[52px] shrink-0 font-mono text-[13px] font-bold text-[#141414]">
                          {time(a.starts_at)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-[#141414]">
                            {a.client?.full_name ?? "Client"}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-[#57534E]">
                            <span className="font-mono">{a.reference}</span> · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}
                          </span>
                          {n && <span className={cn("mt-0.5 block text-[11.5px]", n.ink)}>{n.text}</span>}
                        </span>
                      </span>
                      <StatusPill status={a.status as Status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
      </div>
    </div>
  );
}
