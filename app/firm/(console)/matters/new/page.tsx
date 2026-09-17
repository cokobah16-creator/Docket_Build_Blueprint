// Open a matter. The screen itself only gathers what open_matter() needs: the
// firm's own statuses, its people and the courts it may point a matter at all
// come from the signed-in staff member's context.
//
// Rules enforced here: every read runs as that staff member, so RLS is the
// authorization and no service key is used; the reference is minted inside
// open_matter() (next_reference() is service-only), never in this code; and
// nothing is firm-specific — the firm arrives from staffContext().

import { courtsFor, firmStaff, matterStatuses, requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { NewMatterForm } from "./new-matter-form";
import { PageHeader } from "@/components/shell/layout";

export const metadata = { title: "Open a matter" };

export default async function NewMatterPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string }>;
}) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId } = ctx;
  const [statuses, staff, courts, { data: firmRow }] = await Promise.all([
    matterStatuses(supabase, firmId),
    firmStaff(supabase, firmId),
    courtsFor(supabase, firmId),
    supabase.from("firms").select("conflict_checks_required").eq("id", firmId).maybeSingle(),
  ]);
  const conflictChecksRequired = Boolean((firmRow as { conflict_checks_required: boolean } | null)?.conflict_checks_required);

  return (
    <div className="space-y-5">
      <PageHeader
        tone="neutral"
        back="/firm/matters"
        backLabel="Matters"
        title="Open a matter"
        description={`${ctx.firmName} · the reference is issued by the database as the matter opens`}
      />

      <NewMatterForm
        firmId={firmId}
        firmName={ctx.firmName}
        statuses={statuses}
        staff={staff}
        courts={courts}
        currentUserId={ctx.userId}
        timezone={ctx.timezone}
        conflictChecksRequired={conflictChecksRequired}
      />
    </div>
  );
}
