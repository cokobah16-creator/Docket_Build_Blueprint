import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { resolveFirm } from "@/lib/tenant";
import { DEFAULT_TOKENS } from "@/lib/brand";

// Per-tenant web app manifest: name and colours from the firm's brand.
// Dotted paths skip the middleware, so the firm is resolved from the host here.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers();
  const firm = await resolveFirm(h.get("x-forwarded-host") ?? h.get("host"), null);
  const name = firm?.name ?? "Docket";
  const primary = firm?.brand?.colours?.primary ?? DEFAULT_TOKENS.primary;
  const surface = firm?.brand?.colours?.surface ?? DEFAULT_TOKENS.surface;
  return {
    name,
    short_name: name.length > 12 ? name.split(" ")[0] : name,
    description: firm?.brand?.tagline ?? "Book a consultation, meet your lawyer, track your matter.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: surface,
    theme_color: primary,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Its own artwork, not the same square again: Android crops a maskable
      // icon to the centre 40% radius. See src/lib/brand-icon.tsx.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
