import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { zonedDayRange } from "@/lib/time";

export const metadata = { title: "Appointments" };

interface Row {
  id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string;
  client: { full_name: string | null; phone: string | null } | null;
  service: { name: string } | null;
}

type View = "today" | "upcoming" | "past";

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

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Appointments</h1>
      <nav aria-label="Appointment views" className="flex gap-2">
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={`/firm/appointments?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", view === key ? "border-brand bg-brand text-brand-on" : "border-gray-300 text-gray-700 hover:border-brand")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={view === "today" ? "Nothing booked for today" : view === "upcoming" ? "No upcoming appointments" : "No past appointments"} hint="Confirmed bookings from the public site appear here." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {rows.map((a) => {
              const liveVirtual = a.mode === "virtual" && (a.status === "confirmed" || a.status === "rescheduled");
              return (
                <Link key={a.id} href={`/firm/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {new Intl.DateTimeFormat("en-GB", { dateStyle: view === "today" ? undefined : "medium", timeStyle: "short", timeZone: tz }).format(new Date(a.starts_at))}
                      {" · "}{a.client?.full_name ?? "Client"}
                    </p>
                    <p className="truncate text-xs text-gray-500">{a.reference} · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {liveVirtual && <span className="hidden text-xs font-medium text-brand sm:inline">Room →</span>}
                    <StatusPill status={a.status as Status} />
                  </div>
                </Link>
              );
            })}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
