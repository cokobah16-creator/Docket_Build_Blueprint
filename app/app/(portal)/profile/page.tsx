import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmNamesFor } from "@/lib/portal-data";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PushOptIn } from "@/components/push/push-opt-in";
import { LowDataToggle } from "@/components/portal/pwa-hints";
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

  const [{ data }, { data: consentRows }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, email, timezone, preferred_channel, quiet_hours_start, quiet_hours_end").eq("id", user.id).maybeSingle(),
    supabase.from("consent_records").select("id, firm_id, kind, version, accepted_at").eq("user_id", user.id).order("accepted_at", { ascending: false }).limit(50),
  ]);
  const profile = (data ?? null) as { full_name: string | null; phone: string | null; email: string | null; timezone: string; preferred_channel: string; quiet_hours_start: string | null; quiet_hours_end: string | null } | null;
  const consents = (consentRows ?? []) as Array<{ id: string; firm_id: string | null; kind: string; version: string; accepted_at: string }>;
  const firmNames = await firmNamesFor(consents.map((c) => c.firm_id ?? "").filter(Boolean));
  const tz = profile?.timezone ?? "Africa/Lagos";
  const tzOptions = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];
  const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Profile</h1>
      {saved && <Alert kind="success">Saved.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardHeader title="Your details" />
        <CardBody>
          <form action={updateProfile} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="text-sm font-medium text-gray-900">Full name</label>
              <input id="fullName" name="fullName" defaultValue={profile?.full_name ?? ""} maxLength={120} className={field} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-900">Phone</label>
              <p className="mt-1 text-sm text-gray-700">{profile?.phone ?? user.phone ?? "—"} <span className="text-xs text-gray-500">(sign-in number; contact your firm to change it)</span></p>
            </div>
            <div>
              <label htmlFor="email" className="text-sm font-medium text-gray-900">Email (receipts and email notifications)</label>
              <input id="email" name="email" type="email" defaultValue={profile?.email ?? user.email ?? ""} maxLength={200} className={field} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="timezone" className="text-sm font-medium text-gray-900">Timezone</label>
                <select id="timezone" name="timezone" defaultValue={tz} className={field}>
                  {tzOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="preferredChannel" className="text-sm font-medium text-gray-900">Preferred channel</label>
                <select id="preferredChannel" name="preferredChannel" defaultValue={profile?.preferred_channel ?? "sms"} className={field}>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                  <option value="push">Push</option>
                  <option value="whatsapp">WhatsApp (coming later)</option>
                  <option value="in_app">In-app only</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="quietStart" className="text-sm font-medium text-gray-900">Quiet hours start</label>
                <input id="quietStart" name="quietStart" type="time" defaultValue={profile?.quiet_hours_start?.slice(0, 5) ?? ""} className={field} />
              </div>
              <div>
                <label htmlFor="quietEnd" className="text-sm font-medium text-gray-900">Quiet hours end</label>
                <input id="quietEnd" name="quietEnd" type="time" defaultValue={profile?.quiet_hours_end?.slice(0, 5) ?? ""} className={field} />
              </div>
            </div>
            <p className="text-xs text-gray-500">During quiet hours, push, SMS and email wait until the hours end. In-app notifications and 10-minute consultation reminders are never held.</p>
            <Button type="submit">Save</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notifications" action={<Link href="/app/notifications/preferences" className="text-sm text-brand underline">Preferences</Link>} />
        <CardBody className="space-y-4"><PushOptIn /><LowDataToggle /></CardBody>
      </Card>

      <Card>
        <CardHeader title="Consent history" />
        <CardBody>
          {consents.length === 0 ? <p className="text-sm text-gray-500">No consents recorded yet.</p> : (
            <ul className="divide-y divide-gray-100 text-sm">
              {consents.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2">
                  <span className="text-gray-800">{c.kind} <span className="text-gray-500">v{c.version}</span>{c.firm_id ? <span className="text-gray-500"> · {firmNames[c.firm_id] ?? "firm"}</span> : null}</span>
                  <span className="text-gray-500">{fmt.format(new Date(c.accepted_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <form action={signOut}><Button type="submit" variant="ghost" className="w-full">Sign out</Button></form>
        <form action={signOutEverywhere}><Button type="submit" variant="ghost" className="w-full">Sign out everywhere</Button></form>
      </div>
    </div>
  );
}
