import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, EmptyState } from "@/components/ui/card";
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
  const when = (iso: string) =>
    view === "today"
      ? `Today, ${time(iso)}`
      : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));

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

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Consultations</h1>
        <p className="mt-0.5 text-[12.5px] text-[#57534E]">
          {view === "today" ? "Today" : view === "upcoming" ? "Upcoming" : "Past"}
          {ctx && ctx.memberships.length > 1 ? ` · ${ctx.firmName}` : ""} · times in {tz}
        </p>
      </div>

      <nav aria-label="Consultation views" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/firm/appointments?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium",
              view === key ? "border-[#141414] bg-[#141414] text-white" : "border-[#D6D3CE] bg-white text-[#57534E]",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={view === "today" ? "Nothing booked for today" : view === "upcoming" ? "No upcoming consultations" : "No past consultations"}
            hint="Confirmed bookings from the public site appear here."
          />
        ) : (
          <ul>
            {rows.map((a) => {
              const n = note(a);
              return (
                <li key={a.id}>
                  <Link
                    href={`/firm/appointments/${a.id}`}
                    className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0 hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-[#141414]">
                        {when(a.starts_at)} · {a.client?.full_name ?? "Client"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-[#57534E]">
                        <span className="font-mono">{a.reference}</span> · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}
                      </span>
                      {n && <span className={cn("mt-0.5 block text-[11.5px]", n.ink)}>{n.text}</span>}
                    </span>
                    <StatusPill status={a.status as Status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
