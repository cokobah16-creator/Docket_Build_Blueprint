// What a client sees while a portal screen is being built on the server.
//
// It is the client home's own arrangement — the greeting and the firm's name,
// the main-action block, the quick-action tiles, then the cards — rather than a
// spinner in the middle of the page, because the point of a placeholder is that
// nothing moves when the real screen lands. A spinner would put the whole page
// through a second reflow at exactly the moment a thumb is already travelling
// towards where it saw something.
//
// It covers every route under (portal) that has no nearer loading.tsx, so the
// shapes here are the ones those screens share: a title, a block, a row of
// actions, a column of cards. It does NOT cover the layout's own work — the
// session read and the consent check in layout.tsx run before this boundary
// exists — which is a pause this file cannot reach and a real one on a cold
// request.

import { Screen } from "@/components/portal/screen";
import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

export default function PortalLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading…</span>

      <Screen className="gap-5">
        {/* The greeting, the firm's name and the notifications bell. */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton height={26} className="w-56 max-w-full" />
            <Skeleton height={15} className="mt-1.5 w-36 max-w-full" />
          </div>
          <Skeleton width={44} height={44} radius="full" className="shrink-0" />
        </header>

        {/* The main action: a title, two lines and its one button. */}
        <SkeletonCard header={false}>
          <div className="space-y-2 px-4 py-4">
            <Skeleton height={17} className="w-2/3" />
            <Skeleton height={15} className="w-full" />
            <Skeleton height={15} className="w-4/5" />
            <Skeleton height={50} radius="control" className="!mt-3 w-full sm:w-56" />
          </div>
        </SkeletonCard>

        {/* A matter. */}
        <SkeletonCard lines={3} />

        {/* The quick actions: two across on a phone, one row from 768px. */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} radius="control" className="min-h-14" />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <SkeletonCard lines={2} />
          <SkeletonCard>
            <SkeletonRow />
            <SkeletonRow />
          </SkeletonCard>
        </div>
      </Screen>
    </div>
  );
}
