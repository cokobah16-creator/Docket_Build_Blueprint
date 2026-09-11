import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { selectedFirm } from "@/lib/portal-firm";
import { Card } from "@/components/ui/card";
import { NotificationsList } from "@/components/portal/notifications-list";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import type { NotificationRow } from "@/lib/db/types";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const firm = await selectedFirm(supabase);

  let query = supabase
    .from("notifications")
    .select("id, firm_id, channel, event, payload, status, read_at, created_at")
    .eq("channel", "in_app");
  if (firm) query = query.eq("firm_id", firm.id);

  const [{ data }, tz] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(100),
    clientTimezone(supabase, user.id),
  ]);
  const rows = (data ?? []) as NotificationRow[];
  const firmNames = await firmNamesFor(rows.map((r) => r.firm_id ?? "").filter(Boolean));

  return (
    <>
      <ScreenHeader back="/app" title="Notifications" titleAs="heading">
        <Link href="/app/notifications/preferences" className="shrink-0 text-[12.5px] font-medium text-brand underline underline-offset-2">
          Preferences
        </Link>
      </ScreenHeader>
      <Screen>
        <Card>
          <NotificationsList rows={rows} firmNames={firmNames} timezone={tz} />
        </Card>
      </Screen>
    </>
  );
}
