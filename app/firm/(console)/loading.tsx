// What a lawyer sees while a console screen is being built on the server.
//
// It is Today's own arrangement — the title block, the one search field, the
// working column, the counters beside it — because that is the screen most
// console navigations end on and the shape the rest of them share. A staff
// member opening the console on a phone at 8am is not reading it, they are
// looking for where the chase list will be, and a placeholder in the right
// place answers that a second before the data does.
//
// Near-monochrome, like the console itself: bg-sunken is a neutral tint, and no
// status colour appears here at all. A pill that turns out amber when the rows
// land has to be the first colour on the screen, not the second.
//
// It covers every console route with no nearer loading.tsx. The layout's own
// gate — session, MFA, membership — runs before this boundary exists, so that
// part of a cold request is still a pause this file cannot reach.

import { CardGrid, WithAside } from "@/components/shell/layout";
import { Skeleton, SkeletonCard, SkeletonRow } from "@/components/ui/skeleton";

export default function ConsoleLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>

      {/* PageHeader: the screen's name, then the firm and the date under it. */}
      <header className="flex flex-col gap-3">
        <Skeleton height={26} className="w-40 max-w-full" />
        <Skeleton height={13} className="w-72 max-w-full" />
      </header>

      <Skeleton radius="control" className="h-[46px] w-full" />

      <WithAside
        from="xl"
        aside={
          <>
            <CardGrid min="150px">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="rounded-card border border-hairline bg-raised p-3.5">
                  <Skeleton height={11} className="w-4/5" />
                  <Skeleton height={22} className="mt-2 w-8" />
                  <Skeleton height={11} className="mt-2 w-3/5" />
                </div>
              ))}
            </CardGrid>
            <Skeleton radius="card" className="h-[72px] w-full" />
          </>
        }
      >
        {/* The chase list, then the day's consultations. */}
        <SkeletonCard>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </SkeletonCard>
        <SkeletonCard>
          <SkeletonRow />
          <SkeletonRow />
        </SkeletonCard>
      </WithAside>
    </div>
  );
}
