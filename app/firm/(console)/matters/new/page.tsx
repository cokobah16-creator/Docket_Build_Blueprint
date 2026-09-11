// Open a matter. The screen itself only gathers what open_matter() needs: the
// firm's own statuses, its people and the courts it may point a matter at all
// come from the signed-in staff member's context.
//
// Rules enforced here: every read runs as that staff member, so RLS is the
// authorization and no service key is used; the reference is minted inside
// open_matter() (next_reference() is service-only), never in this code; and
// nothing is firm-specific — the firm arrives from staffContext().
//
// A pushed screen rather than a tab, so it opens with its own way back. The
// console layout owns the page gutter, so there are no margins here.

import Link from "next/link";
import { courtsFor, firmStaff, matterStatuses, requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { ScreenTitle } from "@/components/app";
import { ChevronLeftIcon } from "@/components/ui/icons";
import { NewMatterForm } from "./new-matter-form";

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
  const [statuses, staff, courts] = await Promise.all([
    matterStatuses(supabase, firmId),
    firmStaff(supabase, firmId),
    courtsFor(supabase, firmId),
  ]);

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      {/* The whole row is the target: 44px tall and as wide as its words. */}
      <Link
        href="/firm/matters"
        className="-ml-1 inline-flex min-h-[44px] w-fit items-center gap-1 pr-2 text-[13px] font-medium text-dk-pri"
      >
        <ChevronLeftIcon size={17} className="flex-none" />
        Matters
      </Link>

      <header>
        <ScreenTitle>Open a matter</ScreenTitle>
        <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
          {ctx.firmName} · the reference is issued by the database as the matter opens
        </p>
      </header>

      <NewMatterForm
        firmId={firmId}
        firmName={ctx.firmName}
        statuses={statuses}
        staff={staff}
        courts={courts}
        currentUserId={ctx.userId}
        timezone={ctx.timezone}
      />
    </div>
  );
}
