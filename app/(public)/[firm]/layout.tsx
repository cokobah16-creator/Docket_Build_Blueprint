// Tenant public site shell: brand tokens from firms.brand as CSS variables,
// tenant header/footer and site navigation. Served by the middleware rewrite
// from the firm's own host (or ?firm= in dev).
//
// STEP ONE OF THE FUNNEL LIVES HERE. Every page of a firm's site — home, services, a lawyer's
// profile, the booking wizard — renders inside this layout, so this is the one place that sees
// every visit, and site_viewed is emitted from here rather than from any single page.
//
// The distinct id is the visitor cookie middleware.ts mints (VISITOR_COOKIE), not a person:
// nobody has signed in yet at this point in the funnel. identify() in app/auth/callback/route.ts
// later stitches that anonymous id to the account. Only firm_id and firm_slug travel with the
// event — data about which site was viewed, never anything about who viewed it.
//
// ONLY WITH CONSENT. consentedVisitorId() returns an id only when POSTHOG_KEY is set and this
// visitor chose "Allow analytics" in the cookie banner. Otherwise nothing is sent.
//
// Reading cookies() here also settles how this route renders: a Dynamic API makes the whole
// tenant subtree render per request, which is the only way a server-side capture can fire on
// every visit. A statically rendered route would emit this once, at build time, and never again.
// consentedVisitorId() reads cookies() on every call, analytics on or off, so this still holds.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { firmBySlug } from "@/lib/tenant";
import { brandFontsUrl, brandStyle, tenantAllowsDark } from "@/lib/brand";
import { FUNNEL, capture } from "@/lib/observability";
import { consentedVisitorId } from "@/lib/observability/consent";
import { analyticsConfigured } from "@/lib/consent-cookie";
import { CookieSettingsButton } from "@/components/ui/cookie-banner";
import { after } from "next/server";
import { ctaLabel } from "./_components/site-words";

const URGENT_HREF = "/urgent";

// The header strip and the footer's "Firm" column.
const NAV = [
  { href: "/about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/lawyers", label: "Lawyers" },
  { href: "/contact", label: "Contact" },
  { href: URGENT_HREF, label: "Urgent help" },
];

// The focus ring is drawn inside the link: the strip scrolls, and a ring outside it is clipped.
const NAV_LINK =
  "min-h-[48px] shrink-0 items-center border-b-2 border-transparent text-13 font-medium text-ink-muted hover:border-brand-accent hover:text-brand " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

// The header's booking button, the site's main action on a page that draws none of its own. A
// page that does draw one (a booking button of its own, "Go to the home page" on the 404, "Call
// 112" on Urgent help) puts data-header-cta="quiet" on the element around it, and this turns
// into a ghost button there, so every screen keeps exactly one filled button (docs/VOICE.md,
// rule 15). It is CSS rather than a prop because a layout is not rendered again when a visitor
// moves between its pages, so only the page that is showing can say what it holds. Where :has()
// is not supported the button simply stays filled.
const HEADER_CTA =
  "inline-flex min-h-[44px] items-center rounded-control border border-transparent bg-brand px-4 text-13 font-semibold text-brand-on hover:opacity-90 sm:px-5 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
  "group-has-[[data-header-cta=quiet]]/site:border-edge group-has-[[data-header-cta=quiet]]/site:bg-raised " +
  "group-has-[[data-header-cta=quiet]]/site:text-ink-strong group-has-[[data-header-cta=quiet]]/site:focus-visible:outline-ink-strong";

