// /firm/network/alliances: standing relationships between connected firms.
//
// firm_alliances and alliance_members are read by any firm asked into the alliance; the names of
// the member firms come from alliance_roster, since a member need not be connected to every other
// member. alliance_notes shows a shared note to accepted members and an internal note to its own
// firm alone. Every write is a door in migration 63.

import Link from "next/link";
import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import type { AllianceNoteRow, AllianceRosterRow, AllianceRow, ConnectedFirmRow } from "@/lib/db/types";
import { AlliancePanels } from "./alliance-panels";

export const metadata = { title: "Alliances" };

export default async function AlliancesPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) return <WorkspaceUnavailable audience="staff" />;
  const { supabase, firmId, firmName, timezone } = ctx;

  // Only the alliances this firm is in: the policy admits any firm the signed in person belongs to,
  // so the member rows narrow it to this one.
  const { data: mine } = await supabase.from("alliance_members").select("alliance_id").eq("firm_id", firmId);
  const ids = ((mine ?? []) as Array<{ alliance_id: string }>).map((m) => m.alliance_id);

  const [{ data: allianceRows, error }, { data: rosterRows }, { data: noteRows }, { data: connectedRows }, { data: areaRows }, { data: jurisdictionRows }, { data: firmRow }] =
    await Promise.all([
      ids.length ? supabase.from("firm_alliances").select("*").in("id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from("alliance_roster").select("*").in("alliance_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from("alliance_notes").select("*").in("alliance_id", ids).order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
      supabase.from("connected_firms").select("connection_id, other_firm_id, other_firm_name, status").eq("my_firm_id", firmId).eq("status", "active").order("other_firm_name"),
      supabase.from("jurisdiction_practice_areas").select("key, label").order("sort"),
      supabase.from("jurisdictions").select("code, name").order("sort").order("code"),
      supabase.from("firms").select("status, verified_at").eq("id", firmId).maybeSingle(),
    ]);

  const alliances = (allianceRows ?? []) as AllianceRow[];
  const roster = (rosterRows ?? []) as AllianceRosterRow[];
  const notes = (noteRows ?? []) as AllianceNoteRow[];
  const connected = (connectedRows ?? []) as Pick<ConnectedFirmRow, "connection_id" | "other_firm_id" | "other_firm_name" | "status">[];
  const areas = new Map<string, string>();
  for (const a of (areaRows ?? []) as Array<{ key: string; label: string }>) if (!areas.has(a.key)) areas.set(a.key, a.label);
  const jurisdictions = (jurisdictionRows ?? []) as Array<{ code: string; name: string }>;
  const f = (firmRow ?? null) as { status: string; verified_at: string | null } | null;
  const verified = f?.status === "active" && Boolean(f?.verified_at);

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Alliances</h1>
          <p className="mt-0.5 text-13 text-ink-muted">{firmName} · standing relationships with firms you are connected to</p>
        </div>
        <Link href="/firm/network" className={buttonClasses("ghost", "sm")}>Back to Docket Network</Link>
      </header>

      {error && <Alert kind="error" title="The alliances did not load">{error.message}</Alert>}

      <AlliancePanels
        firmId={firmId}
        canPropose={verified && ctx.can("invite_firms")}
        canAnswer={ctx.can("invite_firms")}
        canTerminate={(ctx.role === "owner" || ctx.role === "admin") && ctx.can("invite_firms")}
        alliances={alliances}
        roster={roster}
        notes={notes}
        connected={connected.map((c) => ({ id: c.other_firm_id, name: c.other_firm_name }))}
        areas={Array.from(areas.entries()).map(([key, label]) => ({ key, label }))}
        jurisdictions={jurisdictions}
        timezone={timezone}
      />
    </div>
  );
}
