import Link from "next/link";
import { safeNotice } from "@/lib/user-error-message";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmNamesFor } from "@/lib/portal-data";
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { DEFAULT_TOKENS } from "@/lib/brand";
import { zoneLabel } from "@/lib/client-words";
import { whenWords } from "@/lib/notifications-copy";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Disclosure } from "@/components/ui/disclosure";
import { SettingRow } from "@/components/ui/switch";
import { CookieSettingsButton } from "@/components/ui/cookie-banner";
import { analyticsConfigured } from "@/lib/consent-cookie";
import { Alert } from "@/components/ui/alert";
import { PushOptIn } from "@/components/push/push-opt-in";
import { LowDataToggle } from "@/components/portal/pwa-hints";
import { OfflineCopy } from "@/components/portal/offline-copy";
import { FirmRow, type FirmChoice } from "@/components/portal/firm-switcher";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { signOut } from "../actions";
import { signOutEverywhere, updateProfile } from "@/lib/actions/portal";

export const metadata = { title: "Profile" };

// The zone is stored as its IANA name, which a client never reads (docs/VOICE.md, rule 4), so
// each one carries the words the list shows.
const TIMEZONES: Array<[zone: string, words: string]> = [
  ["Africa/Lagos", "Lagos, Nigeria (WAT)"],
  ["Africa/Accra", "Accra, Ghana"],
  ["Africa/Nairobi", "Nairobi, Kenya"],
  ["Africa/Johannesburg", "Johannesburg, South Africa"],
  ["Europe/London", "London, United Kingdom"],
  ["Europe/Paris", "Paris, France"],
  ["America/New_York", "New York, United States"],
  ["America/Chicago", "Chicago, United States"],
  ["America/Los_Angeles", "Los Angeles, United States"],
  ["America/Toronto", "Toronto, Canada"],
  ["Asia/Dubai", "Dubai, United Arab Emirates"],
  ["Asia/Kolkata", "Kolkata, India"],
  ["Australia/Sydney", "Sydney, Australia"],
];

// What each consent_kind is, in words.
const CONSENT_WORDS: Record<string, string> = {
  terms: "Terms of service",
  privacy: "Privacy notice",
  engagement: "Terms of engagement",
  recording: "Recording of a consultation",
  marketing: "Marketing messages",
};

