// The 404 inside the client portal — a matter, an invoice, an appointment or a
// thread that this account cannot see, or that is no longer there.
//
// WHERE THIS RENDERS. The boundary is at app/app, which is above the (portal)
// route group, so when a portal page throws notFound() the portal shell goes
// with it: no navigation, no firm name, no brand. That is why the way out is
// spelled out here rather than left to a bottom bar that is not on screen, and
// why the button is the platform's default navy — no firm has been resolved at
// this point, so there is no firm's colour to wear.
//
// It is deliberately the same full-screen shape as app/error.tsx: one plain
// sentence about what happened, then the ways forward. Nothing is said about
// why the row could not be read. "Not yours" and "not there" are the same
// screen on purpose — the portal must not become a way of confirming that some
// other client's matter exists.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function PortalNotFound() {
  return (
    // `bg-paper` rather than whatever the body is painted: the body's ground is
    // var(--dk-surface), a fixed light colour, and every token used below flips
    // with the theme. In light mode paper IS that colour, so this changes
    // nothing today and keeps the page readable the moment somebody opens it on
    // a phone set to dark.
    //
    // It is on a WRAPPER and not on the column, because the column is max-w-md:
    // a dark ground painted only there is a near-black strip down the middle of
    // a cream desktop window, which is a worse answer than no dark ground at
    // all. dvh rather than vh for the reason the root layout gives — on a phone
    // vh is the taller viewport the URL bar is hiding behind.
    <div className="min-h-[100dvh] bg-paper">
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-5 px-4 py-10">
        {/* The heading is an <h1> rather than the Alert's `title`, which renders as a
            <p>. Without one this screen had no heading at all: a screen-reader user
            navigating by heading landed on a page with nothing to land on, and the
            document kept the layout's "Docket" as its title. The Alert keeps the
            explanation and drops its own title so the sentence is not said twice. */}
        <h1 className="text-21 font-bold tracking-[-0.02em] text-ink-strong">This page is not here</h1>

        <Alert kind="notice" icon="search">
          Whatever was at this address is not available to you now. A link in an old email or
          message may point at something that has since changed, and a page only opens for the
          account it belongs to. Nothing you have sent or paid for is affected.
        </Alert>

        <div className="flex flex-col gap-3">
          <Link href="/app" className={buttonClasses("primary", "lg", "w-full")}>
            Go to your home screen
          </Link>
          {/* `ghost` is already ink on a raised ground with a stated focus ring
              — it stopped writing in the tenant's colour when button.tsx moved
              the secondary label to `text-ink-strong`. Hand-rolling the same
              shape here would be a thirteenth opinion about what a secondary
              button is, and it would miss the press state: the variant carries
              the current-colour overlay, so this link darkens under a thumb
              like every other secondary in the app. */}
          <Link href="/app/messages" className={buttonClasses("ghost", "lg", "w-full")}>
            Message your firm
          </Link>
        </div>
      </main>
    </div>
  );
}
