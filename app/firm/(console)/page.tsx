// Staff "Today" screen: today's appointments with room links, plus the
// counters that later slices fill in (sittings without an update, messages).

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { zonedDayRange, formatWhen } from "@/lib/time";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { PushOptIn } from "@/components/push/push-opt-in";

export const metadata = { title: "Today" };

interface Row {
  id: string; reference: string; starts_at: string; status: string; mode: string;
  client: { full_name: string | null } | null; service: { name: string } | null;
}

export default async function StaffToday() {
  const supabase = await supabaseServer();
  let rows: Row[] = [];
  let tz = "Africa/Lagos";
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
      tz = (prof as { timezone: string } | null)?.timezone ?? tz;
    }
    const { start, end } = zonedDayRange(tz);
    const { data } = await supabase
      .from("appointments")
      .select("id, reference, starts_at, status, mode, client:profiles!appointments_client_id_fkey(full_name), service:services(name)")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at", { ascending: true });
    rows = (data ?? []) as unknown as Row[];
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-brand">Today</h1>
        <PushOptIn compact />
      </div>

      <Card>
        <CardHeader title={`Today's appointments (${rows.length})`} action={<Link href="/firm/appointments?view=upcoming" className="text-sm text-brand underline">Upcoming →</Link>} />
        {rows.length === 0 ? (
          <EmptyState title="Nothing booked for today" hint="Confirmed bookings appear here with a link to the consultation room." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {rows.map((a) => {
              const liveVirtual = a.mode === "virtual" && (a.status === "confirmed" || a.status === "rescheduled");
              return (
                <Link key={a.id} href={`/firm/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{formatWhen(a.starts_at, tz, { timeStyle: "short" })} · {a.client?.full_name ?? "Client"}</p>
                    <p className="truncate text-xs text-gray-500">{a.reference} · {a.service?.name ?? "Consultation"} · {a.mode.replace("_", " ")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {liveVirtual && <span className="text-xs font-medium text-brand">Open room →</span>}
                    <StatusPill status={a.status as Status} />
                  </div>
                </Link>
              );
            })}
          </CardBody>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Sittings without an update" />
          <EmptyState title="Nothing to chase" hint="Past court sittings with no update posted will surface here (slice 4)." />
        </Card>
        <Card>
          <CardHeader title="Unread messages" />
          <EmptyState title="No unread messages" hint="Client messages across your matters appear here (slice 4)." />
        </Card>
      </div>
    </div>
  );
}
