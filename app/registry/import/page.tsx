// /registry/import — staging a cause list: a CSV, or one listing typed in.
//
// The file never leaves the browser whole. It is parsed here (src/lib/csv.ts), the columns are
// mapped, and only the mapped text is sent to stage_registry_notices(), which checks each row on
// its own and returns the ones it could not take with the reason. Nothing is published from here:
// a registrar does that from the cause-list screen, after looking.

import { Alert } from "@/components/ui/alert";
import { registryContext } from "@/lib/registry-data";
import { StageForm } from "./stage-form";
import { PageHeader } from "@/components/shell/layout";

export const metadata = { title: "Stage a cause list" };

export default async function RegistryImportPage({ searchParams }: { searchParams: Promise<{ registry?: string }> }) {
  const sp = await searchParams;
  const ctx = await registryContext(sp.registry);
  if (!ctx) return <Alert kind="warning" title="Not configured">Supabase is not configured, or this account acts for no registry.</Alert>;
  if (ctx.registry.status === "suspended") {
    return <Alert kind="warning" title="This registry is suspended">Nothing can be staged until the Docket platform restores it.</Alert>;
  }
  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader tone="neutral" title="Stage a cause list" description={`${ctx.courtName} · ${ctx.registry.name}`} />
      <StageForm registryId={ctx.registry.id} />
    </div>
  );
}
