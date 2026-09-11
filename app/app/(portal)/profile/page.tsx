import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { readableForeground } from "@/lib/brand";
import { firmAppHref } from "@/lib/tenant";
import { clientFirms, firmMeta, firmNamesFor } from "@/lib/portal-data";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppLink,
  AppScreen,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { PushOptIn } from "@/components/push/push-opt-in";
import { LowDataToggle } from "@/components/portal/pwa-hints";
import { OfflineCopyRow } from "@/components/portal/connection";
import { FirmList, type FirmChoice } from "@/components/portal/firm-switcher";
import { signOut } from "../actions";
import { signOutEverywhere, updateProfile } from "@/lib/actions/portal";

export const metadata = { title: "Profile" };

const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Asia/Dubai", "Asia/Kolkata", "Australia/Sydney"];

const labelClass = "block text-[12.5px] font-semibold text-dk-body";
const fieldClass =
  "mt-1.5 w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong focus:border-dk-pri focus:outline-none";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const [{ data }, { data: consentRows }, firms, firm] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, email, timezone, preferred_channel, quiet_hours_start, quiet_hours_end").eq("id", user.id).maybeSingle(),
    supabase.from("consent_records").select("id, firm_id, kind, version, accepted_at").eq("user_id", user.id).order("accepted_at", { ascending: false }).limit(50),
    clientFirms(supabase),
    currentFirm(),
  ]);
  const profile = (data ?? null) as { full_name: string | null; phone: string | null; email: string | null; timezone: string; preferred_channel: string; quiet_hours_start: string | null; quiet_hours_end: string | null } | null;
  const consents = (consentRows ?? []) as Array<{ id: string; firm_id: string | null; kind: string; version: string; accepted_at: string }>;
  const firmNames = await firmNamesFor(consents.map((c) => c.firm_id ?? "").filter(Boolean));
  const tz = profile?.timezone ?? "Africa/Lagos";
  const tzOptions = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const firmChoices: FirmChoice[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    meta: firmMeta(f),
    primary: f.primary,
    onPrimary: readableForeground(f.primary),
    href: firmAppHref(f),
    current: firm?.id === f.id,
  }));

  return (
    <AppScreen>
      <ScreenTitle>Profile</ScreenTitle>
      {saved && <Alert kind="success">Saved.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <AppCard>
        <AppCardHeader title="Your details" />
        <AppCardBody>
          <form action={updateProfile} className="flex flex-col gap-3.5">
            <div>
              <label htmlFor="fullName" className={labelClass}>Full name</label>
              <input id="fullName" name="fullName" defaultValue={profile?.full_name ?? ""} maxLength={120} className={fieldClass} />
            </div>
            <div>
              <p className={labelClass}>Phone</p>
              <p className="mt-1 text-[13.5px] text-dk-body">{profile?.phone ?? user.phone ?? "—"}</p>
              <p className="mt-0.5 text-[11.5px] text-dk-muted">Sign-in number — contact your firm to change it.</p>
            </div>
            <div>
              <label htmlFor="email" className={labelClass}>
                Email <span className="font-normal text-dk-muted">(receipts and notifications)</span>
              </label>
              <input id="email" name="email" type="email" defaultValue={profile?.email ?? user.email ?? ""} maxLength={200} className={fieldClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="timezone" className={labelClass}>Timezone</label>
                <select id="timezone" name="timezone" defaultValue={tz} className={fieldClass}>
                  {tzOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="preferredChannel" className={labelClass}>Channel</label>
                <select id="preferredChannel" name="preferredChannel" defaultValue={profile?.preferred_channel ?? "sms"} className={fieldClass}>
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
                <label htmlFor="quietStart" className={labelClass}>Quiet hours start</label>
                <input id="quietStart" name="quietStart" type="time" defaultValue={profile?.quiet_hours_start?.slice(0, 5) ?? ""} className={`${fieldClass} font-mono`} />
              </div>
              <div>
                <label htmlFor="quietEnd" className={labelClass}>Quiet hours end</label>
                <input id="quietEnd" name="quietEnd" type="time" defaultValue={profile?.quiet_hours_end?.slice(0, 5) ?? ""} className={`${fieldClass} font-mono`} />
              </div>
            </div>
            <Footnote>
              During quiet hours, push, SMS and email wait until the hours end. In-app
              notifications and 10-minute consultation reminders are never held.
            </Footnote>
            <AppButton type="submit" variant="primary-sm">Save</AppButton>
          </form>
        </AppCardBody>
      </AppCard>

      <AppCard>
        <AppCardHeader
          title="Notifications & data"
          action={<AppLink href="/app/notifications/preferences">Preferences</AppLink>}
        />
        <AppCardBody className="flex flex-col gap-4 divide-y divide-dk-rule [&>*+*]:pt-4">
          <PushOptIn />
          <LowDataToggle />
          <OfflineCopyRow />
        </AppCardBody>
      </AppCard>

      {firmChoices.length > 0 && (
        <AppCard>
          <AppCardHeader title="Your firms" />
          <FirmList firms={firmChoices} />
          <div className="border-t border-dk-rule px-[17px] py-3">
            <Footnote>
              One sign-in, whichever firms act for you. Each firm has its own address, and
              the app takes the name and colours of the one you open.
            </Footnote>
          </div>
        </AppCard>
      )}

      <AppCard>
        <AppCardHeader title="Consent history" />
        <AppCardBody>
          {consents.length === 0 ? (
            <p className="text-[13px] text-dk-muted">No consents recorded yet.</p>
          ) : (
            <ul className="divide-y divide-dk-rule text-[13px]">
              {consents.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-2.5">
                  <span className="text-dk-body">
                    {c.kind} <span className="text-dk-muted">v{c.version}</span>
                    {c.firm_id ? <span className="text-dk-muted"> · {firmNames[c.firm_id] ?? "firm"}</span> : null}
                  </span>
                  <span className="flex-none text-dk-muted">{fmt.format(new Date(c.accepted_at))}</span>
                </li>
              ))}
            </ul>
          )}
        </AppCardBody>
      </AppCard>

      <div className="flex gap-2.5">
        <form action={signOut} className="flex-1"><AppButton type="submit" variant="ghost" className="w-full">Sign out</AppButton></form>
        <form action={signOutEverywhere} className="flex-1"><AppButton type="submit" variant="ghost" className="w-full">Sign out everywhere</AppButton></form>
      </div>
    </AppScreen>
  );
}
