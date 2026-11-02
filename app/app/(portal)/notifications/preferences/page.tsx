import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { zoneLabel } from "@/lib/client-words";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PushOptIn } from "@/components/push/push-opt-in";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import { PreferencesForm } from "./preferences-form";
import type { NotificationPreference } from "@/lib/db/types";

export const metadata = { title: "Notification preferences" };

/** How each stored channel is said: never the code ("sms", "in_app"). */
const CHANNEL_WORDS: Record<string, string> = {
  sms: "by text message (SMS)",
  email: "by email",
  push: "by push notification",
  in_app: "in the app",
  whatsapp: "on WhatsApp",
};

export default async function PreferencesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const [{ data: prefs }, { data: profile }] = await Promise.all([
    supabase.from("notification_preferences").select("event, channel, enabled"),
    supabase.from("profiles").select("quiet_hours_start, quiet_hours_end, preferred_channel, timezone").eq("id", user.id).maybeSingle(),
  ]);
  const p = profile as { quiet_hours_start: string | null; quiet_hours_end: string | null; preferred_channel: string; timezone: string | null } | null;
  const channel = CHANNEL_WORDS[p?.preferred_channel ?? "sms"] ?? CHANNEL_WORDS.sms;
  // Quiet hours are kept in the client's own zone (enqueue_notification reads profiles.timezone),
  // so that is the zone they are given in.
  const quiet =
    p?.quiet_hours_start && p?.quiet_hours_end
      ? `${p.quiet_hours_start.slice(0, 5)} to ${p.quiet_hours_end.slice(0, 5)} ${zoneLabel(p.timezone)}`
      : null;

  return (
    <>
      <ScreenHeader back="/app/notifications" backLabel="Back to notifications" title="Notification preferences" titleAs="heading" />
      <Screen>
        <Card>
          <CardHeader title="This device" />
          <CardBody><PushOptIn quiet /></CardBody>
        </Card>
        <Card>
          <CardHeader title="What to send, and how" />
          <CardBody>
            <div className="mb-3 space-y-1 text-15 text-ink-muted">
              <p>Every notification also appears here in the app.</p>
              <p>You prefer to be reached {channel}.</p>
              {quiet ? (
                <p>
                  Your quiet hours are {quiet}. During them, text messages, emails and push notifications wait
                  until your quiet hours end, except a reminder that a consultation is about to start.
                </p>
              ) : (
                <p>You have not set any quiet hours.</p>
              )}
              <Link
                href="/app/profile"
                className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Change these on your profile
              </Link>
            </div>
            <PreferencesForm initial={(prefs ?? []) as NotificationPreference[]} />
          </CardBody>
        </Card>
      </Screen>
    </>
  );
}