/** "0803 123 4567" for a Nigerian number, the full international number otherwise (docs/VOICE.md, rule 18). */
function phoneWords(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^234\d{10}$/.test(digits)) {
    const local = `0${digits.slice(3)}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return digits ? `+${digits}` : raw;
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

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
  // A zone saved before this list existed stays selectable, named the way zoneLabel() names it.
  const tzOptions: Array<[string, string]> = TIMEZONES.some(([z]) => z === tz) ? TIMEZONES : [[tz, zoneLabel(tz)], ...TIMEZONES];
  const phone = profile?.phone ?? user.phone ?? null;
  const notice = error ? safeNotice(error) : null;

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
      {saved && <Alert kind="success">Your details are saved.</Alert>}
      {notice && <Alert kind="error" title="That did not go through">{notice}</Alert>}

      {/* The one main action on this screen is saving these details. */}
      <Card>
        <CardHeader title="Your details" />
        <CardBody>
          <form action={updateProfile} className="space-y-4">
            <Input
              id="fullName"
              name="fullName"
              label="Full name"
              autoComplete="name"
              defaultValue={profile?.full_name ?? ""}
              maxLength={120}
              hint="When you sign a document, you type this name exactly as it is here."
            />
            <div>
              <p className="text-13 font-semibold text-ink">Phone number</p>
              <p className="mt-1 text-15 text-ink">{phone ? phoneWords(phone) : "No phone number is on your account."}</p>
              {phone && <p className="mt-1 text-11 text-ink-muted">This is the number you sign in with. To change it, message your firm.</p>}
            </div>
            <Input
              id="email"
              name="email"
              type="email"
              label="Email address"
              autoComplete="email"
              defaultValue={profile?.email ?? user.email ?? ""}
              maxLength={200}
              hint="Your receipts and notifications are sent here."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Select id="timezone" name="timezone" label="Your time zone" defaultValue={tz}>
                  {tzOptions.map(([z, words]) => <option key={z} value={z}>{words}</option>)}
                </Select>
                <p className="text-11 text-ink-muted">Times in the app are shown in this zone.</p>
              </div>
              {/* enqueue_notification always writes the in-app copy, so "only in the app" would not
                  be true of any choice here: the hint says so instead. */}
              <div className="space-y-1.5">
                <Select id="preferredChannel" name="preferredChannel" label="Main way to reach you" defaultValue={profile?.preferred_channel ?? "sms"}>
                  <option value="sms">Text message (SMS)</option>
                  <option value="email">Email</option>
                  <option value="push">Push notifications</option>
                  <option value="in_app">In the app</option>
                </Select>
                <p className="text-11 text-ink-muted">Every notification also shows in the app.</p>
              </div>
            </div>
            <fieldset>
              <legend className="text-13 font-semibold text-ink">Quiet hours</legend>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <Input id="quietStart" name="quietStart" type="time" label="From" defaultValue={profile?.quiet_hours_start?.slice(0, 5) ?? ""} className="font-mono" />
                <Input id="quietEnd" name="quietEnd" type="time" label="Until" defaultValue={profile?.quiet_hours_end?.slice(0, 5) ?? ""} className="font-mono" />
              </div>
              <p className="mt-2 text-13 leading-relaxed text-ink-muted">
                During quiet hours, text messages, emails and push notifications wait until the quiet hours end. Notifications in the app, and the reminder 10 minutes before a consultation, still arrive.
              </p>
            </fieldset>
            <Button type="submit">Save my details</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Notifications and data" />
        <CardBody className="space-y-[15px]">
          <PushOptIn quiet />
          <LowDataToggle />
          <OfflineCopy matterIds={matterIds} />
          {/* Only where the cookie banner can appear (POSTHOG_KEY set), so it never opens nothing. */}
          {analyticsConfigured() && (
            <SettingRow title="Cookies" hint="Choose whether Docket may use analytics in this browser.">
              <CookieSettingsButton className={buttonClasses("ghost", "sm", "shrink-0")} />
            </SettingRow>
          )}
          {/* The link's words are too long to sit beside the text on a phone, so it goes under it there. */}
          <div className="flex flex-col items-start gap-2.5 border-t border-hairline pt-[15px] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-13 font-semibold text-ink-strong">What you are told about</p>
              <p className="mt-0.5 text-11 text-ink-muted">Choose which updates reach you by text message, by email or by push notification.</p>
            </div>
            <Link href="/app/notifications/preferences" className={buttonClasses("ghost", "sm", "shrink-0")}>Choose your notifications</Link>
          </div>
        </CardBody>
      </Card>

      {/* Secondary detail folds away, so the details above stay the screen's one main thing. */}
      {choices.length > 0 && (
        <Disclosure summary="Your firms" hint={choices.length === 1 ? choices[0].name : `${choices.length} firms act for you`}>
          {/* The fold's own padding is cancelled so each row's tap area runs to the edge. */}
          <ul className="-mx-4 -mt-3">
            {choices.map((choice) => (
              <li key={choice.id} className="border-t border-hairline first:border-t-0">
                <FirmRow firm={choice} selected={choice.id === firm?.id} />
              </li>
            ))}
          </ul>
          <p className="-mx-4 border-t border-hairline px-4 pt-3 text-13 leading-relaxed text-ink-muted">
            You sign in once to see every firm that acts for you. The app shows the name and colours of the firm you are reading.
          </p>
        </Disclosure>
      )}

      <Disclosure summary="What you have agreed to" hint="Each agreement, with its version and the date it was recorded.">
        {consents.length === 0 ? (
          <div className="-mx-4 -my-3">
            <EmptyState align="start" title="No agreements recorded yet" hint="When you accept a firm's terms of service or its privacy notice, it is recorded here with its version and date." />
          </div>
        ) : (
          <ul className="-my-3 divide-y divide-hairline">
            {consents.map((c) => {
              const firmName = c.firm_id ? firmNames[c.firm_id] : null;
              return (
                <li key={c.id} className="py-2.5">
                  <p className="text-15 text-ink">{CONSENT_WORDS[c.kind] ?? "An agreement"}{firmName ? `, ${firmName}` : ""}</p>
                  <p className="mt-0.5 text-13 text-ink-muted">Version <span className="font-mono">{c.version}</span>. Recorded on {whenWords(c.accepted_at, tz)}.</p>
                </li>
              );
            })}
          </ul>
        )}
      </Disclosure>

      <div className="space-y-2.5">
        <form action={signOut}><Button type="submit" variant="ghost" size="lg" className="w-full">Sign out</Button></form>
        {/* The consequence comes before the button (docs/VOICE.md, rule 16). */}
        <Disclosure summary="Sign out on every device" hint="Use this if you lose a phone or stop using a computer.">
          <p>This signs you out here and on every other phone or computer where you are signed in. You will need to sign in again on each one.</p>
          <form action={signOutEverywhere} className="mt-3"><Button type="submit" variant="ghost">Sign out everywhere</Button></form>
        </Disclosure>
      </div>
    </Screen>
  );
}
