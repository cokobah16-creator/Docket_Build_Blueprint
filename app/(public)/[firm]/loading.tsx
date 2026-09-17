// What a visitor sees while a firm's public page is being built on the server.
//
// This is the brand-critical surface: somebody who has just been given a firm's
// address is deciding, in the first second, whether this firm looks like one
// that answers its phone. A blank white pause is the wrong first answer, so the
// firm's own header and footer (the layout) stay up and this stands in for the
// page between them — the hero, the three steps, the grid of services.
//
// It renders INSIDE app/(public)/[firm]/layout.tsx, so the brand variables are
// already set and these blocks sit on the firm's own surface. What it cannot
// cover is the layout's own firm lookup, which runs before this boundary
// exists; firmBySlug caches for a minute (src/lib/tenant.ts), so in practice
// the wait this file is standing in for is the page's own reads — services,
// lawyers, the site origin.
//
// IT COVERS THE WHOLE SITE AND IS DRAWN AS THE HOME PAGE. Every route under
// this segment with no nearer loading.tsx arrives here — About, Services, a
// lawyer's profile, the booking wizard, the policies — and the ones built on
// PageShell are a narrower column than this. The home page is the shape chosen
// because it is the one an address handed out on a card lands on, and because
// its own top is a heading and two lines of prose, which is what PageShell puts
// there too: the part of the screen a visitor reads first stands in the right
// place on every route, and only the width below it is generous.

import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function FirmSiteLoading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-5xl px-4">
      <span className="sr-only">Loading…</span>

      {/* The hero: two lines of headline, two of prose, then the booking pair. */}
      <section className="py-16 sm:py-24">
        <Skeleton height={36} className="w-full max-w-2xl" />
        <Skeleton height={36} className="mt-3 w-3/4 max-w-xl" />
        <Skeleton height={16} className="mt-6 w-full max-w-xl" />
        <Skeleton height={16} className="mt-2.5 w-2/3 max-w-xl" />
        <div className="mt-8 flex flex-wrap gap-3">
          <Skeleton radius="control" width={196} height={52} />
          <Skeleton radius="control" width={182} height={52} />
        </div>
      </section>

      {/* How it works — three steps, side by side from tablet up. */}
      <section className="pb-16">
        <Skeleton height={24} className="w-40" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-card border border-hairline bg-raised p-5">
              <Skeleton height={11} className="w-14" />
              <Skeleton height={16} className="mt-2 w-2/3" />
              <Skeleton height={12} className="mt-2.5 w-full" />
              <Skeleton height={12} className="mt-2 w-4/5" />
            </div>
          ))}
        </div>
      </section>

      {/* How we can help — the services grid. */}
      <section className="pb-16">
        <Skeleton height={24} className="w-48" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonCard key={i} header={false} lines={3} />
          ))}
        </div>
      </section>
    </div>
  );
}
