// Consultations: one card of rows, the day's or the next fifty, in the
// viewer's own zone. The artboard's lawyer list (design/pwa) — when and who on
// the first line, the reference, the service and the mode on the second, and a
// note in its own ink on the third saying the one thing about this booking that
// is worth knowing before you tap it.

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { AppCard, AppCardList, AppEmpty, AppStatusPill, ScreenTitle } from "@/components/app";
import type { Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { zonedDayRange } from "@/lib/time";

export const metadata = { title: "Appointments" };

interface Row {
  id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string;
  client: { full_name: string | null; phone: string | null } | null;
  service: { name: string } | null;
}

type View = "today" | "upcoming" | "past";

/**
 * The third line. Everything here is read off the row itself — the room window
 * is the same ten-minutes-before rule the console and the client app both keep,
 * and nothing is claimed that the query did not fetch.
 */
function noteFor(a: Row, nowMs: number): { text: string; ink: string } | null {
  const live =
    a.mode === "virtual" &&
    (a.status === "confirmed" || a.status === "rescheduled") &&
    nowMs >= new Date(a.starts_at).getTime() - 10 * 60 * 1000 &&
    nowMs <= new Date(a.ends_at).getTime() + 60 * 60 * 1000;
  if (live) return { text: "Room open now", ink: "text-[#15803D]" };
  if (a.status === "pending" || a.status === "awaiting_payment")
    return { text: "Not confirmed until the fee is paid", ink: "text-[#92400E]" };
  if (a.mode === "virtual" && (a.status === "confirmed" || a.status === "rescheduled"))
    return { text: "Room opens ten minutes before the start", ink: "text-dk-soft" };
  if (a.client?.phone) return { text: a.client.phone, ink: "text-dk-soft" };
  return null;
}

export default async function FirmAppointments({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: rawView } = await searchParams;
  const view: View = rawView === "upcoming" || rawView === "past" ? rawView : "today";
  const supabase = await supabaseServer();

  let rows: Row[] = [];
  let tz = "Africa/Lagos";
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
      tz = (prof as { timezone: string } | null)?.timezone ?? tz;
    }
    const { start: startUtc, end: endUtc } = zonedDayRange(tz);

    let q = supabase
      .from("appointments")
      .select("id, reference, starts_at, ends_at, status, mode, client:profiles!appointments_client_id_fkey(full_name, phone), service:services(name)");
    if (view === "today") q = q.gte("starts_at", startUtc.toISOString()).lt("starts_at", endUtc.toISOString()).order("starts_at", { ascending: true });
    if (view === "upcoming") q = q.gte("starts_at", endUtc.toISOString()).order("starts_at", { ascending: true }).limit(50);
    if (view === "past") q = q.lt("starts_at", startUtc.toISOString()).order("starts_at", { ascending: false }).limit(50);
    const { data } = await q;
    rows = (data ?? []) as unknown as Row[];
  }

  const tabs: Array<[View, string]> = [["today", "Today"], ["upcoming", "Upcoming"], ["past", "Past"]];
  const viewLabel = tabs.find(([key]) => key === view)?.[1] ?? "Today";
  const nowMs = Date.now();
  const when = new Intl.DateTimeFormat("en-GB", {
    dateStyle: view === "today" ? undefined : "medium",
    timeStyle: "short",
    timeZone: tz,
  });

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header>
        <ScreenTitle>Consultations</ScreenTitle>
        <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
          {viewLabel} · times in {tz}
        </p>
      </header>

      <nav aria-label="Appointment views" className="-mx-1 flex gap-[7px] overflow-x-auto px-1 pb-0.5">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/firm/appointments?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "flex min-h-[44px] flex-none items-center rounded-full border px-3.5 text-[12.5px] font-medium",
              view === key
                ? "border-dk-pri bg-dk-pri text-dk-on-pri"
                : "border-dk-field bg-white text-dk-soft",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <AppCard>
        {rows.length === 0 ? (
          <AppEmpty
            title={view === "today" ? "Nothing booked for today" : view === "upcoming" ? "No upcoming consultations" : "No past consultations"}
            hint="Confirmed bookings from the public site appear here."
          />
        ) : (
          <AppCardList>
            {rows.map((a) => {
              const note = noteFor(a, nowMs);
              return (
                <Link
                  key={a.id}
                  href={`/firm/appointments/${a.id}`}
                  className="flex items-start justify-between gap-3 px-[15px] py-[13px]"
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold leading-snug text-dk-strong">
                      {when.format(new Date(a.starts_at))} · {a.client?.full_name ?? "Client"}
                    </span>
                    <span className="mt-[3px] block text-[11.5px] leading-[1.45] text-dk-soft">
                      <span className="font-mono">{a.reference}</span> · {a.service?.name ?? "Consultation"} ·{" "}
                      {a.mode.replace("_", " ")}
                    </span>
                    {note && (
                      <span className={cn("mt-0.5 block text-[11.5px] leading-[1.45]", note.ink)}>{note.text}</span>
                    )}
                  </span>
                  <AppStatusPill status={a.status as Status} />
                </Link>
              );
            })}
          </AppCardList>
        )}
      </AppCard>
    </div>
  );
}
