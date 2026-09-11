import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmNamesFor } from "@/lib/portal-data";
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { DEFAULT_TOKENS } from "@/lib/brand";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PushOptIn } from "@/components/push/push-opt-in";
import { LowDataToggle } from "@/components/portal/pwa-hints";
import { OfflineCopy } from "@/components/portal/offline-copy";
import { FirmRow, type FirmChoice } from "@/components/portal/firm-switcher";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { signOut } from "../actions";
import { signOutEverywhere, updateProfile } from "@/lib/actions/portal";

export const metadata = { title: "Profile" };

const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney"];

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const firms = await clientFirms(supabase);
  const [{ data }, { data: consentRows }, { data: matterRows }, firm] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, email, timezone, preferred_channel, quiet_hours_start, quiet_hours_end").eq("id", user.id).maybeSingle(),
    supabase.from("consent_records").select("id, firm_id, kind, version, accepted_at").eq("user_id", user.id).order("accepted_at", { ascending: false }).limit(50),
    supabase.from("matters").select("id").is("deleted_at", null).order("opened_at", { ascending: false }).limit(20),
    selectedFirm(supabase, firms),
  ]);
  const profile = (data ?? null) as { full_name: string | null; phone: string | null; email: string | null; timezone: string; preferred_channel: string; quiet_hours_start: string | null; quiet_hours_end: string | null } | null;
  const consents = (consentRows ?? []) as Array<{ id: string; firm_id: string | null; kind: string; version: string; accepted_at: string }>;
  const matterIds = ((matterRows ?? []) as Array<{ id: string }>).map((m) => m.id);
  const firmNames = await firmNamesFor(consents.map((c) => c.firm_id ?? "").filter(Boolean));
  const tz = profile?.timezone ?? "Africa/Lagos";
  const tzOptions = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];
  const label = "block text-[12.5px] font-semibold text-gray-700";
  // 16px so iOS Safari does not zoom the page on focus.
  const field = "mt-1.5 w-full rounded-[9px] border border-gray-300 px-3 py-[11px] text-base text-gray-900 focus:border-brand focus:outline-none";
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const choices: FirmChoice[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    meta: f.meta,
    primary: f.brand?.colours?.primary ?? DEFAULT_TOKENS.primary,
    heading: f.brand?.fonts?.heading ?? DEFAULT_TOKENS.headingFont,
    initial: f.name.trim().charAt(0).toUpperCase() || "·",
  }));

  return (
    <Screen>
      <ScreenTitle>Profile</ScreenTitle>
      {saved && <Alert kind="success">Saved.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardHeader title="Your details" />
        <CardBody>
          <form action={updateProfile} className="space-y-3.5">
            <div>
              <label htmlFor="fullName" className={label}>Full name</label>
              <input id="fullName" name="fullName" defaultValue={profile?.full_name ?? ""} maxLength={120} className={field} />
            </div>
            <div>
              <p className={label}>Phone</p>
              <p className="mt-1 text-[13.5px] text-gray-700">{profile?.phone ?? user.phone ?? "—"}</p>
              <p className="mt-0.5 text-[11.5px] text-gray-500">Sign-in number — contact your firm to change it.</p>
            </div>
            <div>
              <label htmlFor="email" className={label}>
                Email <span className="font-normal text-gray-500">(receipts and notifications)</span>
              </label>
              <input id="email" name="email" type="email" defaultValue={profile?.email ?? user.email ?? ""} maxLength={200} className={field} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="timezone" className={label}>Timezone</label>
                <select id="timezone" name="timezone" defaultValue={tz} className={field}>
                  {tzOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="preferredChannel" className={label}>Channel</label>
                <select id="preferredChannel" name="preferredChannel" defaultValue={profile?.preferred_channel ?? "sms"} className={field}>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="push">Push</option>
                  <option value="whatsapp">WhatsApp (coming later)</option>
                  <option value="in_app">In-app only</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="quietStart" className={label}>Quiet hours start</label>
                <input id="quietStart" name="quietStart" type="time" defaultValue={profile?.quiet_hours_start?.slice(0, 5) ?? ""} className={`${field} font-mono`} />
              </div>
              <div>
                <label htmlFor="quietEnd" className={label}>Quiet hours end</label>
                <input id="quietEnd" name="quietEnd" type="time" defaultValue={profile?.quiet_hours_end?.slice(0, 5) ?? ""} className={`${field} font-mono`} />
              </div>
            </div>
            <p className="text-[11.5px] leading-relaxed text-gray-500">During quiet hours, push, SMS and email wait until the hours end. In-app notifications and 10-minute consultation reminders are never held.</p>
            <Button type="submit">Save</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Notifications & data"
          action={<Link href="/app/notifications/preferences" className="text-[12.5px] font-medium text-brand underline underline-offset-2">Preferences</Link>}
        />
        <CardBody className="space-y-[15px]">
          <PushOptIn />
          <LowDataToggle />
          <OfflineCopy matterIds={matterIds} />
        </CardBody>
      </Card>

      {choices.length > 0 && (
        <Card>
          <CardHeader title="Your firms" />
          <ul>
            {choices.map((choice) => (
              <li key={choice.id} className="border-t border-gray-100 first:border-t-0">
                <FirmRow firm={choice} selected={choice.id === firm?.id} />
              </li>
            ))}
          </ul>
          <p className="border-t border-gray-100 px-[17px] py-3 text-[11.5px] leading-relaxed text-gray-500">
            One sign-in, whichever firms act for you. The app takes the colours and name of the firm you are reading.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader title="Consent history" />
        <CardBody>
          {consents.length === 0 ? <p className="text-[13px] text-gray-500">No consents recorded yet.</p> : (
            <ul className="divide-y divide-gray-100 text-[13px]">
              {consents.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2.5">
                  <span className="text-gray-700">{c.kind} <span className="text-gray-500">v{c.version}</span>{c.firm_id ? <span className="text-gray-500"> · {firmNames[c.firm_id] ?? "firm"}</span> : null}</span>
                  <span className="shrink-0 text-gray-500">{fmt.format(new Date(c.accepted_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex gap-2.5">
        <form action={signOut} className="flex-1"><Button type="submit" variant="ghost" size="lg" className="w-full">Sign out</Button></form>
        <form action={signOutEverywhere} className="flex-1"><Button type="submit" variant="ghost" size="lg" className="w-full">Sign out everywhere</Button></form>
      </div>
    </Screen>
  );
}
