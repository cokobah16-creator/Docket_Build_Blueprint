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
// Reading cookies() here also settles how this route renders: a Dynamic API makes the whole
// tenant subtree render per request, which is the only way a server-side capture can fire on
// every visit. A statically rendered route would emit this once, at build time, and never again.

import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { firmBySlug } from "@/lib/tenant";
import { brandFontsUrl, brandStyle, tenantAllowsDark } from "@/lib/brand";
import { FUNNEL, VISITOR_COOKIE, capture } from "@/lib/observability";
import { after } from "next/server";

const NAV = [
  { href: "/about", label: "About" },
  { href: "/services", label: "Services" },
  { href: "/lawyers", label: "Lawyers" },
  { href: "/contact", label: "Contact" },
];

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

  // Fired and ignored. A visitor with no cookie (a request the middleware matcher never saw)
  // is simply not counted rather than counted as somebody made up.
  const visitorId = (await cookies()).getAll().find((c) => c.name === VISITOR_COOKIE)?.value;
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
      className="firm-site-os min-h-screen bg-brand-surface"
    >
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <header className="firm-site-header bg-raised">
        <div className="bg-brand text-brand-on">
          <div className="mx-auto flex min-h-[34px] max-w-[1180px] items-center justify-between gap-4 px-4 text-11 sm:px-6 lg:px-8">
            <p className="font-medium">Secure legal services and client access</p>
            <p className="hidden opacity-75 sm:block">Powered by Docket</p>
          </div>
        </div>
        <div className="border-b border-hairline">
          <div className="mx-auto flex min-h-[82px] max-w-[1180px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8">
            <Link href={base} className="group flex min-w-0 items-center gap-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand font-heading text-17 font-semibold text-brand-on">
                {firm.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-heading text-21 font-semibold tracking-[-0.025em] text-brand sm:text-26">
                  {firm.name}
                </span>
                <span className="hidden text-11 font-semibold uppercase tracking-[0.12em] text-ink-muted sm:block">
                  Legal practitioners
                </span>
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2.5">
              <Link href="/app/login" className="hidden min-h-[44px] items-center px-3 text-13 font-semibold text-ink-muted hover:text-brand sm:inline-flex">
                Client portal
              </Link>
              <Link
                href={`${base}/book`}
                className="inline-flex min-h-[44px] items-center rounded-control bg-brand px-4 text-13 font-semibold text-brand-on hover:opacity-90 sm:px-5"
              >
                {firm.brand.cta ?? "Book a Consultation"}
              </Link>
            </div>
          </div>
        </div>
        <nav aria-label="Site" className="firm-site-links border-b border-hairline bg-raised">
          <div className="mx-auto flex max-w-[1180px] items-center gap-6 overflow-x-auto px-4 sm:px-6 lg:px-8">
            <Link href={base} className="inline-flex min-h-[48px] shrink-0 items-center border-b-2 border-brand text-13 font-semibold text-brand">
              Home
            </Link>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={`${base}${item.href}`}
                className="inline-flex min-h-[48px] shrink-0 items-center border-b-2 border-transparent text-13 font-medium text-ink-muted hover:border-brand-accent hover:text-brand"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/app/login" className="inline-flex min-h-[48px] shrink-0 items-center border-b-2 border-transparent text-13 font-medium text-ink-muted hover:border-brand-accent hover:text-brand sm:hidden">
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
            <div className="mt-4 flex flex-col gap-3 text-13">
              {NAV.map((item) => <Link key={item.href} href={`${base}${item.href}`} className="opacity-80 hover:opacity-100">{item.label}</Link>)}
            </div>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.12em] opacity-60">Client access</p>
            <div className="mt-4 flex flex-col gap-3 text-13">
              <Link href={`${base}/book`} className="opacity-80 hover:opacity-100">Book a consultation</Link>
              <Link href="/app/login" className="opacity-80 hover:opacity-100">Client portal</Link>
              <Link href={`${base}/privacy`} className="opacity-80 hover:opacity-100">Privacy notice</Link>
              <Link href={`${base}/terms`} className="opacity-80 hover:opacity-100">Terms of service</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/15">
          <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-3 px-4 py-5 text-11 opacity-[0.65] sm:px-6 lg:px-8">
            <p>© {new Date().getFullYear()} {firm.legal_name ?? firm.name}</p>
            <p>Client service infrastructure by Docket</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
