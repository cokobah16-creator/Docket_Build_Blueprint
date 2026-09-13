// /admin/registries — the court registries on Docket, and who acts for each.
//
// A registry is created here only when a real court registry has agreed to the pilot in
// docs/COURT_REGISTRY_PILOT.md. It is not a firm and it is not a court entry: it is a principal
// that publishes that court's cause list to the firms that already hold its suits. A platform
// admin creates it, adds its first registrar by the email they signed up with, and can suspend it.
// What it publishes and what any firm decides about that is never visible here as CONTENT. The
// pilot's own numbers are, through registry_pilot_health() — counts per registry and nothing else,
// no firm, no matter, no suit — which is the platform's usual level of sight and the measurement
// docs/COURT_REGISTRY_PILOT.md §4 says the pilot is judged by.

import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { platformContext, registryPilotHealth } from "@/lib/admin-data";
import { formatWhen } from "@/lib/time";
import { COURT_LEVEL_LABELS } from "@/lib/nigeria";
import type { CourtRow, RegistryMemberRow, RegistryPilotHealthRow, RegistryRow } from "@/lib/db/types";
import { AddMemberForm, CreateRegistryForm, RegistryStatusForm, RemoveMemberButton } from "./registry-controls";

export const metadata = { title: "Court registries" };

export default async function RegistriesPage() {
  const ctx = await platformContext();
  if (!ctx) return <Alert kind="error" title="Platform admins only">This account is not a Docket platform administrator.</Alert>;
  const { supabase, timezone } = ctx;

  const [{ data: registryRows, error }, { data: memberRows }, { data: courtRows }, health] = await Promise.all([
    supabase.from("registries").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("registry_members").select("registry_id, user_id, role, added_by, created_at").limit(1000),
    supabase.from("courts").select("id, firm_id, level, name, short_name, state_code, division, city, suit_number_hint, is_active")
      .is("firm_id", null).eq("is_active", true).order("sort").order("name").limit(1000),
    registryPilotHealth(supabase),
  ]);
  const registries = (registryRows ?? []) as RegistryRow[];
  const members = (memberRows ?? []) as RegistryMemberRow[];
  const courts = (courtRows ?? []) as CourtRow[];
  const courtById = new Map(courts.map((c) => [c.id, c]));
  const memberIds = Array.from(new Set(members.map((m) => m.user_id)));
  const { data: people } = memberIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", memberIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const personById = new Map(((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]));
  const taken = new Set(registries.map((r) => r.court_id));
  const healthById = new Map(health.rows.map((h) => [h.registry_id, h]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-docket-hunter">Court registries</h1>
        <p className="mt-1 text-sm text-gray-600">
          A registry publishes its court&rsquo;s cause list to the firms that already hold its suits. Create one only
          when a real registry has agreed to the pilot — the checklist is in <code>docs/COURT_REGISTRY_PILOT.md</code>.
        </p>
      </div>

      {error && <Alert kind="error" title="The registries did not load">Nothing is shown because nothing could be read. Try again.</Alert>}
      {health.error && (
        <Alert kind="error" title="The pilot figures did not load">
          The registries below are real; their counts are not shown, because nothing could be counted. Zeros here would
          read as &ldquo;nothing has been published&rdquo;, which is not what happened.
        </Alert>
      )}

      <Card>
        <CardHeader title="Create a registry" />
        <CardBody>
          <CreateRegistryForm courts={courts.filter((c) => !taken.has(c.id)).map((c) => ({ id: c.id, label: `${c.name}${c.state_code ? ` (${c.state_code})` : ""} — ${COURT_LEVEL_LABELS[c.level] ?? c.level}` }))} />
        </CardBody>
      </Card>

      {registries.length === 0 ? (
        <Card><EmptyState title="No registry yet" hint="Docket is connected to no court registry. Nothing on any firm's screen claims otherwise." /></Card>
      ) : (
        registries.map((r) => {
          const court = courtById.get(r.court_id);
          const its = members.filter((m) => m.registry_id === r.id);
          return (
            <Card key={r.id}>
              <CardHeader title={r.name} action={<span className={r.status === "active" ? "text-xs font-medium text-emerald-800" : "text-xs font-medium text-red-800"}>{r.status}</span>} />
              <CardBody className="space-y-3">
                <p className="text-sm text-gray-700">
                  {court?.name ?? "Court not found"}{court?.state_code ? ` · ${court.state_code}` : ""} · created {formatWhen(r.created_at, timezone)}
                  {r.contact_name ? ` · contact ${r.contact_name}` : ""}{r.contact_email ? ` <${r.contact_email}>` : ""}
                </p>
                {r.note && <p className="text-xs text-gray-600">{r.note}</p>}

                {!health.error && <PilotCounts row={healthById.get(r.id)} timezone={timezone} />}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Who acts for it</p>
                  {its.length === 0 ? (
                    <p className="mt-1 text-sm text-amber-800">Nobody yet — it cannot publish until a registrar is added.</p>
                  ) : (
                    <ul className="mt-1 divide-y divide-gray-100">
                      {its.map((m) => {
                        const p = personById.get(m.user_id);
                        return (
                          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                            <span>{p?.full_name ?? p?.email ?? m.user_id} <span className="text-gray-500">· {m.role}{p?.email && p?.full_name ? ` · ${p.email}` : ""}</span></span>
                            <RemoveMemberButton registryId={r.id} userId={m.user_id} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <AddMemberForm registryId={r.id} />
                </div>

                <RegistryStatusForm registryId={r.id} status={r.status} />
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}

/**
 * What the pilot is measured by, from registry_pilot_health() — real rows, never an estimate, and
 * never a firm's name. `attached` is the interesting one: it counts the confirmations that landed on
 * a sitting the firm's diary already had, which says whether the registry is ahead of the firms or
 * behind them. It is spelled out rather than left as a number nobody can interpret.
 */
function PilotCounts({ row, timezone }: { row: RegistryPilotHealthRow | undefined; timezone: string }) {
  if (!row) {
    return (
      <p className="text-xs text-gray-500">
        No figures for this registry yet — it has published nothing and no firm has decided anything.
      </p>
    );
  }
  const cells: Array<[string, number]> = [
    ["Published", row.notices_published],
    ["Staged, unpublished", row.drafts],
    ["Withdrawn", row.notices_withdrawn],
    ["Confirmed by a lawyer", row.decisions_confirmed],
    ["Not theirs / not diarised", row.decisions_rejected],
    ["Already in the diary", row.attached_to_existing],
  ];
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">The pilot, measured</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {cells.map(([label, n]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-gray-600">{label}</dt>
            <dd className="font-semibold tabular-nums text-docket-hunter">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-xs text-gray-500">
        {row.first_published_at
          ? <>Publishing since {formatWhen(row.first_published_at, timezone)}{row.last_published_at ? `, most recently ${formatWhen(row.last_published_at, timezone)}` : ""}.{" "}</>
          : <>Nothing published yet.{" "}</>}
        &ldquo;Already in the diary&rdquo; counts confirmations that attached to a sitting the firm had
        recorded before the notice arrived, rather than creating a new one.
      </p>
    </div>
  );
}
