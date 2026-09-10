// Tenant public site shell: brand tokens from firms.brand as CSS variables,
// tenant header and footer. Served by the middleware rewrite from the
// firm's own host (or ?firm= in dev).

import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { firmBySlug } from "@/lib/tenant";
import { brandFontsUrl, brandStyle } from "@/lib/brand";

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

  return (
    <div style={brandStyle(firm.brand)} className="min-h-screen bg-brand-surface">
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
      <header className="border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href={`/${firm.slug}`} className="font-heading text-lg font-semibold text-brand">
            {firm.name}
          </Link>
          <nav aria-label="Site" className="flex items-center gap-3">
            <Link
              href="/app/login"
              className="hidden text-sm font-medium text-gray-600 hover:text-brand sm:block"
            >
              Client sign in
            </Link>
            <Link
              href={`/${firm.slug}/book`}
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
          {firm.policies.disclaimer?.text ? (
            <p>{String(firm.policies.disclaimer.text)}</p>
          ) : null}
          <p>
            © {new Date().getFullYear()} {firm.name} · Powered by Docket
          </p>
        </div>
      </footer>
    </div>
  );
}
