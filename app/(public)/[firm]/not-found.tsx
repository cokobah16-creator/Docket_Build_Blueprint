// The 404 on a firm's own public site — an unknown service, an unknown lawyer,
// an address someone typed from memory.
//
// WHICH 404 THIS IS, AND WHICH IT IS NOT. A not-found.tsx catches notFound()
// thrown below it, and it renders inside its own segment's layout. So this file
// covers the pages under app/(public)/[firm], where layout.tsx has already
// resolved the firm and set the brand variables — the header, the navigation
// and the footer above and below this are that firm's own, and so are the
// colours here. It does NOT cover an unknown firm: layout.tsx throws notFound()
// itself in that case, a layout that throws never renders the boundary inside
// it, and that one lands on app/not-found.tsx, which wears Docket's colours
// because at that point there is no firm to wear.
//
// THE WAY OUT HAS NO SLUG IN IT. Next.js passes a not-found.tsx no params, so
// this file cannot name the firm it is standing in. It does not need to: on the
// firm's own host — its domain, or its {slug}.docket.app — the middleware
// resolves the host and rewrites "/" onto that firm's home page, so "/" is the
// firm's home and not Docket's. (On a preview host, where a firm is reached
// with ?firm=, "/" is Docket's landing instead; the firm's own navigation is
// still above this page either way.)

import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { PageShell } from "./_components/page-shell";

export default function FirmSiteNotFound() {
  return (
    <PageShell
      title="This page is not here"
      intro="The page you were looking for is not on this site. It may have been moved, or the address may be slightly wrong."
    >
      <div className="flex flex-col gap-5">
        <p className="text-15 text-ink-muted">
          Everything this firm publishes is reachable from the menu at the top of the page — the
          services it offers, the lawyers who act, and how to book a consultation.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={buttonClasses("primary", "lg")}>
            Go to the home page
          </Link>
          {/* Not buttonClasses("ghost"): it fills with `bg-raised`, which flips
              for dark mode, and the firm's surface underneath it does not — the
              same reason every secondary button on this site is a border and
              the firm's own ink over the firm's own ground. The hover is
              `bg-hover` rather than `bg-black/5` for the same reason in
              reverse: a black wash is invisible on a dark ground, and
              `bg-hover` is ink at 5%, which flips with the theme. */}
          <Link
            href="/app/login"
            className="inline-flex min-h-[50px] items-center justify-center rounded-control border border-edge px-6 text-15 font-semibold text-brand transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Client sign in
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
