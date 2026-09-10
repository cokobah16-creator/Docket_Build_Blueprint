import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { Card } from "@/components/ui/card";
import { NotificationsList } from "@/components/portal/notifications-list";
import type { NotificationRow } from "@/lib/db/types";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const [{ data }, tz] = await Promise.all([
    supabase.from("notifications").select("id, firm_id, channel, event, payload, status, read_at, created_at").eq("channel", "in_app").order("created_at", { ascending: false }).limit(100),
    clientTimezone(supabase, user.id),
  ]);
  const rows = (data ?? []) as NotificationRow[];
  const firmNames = await firmNamesFor(rows.map((r) => r.firm_id ?? "").filter(Boolean));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-brand">Notifications</h1>
        <Link href="/app/notifications/preferences" className="text-sm text-brand underline">Preferences</Link>
      </div>
      <Card><NotificationsList rows={rows} firmNames={firmNames} timezone={tz} /></Card>
    </div>
  );
}
