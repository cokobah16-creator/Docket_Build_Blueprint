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

export default function PortalNotFound() {
  return (
    // `bg-paper` rather than whatever the body is painted: the body's ground is
    // var(--dk-surface), a fixed light colour, and every token used below flips
    // with the theme. In light mode paper IS that colour, so this changes
    // nothing today and keeps the page readable the moment somebody opens it on
    // a phone set to dark.
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 bg-paper px-4 py-10">
      <Alert kind="notice" icon="search" title="This page is not here">
        Whatever was at this address is not available to you now. A link in an old email or
        message may point at something that has since changed, and a page only opens for the
        account it belongs to. Nothing you have sent or paid for is affected.
      </Alert>

      <div className="flex flex-col gap-3">
        <Link href="/app" className={buttonClasses("primary", "lg", "w-full")}>
          Go to your home screen
        </Link>
        {/* Not buttonClasses("ghost"): it fills with `bg-raised` and writes on
            it in `text-brand`, and a firm's brand colour does not flip for dark
            mode while bg-raised does — a dark fill under a dark navy label. Ink
            on the raised ground says the same thing in both themes. */}
        <Link
          href="/app/messages"
          className="inline-flex min-h-[50px] w-full items-center justify-center rounded-control border border-edge bg-raised px-6 text-15 font-semibold text-ink-strong transition duration-fast hover:border-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong"
        >
          Message your firm
        </Link>
      </div>
    </main>
  );
}
