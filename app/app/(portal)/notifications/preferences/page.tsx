// Notification preferences: a pushed screen behind Notifications. Two cards —
// this device, and the event × channel matrix. The matrix is the one surface
// in the app that scrolls sideways; it does it inside its own scroller in
// PreferencesForm, so the screen itself never moves.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PREFERENCE_CHANNELS } from "@/lib/notifications-copy";
import {
  AppCard,
  AppCardBody,
  AppCardHeader,
  Footnote,
  PushedScreen,
  SubHeader,
  SubHeaderTitle,
} from "@/components/app";
import { PushOptIn } from "@/components/push/push-opt-in";
import { PreferencesForm } from "./preferences-form";
import type { NotificationPreference } from "@/lib/db/types";

export const metadata = { title: "Notification preferences" };

/** The channel's own label, so "sms" reads as SMS rather than as a column key. */
function channelLabel(channel: string): string {
  return PREFERENCE_CHANNELS.find((c) => c.channel === channel)?.label ?? channel;
}

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
  const quiet =
    p?.quiet_hours_start && p?.quiet_hours_end
      ? `${p.quiet_hours_start.slice(0, 5)}–${p.quiet_hours_end.slice(0, 5)}`
      : null;

  return (
    <PushedScreen
      header={
        <SubHeader backHref="/app/notifications" backLabel="Back to notifications">
          <SubHeaderTitle>Preferences</SubHeaderTitle>
        </SubHeader>
      }
    >
      <h1 className="sr-only">Notification preferences</h1>

      <AppCard>
        <AppCardHeader title="This device" />
        <AppCardBody>
          <PushOptIn />
        </AppCardBody>
      </AppCard>

      <AppCard>
        <AppCardHeader title="What to send, and how" />
        <AppCardBody className="flex flex-col gap-3.5">
          <p className="text-[12.5px] leading-[1.5] text-dk-soft">
            In-app notifications are always on. Your preferred channel is{" "}
            <span className="font-semibold text-dk-strong">
              {channelLabel(p?.preferred_channel ?? "sms")}
            </span>
            {quiet ? (
              <>
                {" "}and quiet hours are{" "}
                <span className="font-semibold text-dk-strong">{quiet}</span>
              </>
            ) : null}
            . Change both on your{" "}
            <Link
              href="/app/profile"
              className="font-medium text-dk-pri underline underline-offset-2"
            >
              profile
            </Link>
            .
          </p>
          <PreferencesForm initial={(prefs ?? []) as NotificationPreference[]} />
        </AppCardBody>
      </AppCard>

      <Footnote>
        Turning a channel off here stops that message on that channel only — it still
        arrives in the app, where this list started.
      </Footnote>
    </PushedScreen>
  );
}
