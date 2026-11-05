// /firm/network/discover: the directory of verified firms, as each chose to be found.
//
// network_directory shows a verified, active firm whose profile is open to the network, or open
// to connections and connected to yours; it shows no email, telephone or address. Filters are a
// plain GET form, so a search is a link a colleague can open. An approach (an introduction or a
// referral request) goes through request_introduction(), which checks the same reachability and
// the other firm's choices again.

import Link from "next/link";
import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import type { NetworkDirectoryRow } from "@/lib/db/types";
import { ApproachForm } from "./approach-form";

export const metadata = { title: "Discover firms" };

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; q?: string; country?: string; area?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) return <WorkspaceUnavailable audience="staff" />;
  const { supabase, firmId, firmName } = ctx;

  // Only letters, digits, spaces and a few marks reach the filter string.
  const q = (sp.q ?? "").replace(/[^\p{L}\p{N} .'&-]/gu, "").trim().slice(0, 60);
  const country = /^[A-Z]{2}$/.test(sp.country ?? "") ? sp.country! : "";
  const area = /^[a-z0-9_]{2,40}$/.test(sp.area ?? "") ? sp.area! : "";

  let query = supabase.from("network_directory").select("*").eq("mine", false).order("name").limit(100);
  if (country) query = query.eq("country_code", country);
  if (area) query = query.contains("practice_areas", [area]);
  if (q) query = query.or(`name.ilike.%${q}%,city.ilike.%${q}%,description.ilike.%${q}%`);

  const [{ data: rows, error }, { data: jurisdictionRows }, { data: areaRows }, { data: firmRow }] = await Promise.all([
    query,
    supabase.from("jurisdictions").select("code, name").order("sort").order("code"),
    supabase.from("jurisdiction_practice_areas").select("key, label").order("sort"),
    supabase.from("firms").select("status, verified_at").eq("id", firmId).maybeSingle(),
  ]);

  const firms = (rows ?? []) as NetworkDirectoryRow[];
  const jurisdictions = (jurisdictionRows ?? []) as Array<{ code: string; name: string }>;
  const countryName = new Map(jurisdictions.map((j) => [j.code, j.name]));
  const areaLabel = new Map<string, string>();
  for (const a of (areaRows ?? []) as Array<{ key: string; label: string }>) if (!areaLabel.has(a.key)) areaLabel.set(a.key, a.label);
  const f = (firmRow ?? null) as { status: string; verified_at: string | null } | null;
  const verified = f?.status === "active" && Boolean(f?.verified_at);
  const canApproach = verified && ctx.can("invite_firms");

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Discover firms</h1>
          <p className="mt-0.5 text-13 text-ink-muted">{firmName} · verified firms on Docket, as each chose to be found</p>
        </div>
        <Link href="/firm/network" className={buttonClasses("ghost", "sm")}>Back to Docket Network</Link>
      </header>

      {!verified && (
        <Alert kind="info" title="Your firm is not yet verified by Docket">
          The directory opens once Docket has verified your firm.
        </Alert>
      )}
      {error && <Alert kind="error" title="The directory did not load">{error.message}</Alert>}

      <Card>
        <CardBody>
          <form method="get" className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
            {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
            <Input label="Search" name="q" defaultValue={q} placeholder="Firm name, city or what they do" />
            <Select label="Country" name="country" defaultValue={country}>
              <option value="">Anywhere</option>
              {jurisdictions.map((j) => <option key={j.code} value={j.code}>{j.name}</option>)}
            </Select>
            <Select label="Practice area" name="area" defaultValue={area}>
              <option value="">Any</option>
              {Array.from(areaLabel.entries()).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Select>
            <button type="submit" className={buttonClasses("primary", "md")}>Search</button>
          </form>
        </CardBody>
      </Card>

      {firms.length === 0 && !error ? (
        <Card>
          <EmptyState
            title={q || country || area ? "No firm matches that search" : "No other firm is in the directory yet"}
            hint="A firm appears here once Docket has verified it and it has chosen to be found. You can still invite any firm by its official email from Docket Network."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {firms.map((d) => (
            <li key={d.firm_id}>
              <Card className="h-full">
                <CardBody className="flex h-full flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-15 font-semibold text-ink-strong">{d.name}</p>
                      <p className="text-13 text-ink-muted">
                        {[d.city, d.region, countryName.get(d.country_code) ?? d.country_code].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.verified && <Badge tone="settled" icon="check">Verified</Badge>}
                      {d.connected && <Badge tone="informing" icon="transfer">Connected</Badge>}
                    </div>
                  </div>
                  {d.practice_areas.length > 0 && (
                    <p className="text-13 text-ink">{d.practice_areas.map((k) => areaLabel.get(k) ?? k).join(" · ")}</p>
                  )}
                  {d.specialisms.length > 0 && <p className="text-13 text-ink-muted">Specialisms: {d.specialisms.join(", ")}</p>}
                  {d.languages.length > 0 && <p className="text-13 text-ink-muted">Languages: {d.languages.join(", ")}</p>}
                  {d.description && <p className="line-clamp-3 text-13 text-ink-muted">{d.description}</p>}
                  <p className="text-11 text-ink-muted">
                    {[d.accepts_referrals && "Takes referrals", d.accepts_introductions && "Takes introductions", d.accepts_joint_matters && "Open to joint matters"]
                      .filter(Boolean).join(" · ") || "Not taking approaches at present"}
                  </p>
                  <div className="mt-auto pt-1">
                    <ApproachForm
                      firmId={firmId}
                      toFirmId={d.firm_id}
                      toFirmName={d.name}
                      acceptsIntroductions={d.accepts_introductions}
                      acceptsReferrals={d.accepts_referrals}
                      disabled={!canApproach}
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-13 text-ink-muted">
        An approach tells the other firm who you are and what you have in mind; it shares nothing else. Describe a referral without any client
        confidential information. To connect, invite the firm&rsquo;s official email from Docket Network.
      </p>
    </div>
  );
}
