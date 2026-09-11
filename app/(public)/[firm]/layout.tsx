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
import { brandFontsUrl, brandStyle } from "@/lib/brand";
import { FUNNEL, VISITOR_COOKIE, capture } from "@/lib/observability";

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
    void capture(FUNNEL.siteViewed, visitorId, { firm_id: firm.id, firm_slug: firm.slug }).catch(
      () => undefined,
    );
  }

  const fontsUrl = brandFontsUrl(firm.brand);
  const base = `/${firm.slug}`;

  return (
    <div style={brandStyle(firm.brand)} className="min-h-screen bg-brand-surface">
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link href={base} className="font-heading text-lg font-semibold text-brand">
            {firm.name}
          </Link>
          <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={`${base}${item.href}`}
                className="text-sm font-medium text-gray-600 hover:text-brand"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/app/login" className="text-sm font-medium text-gray-600 hover:text-brand">
              Client sign in
            </Link>
            <Link
              href={`${base}/book`}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {firm.brand.cta ?? "Book a Consultation"}
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 border-t border-black/5 bg-white">
        <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 text-sm text-gray-500">
          {firm.policies.disclaimer?.text ? <p>{String(firm.policies.disclaimer.text)}</p> : null}
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href={`${base}/terms`} className="hover:text-brand">Terms of service</Link>
            <Link href={`${base}/privacy`} className="hover:text-brand">Privacy notice</Link>
            <Link href={`${base}/contact`} className="hover:text-brand">Contact</Link>
          </p>
          <p>
            © {new Date().getFullYear()} {firm.legal_name ?? firm.name} · Powered by Docket
          </p>
        </div>
      </footer>
    </div>
  );
}
