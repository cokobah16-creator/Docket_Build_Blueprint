// Request-derived site helpers for server components and route handlers.

import { headers } from "next/headers";
import type { FirmPublic } from "@/lib/db/types";

/** Absolute origin of the current request (used for callbacks, sitemap, OG). */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Public-site path prefix for a firm: on its own host the prefix is empty
 *  (middleware rewrites), on a shared host it is /{slug}. Links use the
 *  explicit /{slug} form, which works on both. */
export function firmPath(firm: FirmPublic, path = ""): string {
  return `/${firm.slug}${path}`;
}

/** schema.org LegalService for the tenant home page. */
export function legalServiceJsonLd(firm: FirmPublic, origin: string) {
  const c = firm.brand.contact ?? {};
  return {
    "@context": "https://schema.org",
    "@type": "LegalService",
    name: firm.name,
    legalName: firm.legal_name ?? firm.name,
    url: `${origin}/${firm.slug}`,
    description: firm.brand.tagline ?? undefined,
    telephone: c.phone ?? undefined,
    email: c.email ?? undefined,
    address: c.address ? { "@type": "PostalAddress", streetAddress: c.address, addressCountry: "NG" } : undefined,
    areaServed: "NG",
  };
}
