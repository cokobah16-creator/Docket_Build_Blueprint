// /firm/admin/workflow — the firm's practice workflow: packs installed, packs on offer, the firm's own stages.
//
// Reads run as the signed-in member under RLS: the catalogue is readable by every signed-in person,
// the ledger by the firm's members, the stages by members and the firm's clients. Writes go through
// install_workflow_pack() and the matter_statuses policies, both admin_w — the screen only shows the
// buttons to an owner or admin, and the database refuses anyone else regardless.

import { matterStatuses, requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import type { FirmWorkflowPackRow, WorkflowPackRow } from "@/lib/db/types";
import { WorkflowPanel } from "./workflow-panel";

export const metadata = { title: "Workflow" };

export default async function WorkflowPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId } = ctx;
  const [{ data: packRows, error: packError }, { data: installedRows }, statuses] = await Promise.all([
    supabase.from("workflow_packs").select("*").order("key", { ascending: true }).order("version", { ascending: false }).limit(200),
    supabase.from("firm_workflow_packs").select("*").eq("firm_id", firmId),
    matterStatuses(supabase, firmId),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Workflow</h1>
        <p className="text-sm text-gray-600">{ctx.firmName} · the stages a matter moves through, and the work each starts</p>
      </header>
      {packError && <Alert kind="error" title="The catalogue could not be read">{packError.message}. That is a failed read, not an empty catalogue.</Alert>}
      {!ctx.isAdmin && <Alert kind="info">You are {ctx.role} here: the stages are shown, and an owner or administrator installs packs and edits the wording.</Alert>}
      <WorkflowPanel
        firmId={firmId}
        packs={(packRows ?? []) as WorkflowPackRow[]}
        installed={(installedRows ?? []) as FirmWorkflowPackRow[]}
        statuses={statuses}
        canWrite={ctx.isAdmin}
      />
    </div>
  );
}
