// /firm/network/profile: the firm as other firms on Docket see it.
//
// Read by every member (firm_network_profiles_select is is_firm_member); written by an owner or
// administrator who holds manage_settings, through upsert_network_profile(), which is the only
// door. Visibility decides who finds the firm in the directory; share_contacts decides whether a
// connected firm reads the email, telephone and address. The directory never carries contacts.

import Link from "next/link";
import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import type { NetworkProfileRow } from "@/lib/db/types";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Network profile" };

export default async function NetworkProfilePage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) return <WorkspaceUnavailable audience="staff" />;
  const { supabase, firmId, firmName } = ctx;

  const { data: firmRow } = await supabase.from("firms").select("jurisdiction_code").eq("id", firmId).maybeSingle();
  const home = (firmRow as { jurisdiction_code?: string } | null)?.jurisdiction_code ?? "NG";

  const [{ data: profileRow, error }, { data: jurisdictionRows }, { data: areaRows }] = await Promise.all([
    supabase.from("firm_network_profiles").select("*").eq("firm_id", firmId).maybeSingle(),
    supabase.from("jurisdictions").select("code, name").order("sort").order("code"),
    supabase.from("jurisdiction_practice_areas").select("key, label").eq("jurisdiction_code", home).order("sort"),
  ]);

  const profile = (profileRow ?? null) as NetworkProfileRow | null;
  const jurisdictions = (jurisdictionRows ?? []) as Array<{ code: string; name: string }>;
  const areas = (areaRows ?? []) as Array<{ key: string; label: string }>;
  const canEdit = (ctx.role === "owner" || ctx.role === "admin") && ctx.can("manage_settings");

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Network profile</h1>
          <p className="mt-0.5 text-13 text-ink-muted">{firmName} · how other firms on Docket find and read you</p>
        </div>
        <Link href="/firm/network" className={buttonClasses("ghost", "sm")}>Back to Docket Network</Link>
      </header>

      {error && <Alert kind="error" title="The profile did not load">{error.message}</Alert>}

      {!profile && !error && (
        <Alert kind="info" title="No profile yet">
          Until you save one, your firm is not in the directory. It can still invite and be invited by email.
        </Alert>
      )}

      {!canEdit && (
        <Alert kind="info" title="Read only">
          An owner or administrator with the manage settings permission writes the network profile.
        </Alert>
      )}

      <ProfileForm
        firmId={firmId}
        profile={profile}
        homeCountry={home}
        jurisdictions={jurisdictions}
        areas={areas}
        canEdit={canEdit}
      />
    </div>
  );
}