// 44px rows rather than a gap, so every footer link is a whole tap target (DESIGN.md).
const FOOTER_LINK =
  "inline-flex min-h-11 items-center opacity-80 hover:opacity-100 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export default async function FirmLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ firm: string }>;
}) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();

  // Fired and ignored. A visitor with no id (no consent, or a request the middleware matcher
  // never saw) is simply not counted rather than counted as somebody made up.
  const visitorId = await consentedVisitorId();
  if (visitorId) {
    // after() runs this once the response has been sent. An un-awaited fetch in a serverless
    // function is not guaranteed to finish — the instance can be frozen the moment the response
    // flushes — so a bare `void capture(...)` loses events, most of all on small fast responses.
    after(() =>
      capture(FUNNEL.siteViewed, visitorId, { firm_id: firm.id, firm_slug: firm.slug }).catch(
        () => undefined,
      ),
    );
  }

  const fontsUrl = brandFontsUrl(firm.brand);
  const base = `/${firm.slug}`;
  const allowDark = tenantAllowsDark(firm.brand);

  return (
    // The firm's own shop window, so dark is the firm's call rather than ours:
    // tenantAllowsDark() is false unless they opted in, and brandStyle() then emits
    // the light values for both schemes, which pins the page to the colours they chose.
    //
    // The theme's NEUTRALS have to be pinned with them, and that is the whole reason
    // data-theme-scope is here. Holding the brand colours light while --t-paper,
    // --t-raised and --t-ink went on following the visitor's OS is the worst of both:
    // a firm's navy heading would be sitting on a near-black card at 1.20:1, which is
    // the exact failure this file's colours were re-toned to prevent. Opting out of
    // dark means opting out of all of it.
    <div
      data-brand
      data-theme-scope={allowDark ? undefined : "light"}
      style={brandStyle(firm.brand, { allowDark })}
      className="firm-site-os group/site min-h-screen bg-brand-surface"
    >
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <header className="firm-site-header bg-raised">
        <div className="bg-brand text-brand-on">
          <div className="mx-auto flex min-h-[34px] max-w-[1180px] items-center justify-between gap-4 px-4 text-11 sm:px-6 lg:px-8">
            <p className="font-medium">Book a consultation online. Follow your matter from your phone.</p>
            <p className="hidden opacity-75 sm:block">Powered by Docket</p>
          </div>
        </div>
        <div className="border-b border-hairline">
          <div className="mx-auto flex min-h-[82px] max-w-[1180px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
            <Link href={base} className="group flex min-w-0 items-center gap-3.5 rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand font-heading text-17 font-semibold text-brand-on">
                {firm.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-heading text-21 font-semibold tracking-[-0.025em] text-brand sm:text-26">
                  {firm.name}
                </span>
                {/* Shown for every firm, which is safe because every firm here is a law firm:
                    firm_public lists active firms only, and the platform makes a firm active
                    once it has verified it, its owner's SCN included (migration 12). */}
                <span className="hidden text-11 font-semibold uppercase tracking-[0.12em] text-ink-muted sm:block">
                  Legal practitioners
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2.5">
              <Link href="/app/login" className="hidden min-h-[44px] items-center rounded-control px-3 text-13 font-semibold text-ink-muted hover:text-brand sm:inline-flex focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Client portal
              </Link>
              <Link href={`${base}/book`} className={HEADER_CTA}>
                {ctaLabel(firm.brand)}
              </Link>
            </div>
          </div>
        </div>
        <nav aria-label="Site" className="firm-site-links border-b border-hairline bg-raised">
          <div className="mx-auto flex max-w-[1180px] items-center gap-6 overflow-x-auto px-4 sm:px-6 lg:px-8">
            <Link href={base} className="inline-flex min-h-[48px] shrink-0 items-center border-b-2 border-brand text-13 font-semibold text-brand focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
              Home
            </Link>
            {/* On a phone this strip scrolls sideways with no scrollbar showing, and at 360px
                only the first four or five items fit. Urgent help is the one link somebody in
                trouble must not have to find by scrolling, so on a phone it comes straight
                after Home; from sm up the whole strip fits and it takes its place at the end. */}
            <Link href={`${base}${URGENT_HREF}`} className={`inline-flex sm:hidden ${NAV_LINK}`}>
              Urgent help
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={`${base}${item.href}`}
                className={`${item.href === URGENT_HREF ? "hidden sm:inline-flex" : "inline-flex"} ${NAV_LINK}`}
              >
                {item.label}
              </Link>
            ))}
            <Link href="/app/login" className={`inline-flex sm:hidden ${NAV_LINK}`}>
              Client portal
            </Link>
          </div>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="mt-20 bg-brand text-brand-on">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
          <div>
            <p className="font-heading text-26 tracking-[-0.025em]">{firm.name}</p>
            {firm.brand.tagline && <p className="mt-3 max-w-[42ch] text-13 leading-5 opacity-75">{firm.brand.tagline}</p>}
            {firm.policies.disclaimer?.text ? <p className="mt-4 max-w-[54ch] text-11 leading-4 opacity-[0.65]">{String(firm.policies.disclaimer.text)}</p> : null}
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.12em] opacity-60">Firm</p>
            <div className="mt-2 flex flex-col items-start text-13">
              {NAV.map((item) => <Link key={item.href} href={`${base}${item.href}`} className={FOOTER_LINK}>{item.label}</Link>)}
            </div>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.12em] opacity-60">Client access</p>
            <div className="mt-2 flex flex-col items-start text-13">
              <Link href={`${base}/book`} className={FOOTER_LINK}>Book a consultation</Link>
              <Link href="/app/login" className={FOOTER_LINK}>Client portal</Link>
              <Link href={`${base}/privacy`} className={FOOTER_LINK}>Privacy notice</Link>
              <Link href={`${base}/terms`} className={FOOTER_LINK}>Terms of service</Link>
              {/* Only where the banner can appear, so the control never opens nothing. A 44px
                  row like the links above it. */}
              {analyticsConfigured() && (
                <CookieSettingsButton className={`${FOOTER_LINK} text-left`} />
              )}
            </div>
          </div>
        </div>
        {/* The rule is the footer's own text colour (brand-on) at 15%, not white: on a firm whose
            colour is light, brand-on is dark and a white rule would not show. */}
        <div className="border-t border-[color-mix(in_srgb,currentColor_15%,transparent)]">
          <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-3 px-4 py-5 text-11 opacity-[0.65] sm:px-6 lg:px-8">
            <p>© {new Date().getFullYear()} {firm.legal_name ?? firm.name}</p>
            <p>Booking and client portal by Docket</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
