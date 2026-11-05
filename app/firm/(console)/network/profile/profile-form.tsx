"use client";

// The network profile form. Every rule is upsert_network_profile()'s; this file collects the
// fields and repeats the database's refusal when there is one.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea, choiceCardClasses, chipClasses } from "@/components/ui/input";
import { SettingRow, Switch } from "@/components/ui/switch";
import { saveNetworkProfile } from "@/lib/actions/network";
import type { NetworkProfileInput } from "@/lib/network-copy";
import type { NetworkProfileRow } from "@/lib/db/types";

const VISIBILITY = [
  { value: "network", label: "Every verified firm on Docket", hint: "You appear in the directory. Contact details are never in it." },
  { value: "connections", label: "Connected firms only", hint: "Only firms you have connected with see the profile." },
  { value: "private", label: "Nobody", hint: "You are not in the directory. You can still invite and be invited by email." },
] as const;

function list(text: string): string[] {
  return Array.from(new Set(text.split(",").map((s) => s.trim()).filter(Boolean)));
}

export function ProfileForm({
  firmId, profile, homeCountry, jurisdictions, areas, canEdit,
}: {
  firmId: string;
  profile: NetworkProfileRow | null;
  homeCountry: string;
  jurisdictions: Array<{ code: string; name: string }>;
  areas: Array<{ key: string; label: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<NetworkProfileInput>({
    visibility: profile?.visibility ?? "network",
    official_email: profile?.official_email ?? "",
    website: profile?.website ?? "",
    telephone: profile?.telephone ?? "",
    office_address: profile?.office_address ?? "",
    registration_details: profile?.registration_details ?? "",
    country_code: profile?.country_code ?? homeCountry,
    region: profile?.region ?? "",
    city: profile?.city ?? "",
    practice_areas: profile?.practice_areas ?? [],
    jurisdictions: profile?.jurisdictions ?? [homeCountry],
    languages: profile?.languages ?? ["English"],
    specialisms: profile?.specialisms ?? [],
    description: profile?.description ?? "",
    accepts_referrals: profile?.accepts_referrals ?? true,
    accepts_joint_matters: profile?.accepts_joint_matters ?? true,
    accepts_introductions: profile?.accepts_introductions ?? true,
    share_contacts: profile?.share_contacts ?? true,
  });
  const [languages, setLanguages] = useState(form.languages.join(", "));
  const [specialisms, setSpecialisms] = useState(form.specialisms.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof NetworkProfileInput>(key: K, value: NetworkProfileInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }
  function toggle(key: "practice_areas" | "jurisdictions", value: string) {
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
    setSaved(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await saveNetworkProfile(firmId, { ...form, languages: list(languages), specialisms: list(specialisms) });
    setBusy(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <fieldset disabled={!canEdit || busy} className="flex flex-col gap-3.5">
        <Card>
          <CardHeader title="Who finds you" />
          <CardBody>
            <div role="radiogroup" aria-label="Who finds you" className="grid gap-2 md:grid-cols-3">
              {VISIBILITY.map((v) => (
                <label key={v.value} className={choiceCardClasses(form.visibility === v.value)}>
                  <input
                    type="radio"
                    name="visibility"
                    value={v.value}
                    checked={form.visibility === v.value}
                    onChange={() => set("visibility", v.value)}
                    className="sr-only"
                  />
                  <span className="block text-15 font-semibold text-ink-strong">{v.label}</span>
                  <span className="mt-0.5 block text-13 text-ink-muted">{v.hint}</span>
                </label>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Where you are and what you do" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="Country" value={form.country_code} onChange={(e) => set("country_code", e.target.value)}>
                {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
              </Select>
              <Input label="Region or state" value={form.region} onChange={(e) => set("region", e.target.value)} maxLength={80} />
              <Input label="City" value={form.city} onChange={(e) => set("city", e.target.value)} maxLength={80} />
            </div>
            <div>
              <p className="text-13 font-semibold text-ink-strong">Practice areas</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {areas.map((a) => (
                  <button key={a.key} type="button" aria-pressed={form.practice_areas.includes(a.key)} onClick={() => toggle("practice_areas", a.key)} className={chipClasses(form.practice_areas.includes(a.key))}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-13 font-semibold text-ink-strong">Jurisdictions you can act or advise in</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {jurisdictions.map((j) => (
                  <button key={j.code} type="button" aria-pressed={form.jurisdictions.includes(j.code)} onClick={() => toggle("jurisdictions", j.code)} className={chipClasses(form.jurisdictions.includes(j.code))}>
                    {j.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Languages" value={languages} onChange={(e) => { setLanguages(e.target.value); setSaved(false); }} hint="Separated by commas" />
              <Input label="Specialisms" value={specialisms} onChange={(e) => { setSpecialisms(e.target.value); setSaved(false); }} hint="Separated by commas, for example admiralty, oil and gas" />
            </div>
            <Textarea label="About the firm" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact details" />
          <CardBody className="space-y-4">
            <p className="text-13 text-ink-muted">
              These never appear in the directory. A connected firm reads them only while the switch below is on. The official email and website
              are also what Docket checks an invited address against.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Official email" type="email" value={form.official_email} onChange={(e) => set("official_email", e.target.value)} maxLength={200} />
              <Input label="Website" value={form.website} onChange={(e) => set("website", e.target.value)} maxLength={200} placeholder="https://" />
              <Input label="Telephone" value={form.telephone} onChange={(e) => set("telephone", e.target.value)} maxLength={40} />
              <Input label="Registration details" value={form.registration_details} onChange={(e) => set("registration_details", e.target.value)} maxLength={400} hint="For example a registration or practising number" />
            </div>
            <Textarea label="Office address" value={form.office_address} onChange={(e) => set("office_address", e.target.value)} maxLength={400} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What you accept" />
          <CardBody className="space-y-[15px]">
            <SettingRow title="Share contact details with connected firms" hint="The email, telephone, address and the owners' names." divided={false}>
              <Switch label="Share contact details with connected firms" checked={form.share_contacts} onChange={(v) => set("share_contacts", v)} disabled={!canEdit} />
            </SettingRow>
            <SettingRow title="Accept referral requests" hint="Another firm describes a matter to refer, with no client confidential information.">
              <Switch label="Accept referral requests" checked={form.accepts_referrals} onChange={(v) => set("accepts_referrals", v)} disabled={!canEdit} />
            </SettingRow>
            <SettingRow title="Accept introductions" hint="Another firm asks to be introduced, with a view to working together.">
              <Switch label="Accept introductions" checked={form.accepts_introductions} onChange={(v) => set("accepts_introductions", v)} disabled={!canEdit} />
            </SettingRow>
            <SettingRow title="Open to joint matters" hint="Shown to other firms. Each matter still needs your answer.">
              <Switch label="Open to joint matters" checked={form.accepts_joint_matters} onChange={(v) => set("accepts_joint_matters", v)} disabled={!canEdit} />
            </SettingRow>
          </CardBody>
        </Card>
      </fieldset>

      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      {saved && <Alert kind="success" title="Saved">Other firms read the new profile from now on.</Alert>}
      {canEdit && (
        <div>
          <Button type="submit" size="lg" disabled={busy}>{busy ? "Saving…" : "Save the profile"}</Button>
        </div>
      )}
    </form>
  );
}
