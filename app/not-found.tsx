// The 404 for everything Docket owns, and — because of where Next.js puts the
// boundary — for one case that reads as a tenant's.
//
// A not-found.tsx catches notFound() thrown BELOW it, so the one in
// app/(public)/[firm] covers an unknown service or lawyer on a firm's site. But
// app/(public)/[firm]/layout.tsx throws notFound() itself when the slug resolves
// to no firm, and a layout that throws never renders the boundary inside it, so
// that throw arrives HERE — which is correct, and is why this page also answers
// the visitor who has mistyped a firm's address. It is Docket's own surface at
// that moment: there is no firm, so there is no firm to name and no brand to
// wear (law 6).
//
// The docket-* palette and data-theme-scope="light" for the same reason as
// app/page.tsx: four of the six Nigerian brand-risk mitigations in
// design/home/README.md are stated in terms of a warm LIGHT ground, and a firm
// must never be able to repaint a page of Docket's.
//
// No joke and no "oops". Somebody reaches this page on the way to a lawyer.

import Link from "next/link";
import { Archivo } from "next/font/google";

const archivo = Archivo({ subsets: ["latin"], display: "swap" });

// RENDERED PER REQUEST, ON PURPOSE — src/lib/csp.ts says why, and says it about
// this very file: /_not-found is the one prerendered route the nonce allowlist
// cannot name, because a 404 is served for whatever path was actually asked for
// and that path is never "/_not-found". While the 404 was Next's own paragraph
// of static text with no control on it, a hydration blocked by the policy cost
// a console violation and nothing a visitor could see. This screen has links on
// it, so that stops being true, and the instruction there is to make it dynamic
// at the same time. This is that.
export const dynamic = "force-dynamic";

// THE RING'S COLOUR IS STATED, on every control here. An `outline` with no
// outline-color of its own falls back to currentColor, and currentColor on the
// two filled links below is `docket-paper` — the same colour as the page they
// sit on. With `outline-offset-2` the ring is drawn ON that page, so it would
// have been paper on paper: a keyboard user tabbing through the only three ways
// off this screen would see the focus vanish on the one they most want. The
// bordered link fails the same way the moment it is hovered and focused at once,
// because the hover turns its text paper too. docket-ink reads at 15:1 on the
// paper ground whatever the link underneath is doing.
const RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-docket-ink";

const WAYS_OUT = [
  { href: "/", label: "Go to the home page", primary: true },
  { href: "/app/login", label: "Client sign in", primary: false },
  { href: "/firm/login", label: "Staff sign in", primary: false },
];

export default function NotFound() {
  return (
    <div
      data-theme-scope="light"
      className={`${archivo.className} flex min-h-[100dvh] flex-col bg-docket-paper text-docket-ink`}
    >
      <header className="border-b border-docket-hair">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Link
            href="/"
            className={`flex min-h-[44px] items-center text-21 font-extrabold tracking-[-0.03em] ${RING}`}
          >
            Docket
          </Link>
          <Link
            href="/firm/start"
            className={`inline-flex min-h-[44px] items-center bg-docket-hunter px-6 text-15 font-semibold text-docket-paper hover:bg-docket-deep ${RING}`}
          >
            Register your firm
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-16 sm:px-8 sm:py-24">
        <div className="mb-5 h-[3px] w-16 bg-docket-gold" />
        <p className="text-11 font-semibold uppercase tracking-[0.14em] text-docket-hunter">
          Page not found
        </p>
        <h1 className="mt-6 max-w-[20ch] text-26 font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-44">
          This page is not here.
        </h1>
        <p className="mt-8 max-w-[58ch] text-15 leading-[1.5] text-docket-muted-dark sm:text-21">
          The address may have been mistyped, or the page may have moved. Nothing has gone wrong
          with your account, and nothing you have done has been lost.
        </p>
        <p className="mt-5 max-w-[58ch] text-13 leading-[1.55] text-docket-muted-dark">
          If you were opening a law firm&rsquo;s site, this is also what Docket shows when the
          address does not belong to a firm here. Check it against whatever the firm gave you —
          a card, an email, a message — or ask them for it again.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          {WAYS_OUT.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className={
                w.primary
                  ? `inline-flex min-h-[44px] items-center bg-docket-hunter px-7 text-15 font-semibold text-docket-paper hover:bg-docket-deep ${RING}`
                  : `inline-flex min-h-[44px] items-center border border-docket-hunter px-5 text-13 font-semibold text-docket-hunter hover:bg-docket-hunter hover:text-docket-paper ${RING}`
              }
            >
              {w.label}
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
