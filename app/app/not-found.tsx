// The 404 inside the client portal — a matter, an invoice, an appointment or a
// thread that this account cannot see, or that is no longer there.
//
// WHERE THIS RENDERS. The boundary is at app/app, which is above the (portal)
// route group, so when a portal page throws notFound() the portal shell goes
// with it: no navigation, no firm name, no brand. That is why the way out is
// spelled out here rather than left to a bottom bar that is not on screen.
//
// BOTH WAYS OUT ARE THEME NEUTRALS, and the first of them used to be `primary`.
// With no firm resolved there is no firm's colour for `bg-brand` to wear, so it
// falls back to the :root --dk-primary — the literal navy #1c2b3a, the one
// --dk-primary in the app that brandStyle() has not derived a dark counterpart
// for. Against `bg-paper` in dark that navy sits at 1.21:1, which fails SC
// 1.4.11 for the fill and, worse, for the ring: `primary` also colours the focus
// outline with it, and at outline-offset-2 that ring is drawn on the page ground
// itself, so a keyboard user would see the focus disappear on the one control
// they most want. `neutral` is ink-strong, the theme's own near-black, which
// inverts to white in dark — fill and ring both read at about 17:1 either way.
// app/firm/not-found.tsx is already on `neutral`, from the other direction: the
// console wears no firm's colours at all. Both boundaries end up in the same
// place because at neither of them is there a firm.
//
// It is deliberately the same full-screen shape as app/error.tsx: one plain
// sentence about what happened, then the ways forward. Nothing is said about
// why the row could not be read. "Not yours" and "not there" are the same
// screen on purpose — the portal must not become a way of confirming that some
// other client's matter exists.

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
// person sees in a tab and in a history list; ignored, the page keeps the bare
// "Docket" it has today. The <h1> below carries the half of this that does not
// depend on the framework, and is the half a screen-reader user navigates by.
export const metadata = { title: "Page not found" };

export default function PortalNotFound() {
  return (
    // `bg-paper` on a WRAPPER and not on the column, because the column is
    // max-w-md: a ground painted only there is a strip down the middle of a
    // desktop window with the canvas showing either side of it. dvh rather than
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
            all to anything else. Until this line a screen-reader user navigating by
            heading found nothing on the page to land on. The Alert keeps the
            explanation and has given up its own title, so the sentence is said once
            rather than twice.

            Ink, and no `font-heading`. This file renders OUTSIDE the portal shell,
            so neither brandStyle() nor a console’s tokens are in scope here:
            --dk-font-heading would fall back to the :root default Georgia, a serif
            nobody chose for this screen, on a page whose every other word is
            system-ui. `text-ink-strong` is the theme’s own near-black and inverts
            in dark, which a literal would not. */}
        <h1 className="text-21 font-bold tracking-[-0.02em] text-ink-strong sm:text-26">
          This page is not here
        </h1>

        <Alert kind="notice" icon="search">
          Whatever was at this address is not available to you now. A link in an old email or
          message may point at something that has since changed, and a page only opens for the
          account it belongs to. Nothing you have sent or paid for is affected.
        </Alert>

        <div className="flex flex-col gap-3">
          <Link href="/app" className={buttonClasses("neutral", "lg", "w-full")}>
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
