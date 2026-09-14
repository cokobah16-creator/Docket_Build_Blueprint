// What a client sees while a portal screen is being built on the server.
//
// It is the client home's own arrangement — the welcome line, the five quick
// actions, then the cards — rather than a spinner in the middle of the page,
// because the point of a placeholder is that nothing moves when the real screen
// lands. A spinner would put the whole page through a second reflow at exactly
// the moment a thumb is already travelling towards where it saw something.
//
// It covers every route under (portal) that has no nearer loading.tsx, so the
// shapes here are the ones those screens share: a title, a row of actions, a
// column of cards. It does NOT cover the layout's own work — the session read
// and the consent check in layout.tsx run before this boundary exists — which
// is a pause this file cannot reach and a real one on a cold request.

import { Screen } from "@/components/portal/screen";
import { WithAside } from "@/components/shell/layout";
import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

export default function PortalLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading…</span>

      <Screen className="gap-4">
        {/* The welcome line and the notifications bell. */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton height={23} className="w-48 max-w-full" />
            <Skeleton height={13} className="mt-1.5 w-32 max-w-full" />
          </div>
          <Skeleton width={44} height={44} radius="full" className="shrink-0" />
        </header>

        {/* Book, Join, Upload, Message, Pay. Five, always five. */}
        <div className="grid grid-cols-5 gap-[7px] md:gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} radius="control" className="min-h-16 md:min-h-[72px]" />
          ))}
        </div>

        <WithAside
          from="xl"
          aside={
            <>
              <SkeletonCard lines={1} />
              <SkeletonCard>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </SkeletonCard>
            </>
          }
        >
          <SkeletonCard lines={3} />
          <SkeletonCard>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </SkeletonCard>
        </WithAside>
      </Screen>
    </div>
  );
}
