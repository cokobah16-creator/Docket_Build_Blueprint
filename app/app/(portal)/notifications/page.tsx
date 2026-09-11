import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone, firmNamesFor } from "@/lib/portal-data";
import { AppCard, AppLink, PushedScreen, SubHeader, SubHeaderTitle } from "@/components/app";
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
    <PushedScreen
      header={
        <SubHeader backHref="/app" backLabel="Back to home">
          <SubHeaderTitle>Notifications</SubHeaderTitle>
          <AppLink
            href="/app/notifications/preferences"
            className="ml-auto inline-flex min-h-[44px] items-center"
          >
            Preferences
          </AppLink>
        </SubHeader>
      }
    >
      <AppCard>
        <NotificationsList rows={rows} firmNames={firmNames} timezone={tz} />
      </AppCard>
    </PushedScreen>
  );
}
