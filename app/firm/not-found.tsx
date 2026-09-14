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

export const metadata = { title: "Page not found" };

export default function ConsoleNotFound() {
  return (
    // `bg-paper` rather than whatever the body is painted: the body's ground is
    // var(--dk-surface), a fixed light colour, and every token used below flips
    // with the theme. In light mode paper IS that colour, so this changes
    // nothing today and keeps the page readable on a phone set to dark.
    //
    // It is on a WRAPPER and not on the column, because the column is max-w-md:
    // a dark ground painted only there is a near-black strip down the middle of
    // a cream desktop window, and a lawyer hits this screen from a laptop as
    // often as from a phone. dvh rather than vh for the reason the root layout
    // gives — on a phone vh is the taller viewport the URL bar is hiding behind.
    <div className="min-h-[100dvh] bg-paper">
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-5 px-4 py-10">
        {/* An <h1> rather than the Alert's `title`, which renders as a <p>. Without
            one this screen had no heading and the document kept the layout's title,
            so a lawyer using a screen reader had nothing to navigate to. The Alert
            keeps the explanation and drops its own title. */}
        <h1 className="text-21 font-bold tracking-[-0.02em] text-ink-strong">This page is not here</h1>

        <Alert kind="notice" icon="search">
          There is no record at this address for the firm you are signed in to. It may have been
          closed or deleted, or it may belong to another firm — if you act for more than one,
          check which firm the console is showing before opening the link again.
        </Alert>

        <div className="flex flex-col gap-3">
          <Link href="/firm" className={buttonClasses("neutral", "lg", "w-full")}>
            Go to Today
          </Link>
          {/* `ghost` is safe on a Docket-owned surface: `border-edge`,
              `bg-raised` and `text-ink-strong` are all theme neutrals, so no
              tenant token reaches this screen. It used to carry `text-brand`,
              which is why the console avoided it; button.tsx moved the
              secondary label to ink for exactly this reason, so the reason to
              hand-roll the shape here is gone — and the variant brings the
              press state with it. */}
          <Link href="/firm/matters" className={buttonClasses("ghost", "lg", "w-full")}>
            Open the matters list
          </Link>
        </div>
      </main>
    </div>
  );
}
