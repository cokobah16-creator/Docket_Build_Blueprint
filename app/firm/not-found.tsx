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

// The document title, IF Next.js takes one from here — and that is not certain
// enough to write down as a fact. Metadata is resolved from the segments of the
// route that MATCHED, and a not-found.tsx is a boundary rather than a segment of
// one: on the root /_not-found it stands in as that route's page and is read, but
// nothing in Next's contract promises the same at a nested boundary like this.
// It is exported anyway because the two outcomes are "better" and "unchanged" —
// read, the root layout's template makes it "Page not found · Docket", what a
// lawyer sees in a tab and in a history list; ignored, the page keeps the bare
// "Docket" it has today. The <h1> below carries the half of this that does not
// depend on the framework, and is the half a screen-reader user navigates by.
export const metadata = { title: "Page not found" };

export default function ConsoleNotFound() {
  return (
    // `bg-paper` on a WRAPPER and not on the column, because the column is
    // max-w-md: a ground painted only there is a strip down the middle of a
    // desktop window with the canvas showing either side of it, and a lawyer
    // hits this screen from a laptop as often as from a phone. dvh rather than
    // vh for the reason the root layout gives — on a phone vh is the taller
    // viewport the URL bar is hiding behind.
    //
    // The body behind this now resolves to the same token — app/globals.css
    // paints the canvas rgb(var(--t-paper)) rather than the fixed cream it used
    // to — so the two agree in both themes. The ground is still stated here
    // rather than inherited: it is what the design linter measures this text
    // against, and a full-height screen should not depend on a rule two files
    // away staying scoped the way it is today.
    <div className="min-h-[100dvh] bg-paper">
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-5 px-4 py-10">
        {/* A real <h1>, not the Alert’s `title` — that renders as a
            <p class="font-semibold">, which is a heading to the eye and nothing at
            all to anything else. Until this line a lawyer navigating by heading found
            nothing on the page to land on. The Alert keeps the explanation and has
            given up its own title, so the sentence is said once rather than twice.

            Ink, and no `font-heading`, which is also what keeps this monochrome. The
            file renders OUTSIDE the console shell, so CONSOLE_TOKENS are not in scope
            and --dk-font-heading would fall back to the :root default Georgia — a
            serif that is neither the console’s Archivo nor anything anyone chose for
            this screen. `text-ink-strong` is the theme’s own near-black, inverts in
            dark where a literal #141414 would not, and is a Docket neutral rather
            than a tenant token. */}
        <h1 className="text-21 font-bold tracking-[-0.02em] text-ink-strong sm:text-26">
          This page is not here
        </h1>

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
