// Staff "Today" screen. Slice 0 proves the gate and shows live counts;
// the full Today view (join buttons, sittings without an update, court
// update form) lands in slices 2 and 4.

import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Today" };

export default async function StaffToday() {
  const supabase = await supabaseServer();

  let todayCount = 0;
  if (supabase) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const { count } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("starts_at", startOfDay.toISOString())
      .lt("starts_at", endOfDay.toISOString());
    todayCount = count ?? 0;
  }

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Today</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader title="Today's appointments" />
          <CardBody>
            <p className="text-3xl font-semibold text-gray-900">{todayCount}</p>
            <p className="mt-1 text-sm text-gray-500">
              Join buttons and the consultation room arrive in slice 2.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sittings without an update" />
          <EmptyState
            title="Nothing to chase"
            hint="Past court sittings with no update posted will surface here (slice 4)."
          />
        </Card>

        <Card>
          <CardHeader title="Unread messages" />
          <EmptyState
            title="Client messaging is in build"
            hint="Client messages across your matters appear here (slice 4)."
          />
        </Card>
      </div>
    </div>
  );
}
