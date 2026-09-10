// Tenant public site shell: brand tokens from firms.brand as CSS variables,
// tenant header/footer and site navigation. Served by the middleware rewrite
// from the firm's own host (or ?firm= in dev).

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { firmBySlug } from "@/lib/tenant";
import { brandFontsUrl, brandStyle } from "@/lib/brand";

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
