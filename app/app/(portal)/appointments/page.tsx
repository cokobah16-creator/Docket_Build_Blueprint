import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, EmptyState, CardBody } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";

export const metadata = { title: "Appointments" };

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  status: string;
  mode: string;
  client_timezone: string | null;
}

export default async function AppointmentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("appointments")
    .select("id, reference, starts_at, status, mode, client_timezone")
    .order("starts_at", { ascending: false })
    .limit(20);
  const appointments = (data ?? []) as AppointmentRow[];

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Appointments</h1>
      <Card>
        {appointments.length === 0 ? (
          <EmptyState
            title="No consultations yet"
            hint="Your booked consultations appear here with their reference and status."
          />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {appointments.map((a) => (
              <Link key={a.id} href={`/app/appointments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Intl.DateTimeFormat("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: a.client_timezone ?? "Africa/Lagos",
                    }).format(new Date(a.starts_at))}
                  </p>
                  <p className="text-xs text-gray-500">
                    {a.reference} · {a.mode}
                  </p>
                </div>
                <StatusPill status={a.status as Status} />
              </Link>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
