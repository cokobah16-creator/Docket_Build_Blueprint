import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PushOptIn } from "@/components/push/push-opt-in";
import { PreferencesForm } from "./preferences-form";
import type { NotificationPreference } from "@/lib/db/types";

export const metadata = { title: "Notification preferences" };

export default async function PreferencesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const [{ data: prefs }, { data: profile }] = await Promise.all([
    supabase.from("notification_preferences").select("event, channel, enabled"),
    supabase.from("profiles").select("quiet_hours_start, quiet_hours_end, preferred_channel").eq("id", user.id).maybeSingle(),
  ]);
  const p = profile as { quiet_hours_start: string | null; quiet_hours_end: string | null; preferred_channel: string } | null;
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/app/notifications" className="text-brand underline">← Notifications</Link></p>
      <h1 className="font-heading text-2xl font-semibold text-brand">Notification preferences</h1>
      <Card>
        <CardHeader title="This device" />
        <CardBody><PushOptIn /></CardBody>
      </Card>
      <Card>
        <CardHeader title="What to send, and how" />
        <CardBody>
          <p className="mb-3 text-sm text-gray-600">
            In-app notifications are always on. Your preferred channel is <strong>{p?.preferred_channel ?? "sms"}</strong>
            {p?.quiet_hours_start && p?.quiet_hours_end ? <> and quiet hours are <strong>{p.quiet_hours_start.slice(0, 5)}–{p.quiet_hours_end.slice(0, 5)}</strong></> : null}. Change both on your <Link href="/app/profile" className="underline">profile</Link>.
          </p>
          <PreferencesForm initial={(prefs ?? []) as NotificationPreference[]} />
        </CardBody>
      </Card>
    </div>
  );
}
