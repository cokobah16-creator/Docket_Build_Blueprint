// Bringing an existing caseload onto Docket, and the record of every batch that came in.
//
// Rules enforced here: every read runs as the signed-in owner or admin under RLS
// (import_batches_select is admin_w or the person who staged it); the screen gathers what the
// wizard needs to warn — the firm's statuses and people — and nothing more; the firm arrives
// from staffContext(). Only an owner or admin sees the wizard: the policies refuse anyone else.

import Link from "next/link";
import { firmStaff, matterStatuses, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import type { FirmReadiness, ImportBatchRow } from "@/lib/db/types";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Import matters" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  if (!ctx.isAdmin) {
    return (
      <Alert kind="info" title={`You are ${ctx.role} at ${ctx.firmName}`}>
        Only an owner or an administrator brings matters in: the import writes as many matters as the file has rows.
      </Alert>
    );
  }
  const { supabase, firmId } = ctx;
  const [staff, statuses, { data: readinessRow }, { data: firmRow }, { data: batchRows }] = await Promise.all([
    firmStaff(supabase, firmId),
    matterStatuses(supabase, firmId),
    supabase.rpc("firm_readiness", { p_firm: firmId }),
    supabase.from("firms").select("conflict_checks_required").eq("id", firmId).maybeSingle(),
    supabase.from("import_batches").select("id, firm_id, kind, source_name, row_count, created_by, created_at, processed_at").eq("firm_id", firmId).order("created_at", { ascending: false }).limit(20),
  ]);
  const readiness = (readinessRow ?? null) as FirmReadiness | null;
  const batches = (batchRows ?? []) as ImportBatchRow[];
  const names = Object.fromEntries(staff.map((m) => [m.user_id, staffLabel(m)]));

  return (
    <div className="space-y-6">
      <ImportWizard
        firmId={firmId}
        staff={staff.map((m) => ({ user_id: m.user_id, label: staffLabel(m), email: m.email, full_name: m.full_name }))}
        statuses={statuses.map((s) => ({ key: s.key, label: s.label }))}
        referencePrefix={readiness?.reference_prefix ?? ""}
        referenceIssued={readiness?.reference_issued ?? true}
        conflictChecksRequired={Boolean((firmRow as { conflict_checks_required: boolean } | null)?.conflict_checks_required)}
      />

      <Card>
        <CardHeader title="Imports so far" />
        <CardBody>
          {batches.length === 0 ? (
            <EmptyState title="Nothing has been imported yet" hint="Every import is kept, row by row, with what became of each." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  <div>
                    <Link href={`/firm/admin/import/${b.id}?firm=${firmId}`} className="text-sm font-medium text-brand underline">{b.source_name ?? "A file"}</Link>
                    <p className="text-xs text-gray-600">{b.row_count} {b.row_count === 1 ? "row" : "rows"} · {b.created_by ? names[b.created_by] ?? "a colleague" : "a colleague"} · {formatWhen(b.created_at, ctx.timezone)}</p>
                  </div>
                  <span className="text-xs text-gray-600">{b.processed_at ? "Processed" : "Not finished — open it to continue"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-500">The twenty most recent are listed.</p>
        </CardBody>
      </Card>
    </div>
  );
}
