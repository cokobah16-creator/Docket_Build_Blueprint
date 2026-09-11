// /admin/workflow — the platform's catalogue of practice workflow packs: every version published,
// and the form that publishes the next one. A version is immutable; firms install what they choose.

import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { platformContext } from "@/lib/admin-data";
import { formatWhen } from "@/lib/time";
import type { WorkflowPackRow } from "@/lib/db/types";
import { PackPublisher } from "./pack-publisher";

export const metadata = { title: "Workflow packs" };
export const dynamic = "force-dynamic";

export default async function AdminWorkflowPage() {
  const ctx = await platformContext();
  if (!ctx) return <Alert kind="error" title="Not available">This screen is for Docket platform administrators.</Alert>;
  const { data, error } = await ctx.supabase.from("workflow_packs").select("*").order("key", { ascending: true }).order("version", { ascending: false }).limit(500);
  const packs = (data ?? []) as WorkflowPackRow[];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-brand">Workflow packs</h1>
        <p className="text-sm text-gray-600">Stages and the work each starts, as versioned data. Publishing never changes a firm; a firm installs a version from its own Workflow screen.</p>
      </header>
      {error && <Alert kind="error" title="The catalogue could not be read">{error.message}</Alert>}
      <Card>
        <CardHeader title="Published" />
        <CardBody>
          {packs.length === 0 ? <p className="text-sm text-gray-600">Nothing published yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {packs.map((p) => (
                <li key={`${p.key}-${p.version}`} className="py-2 text-sm">
                  <span className="font-medium text-gray-900">{p.name}</span> <span className="font-mono text-xs text-gray-600">{p.key} v{p.version}</span>
                  <span className="text-xs text-gray-600"> · {p.matter_types?.length ? p.matter_types.join(", ") : "every type"} · {p.definition.statuses.length} stages · {(p.definition.task_templates ?? []).length} templates · {formatWhen(p.published_at, ctx.timezone)}</span>
                  {p.note && <span className="block text-xs text-gray-500">{p.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Publish a version" />
        <CardBody><PackPublisher packs={packs} /></CardBody>
      </Card>
    </div>
  );
}
