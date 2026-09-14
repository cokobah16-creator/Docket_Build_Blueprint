// The 404 in the staff console — a matter, an invoice, an appointment or an
// import batch that is not there, or that belongs to another firm.
//
// WHERE THIS RENDERS. The boundary is at app/firm, above the (console) route
// group, so when a console page throws notFound() the console shell goes with
// it: no sidebar, no firm name, no switcher. The way out is therefore written
// on the page rather than left to navigation that is not on screen.
//
// NO FIRM'S COLOURS, and here that is a rule rather than an accident: the
// console is Docket's own working tool and is deliberately near-monochrome, so
// the buttons are `neutral` — ink on paper, the console's own palette — and not
// `primary`, which would resolve to whatever brand tokens happen to be in scope.
//
// "Not there" and "belongs to another firm" are the same screen, deliberately.
// The console pages that call notFound() do it for both, because a message that
// distinguished them would tell a member of one firm that a suit number exists
// at another.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";

export default function ConsoleNotFound() {
  return (
    // `bg-paper` rather than whatever the body is painted: the body's ground is
    // var(--dk-surface), a fixed light colour, and every token used below flips
    // with the theme. In light mode paper IS that colour, so this changes
    // nothing today and keeps the page readable on a phone set to dark.
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 bg-paper px-4 py-10">
      <Alert kind="notice" icon="search" title="This page is not here">
        There is no record at this address for the firm you are signed in to. It may have been
        closed or deleted, or it may belong to another firm — if you act for more than one, check
        which firm the console is showing before opening the link again.
      </Alert>

      <div className="flex flex-col gap-3">
        <Link href="/firm" className={buttonClasses("neutral", "lg", "w-full")}>
          Go to Today
        </Link>
        {/* Not buttonClasses("ghost"): its foreground is `text-brand`, and a
            tenant token has no business on a Docket-owned surface even where —
            as here, with no firm's style in scope — it would only ever resolve
            to the platform default. Ink on a raised ground, and the border
            darkens on hover, as the console's own cards do. */}
        <Link
          href="/firm/matters"
          className="inline-flex min-h-[50px] w-full items-center justify-center rounded-control border border-edge bg-raised px-6 text-15 font-semibold text-ink-strong transition duration-fast hover:border-ink-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong"
        >
          Open the matters list
        </Link>
      </div>
    </main>
  );
}
