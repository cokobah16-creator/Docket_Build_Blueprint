import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { resolveFirm } from "@/lib/tenant";

// Per-tenant web app manifest: name and colours from the firm's brand.
// Dotted paths skip the middleware, so the firm is resolved from the host here.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const h = await headers();
  const firm = await resolveFirm(h.get("x-forwarded-host") ?? h.get("host"), null);
  const name = firm?.name ?? "Docket";
  const primary = firm?.brand?.colours?.primary ?? "#0F2A44";
  const surface = firm?.brand?.colours?.surface ?? "#F7F5F0";
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
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
