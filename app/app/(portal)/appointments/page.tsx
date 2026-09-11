import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { selectedFirm } from "@/lib/portal-firm";
import { Card, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Screen, ScreenTitle } from "@/components/portal/screen";

export const metadata = { title: "Appointments" };

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  status: string;
  mode: string;
  client_timezone: string | null;
  service_id: string | null;
}

export default async function AppointmentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const firm = await selectedFirm(supabase);

  let query = supabase
    .from("appointments")
    .select("id, reference, starts_at, status, mode, client_timezone, service_id");
  if (firm) query = query.eq("firm_id", firm.id);
  const { data } = await query.order("starts_at", { ascending: false }).limit(20);
  const appointments = (data ?? []) as AppointmentRow[];

  // One lookup for the service names rather than one per row.
  const serviceIds = Array.from(new Set(appointments.map((a) => a.service_id).filter((v): v is string => Boolean(v))));
  const { data: serviceRows } = serviceIds.length
    ? await supabase.from("services").select("id, name").in("id", serviceIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const serviceName = new Map(((serviceRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));

  return (
    <Screen>
      <ScreenTitle>Appointments</ScreenTitle>
      <Card>
        {appointments.length === 0 ? (
          <EmptyState
            title="No consultations yet"
            hint="Your booked consultations appear here with their status and join button."
          />
        ) : (
          <ul>
            {appointments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/app/appointments/${a.id}`}
                  className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3.5 first:border-t-0 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {new Intl.DateTimeFormat("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: a.client_timezone ?? "Africa/Lagos",
                      }).format(new Date(a.starts_at))}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      <span className="font-mono">{a.reference}</span> · {a.mode.replace("_", " ")}
                    </p>
                    {a.service_id && serviceName.has(a.service_id) && (
                      <p className="mt-0.5 text-xs text-gray-600">{serviceName.get(a.service_id)}</p>
                    )}
                  </div>
                  <StatusPill status={a.status as Status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {firm && (
        <Link href={`/${firm.slug}/book`} className={buttonClasses("primary", "lg", "w-full")}>
          Book a Consultation
        </Link>
      )}
    </Screen>
  );
}
