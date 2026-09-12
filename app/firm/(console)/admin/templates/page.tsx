// /firm/admin/templates — the firm's document templates (migration 40).
//
// Reads run as the signed-in member under RLS (every member sees the templates; only an owner or
// administrator with a second factor writes them — the policy, not this page, refuses anyone
// else). A template is filled from the matter's own facts when a document is generated on the
// matter's Documents tab; a placeholder the matter has no value for stops the generation there.

import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import type { DocumentTemplateRow } from "@/lib/db/types";
import { TemplatesEditor } from "./templates-editor";

export const metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
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
  const { data, error } = await supabase
    .from("document_templates")
    .select("id, firm_id, name, matter_types, body, execution, version, note, created_by, created_at, updated_at, retired_at")
    .eq("firm_id", firmId)
    .order("retired_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .limit(200);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Templates</h1>
        <p className="text-sm text-gray-600">{ctx.firmName} · documents drawn from a matter&apos;s own facts, and how each is executed</p>
      </header>
      {error && <Alert kind="error" title="The templates could not be read">{error.message}. That is a failed read, not an empty list.</Alert>}
      {!ctx.isAdmin && <Alert kind="info">You are {ctx.role} here: the templates are shown, and an owner or administrator edits them.</Alert>}
      <TemplatesEditor firmId={firmId} templates={(data ?? []) as DocumentTemplateRow[]} canWrite={ctx.isAdmin} timezone={ctx.timezone} />
    </div>
  );
}
