// What a registry clerk or registrar sees while the cause list is being read.
//
// The registry console is one narrow column of cards — what is staged, what is
// published, who acts for this registry — so that is what stands here. A clerk
// who has just staged a CSV comes back to this screen to check it landed, and
// the placeholder in the shape of the staged card is the difference between
// "it is coming" and "it did not save".
//
// It covers /registry and /registry/import alike. The layout's gate — session,
// MFA, registry membership — runs before this boundary exists, so that part of
// a cold request is still a pause this file cannot reach.

import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

export default function RegistryLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3.5">
      <span className="sr-only">Loading…</span>

      {/* The court's name, then the registry and how many people act for it. */}
      <div>
        <Skeleton height={22} className="w-64 max-w-full" />
        <Skeleton height={14} className="mt-2 w-80 max-w-full" />
      </div>

      {/* The standing note about what publishing does. */}
      <SkeletonCard header={false} lines={3} />

      {/* Staged, then published. */}
      <SkeletonCard>
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
