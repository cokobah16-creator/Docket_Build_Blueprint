// What a Docket operator sees while a platform console screen is being read.
//
// The platform console is a header of counts and then cards of firms and domain
// requests, so that is the shape here. The counts are deliberately blocks rather
// than zeroes: "0 firms on Docket" shown for a second while the query is still
// running is a sentence that is not true, and an operator who reads it goes
// looking for an outage that is not there.
//
// It covers every screen under /admin with no nearer loading.tsx. The layout's
// gate — session, MFA, the platform_admins row — runs before this boundary
// exists, so that part of a cold request is still a pause this file cannot
// reach.

import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>

      <header className="flex flex-col gap-2">
        <Skeleton height={24} className="w-64 max-w-full" />
        <Skeleton height={14} className="w-96 max-w-full" />
      </header>

      <SkeletonCard>
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </SkeletonCard>

      <SkeletonCard>
        <SkeletonRow />
        <SkeletonRow />
      </SkeletonCard>
    </div>
  );
}
