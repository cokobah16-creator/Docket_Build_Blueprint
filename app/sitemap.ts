import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { resolveFirm } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { publicLawyers } from "@/lib/public-data";
import { siteOrigin } from "@/lib/site";

// Middleware skips /sitemap.xml (dotted path), so resolve the tenant here.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers();
  const origin = await siteOrigin();
  const firm = await resolveFirm(h.get("x-forwarded-host") ?? h.get("host"), null);
  if (!firm) return [{ url: origin, changeFrequency: "monthly", priority: 0.5 }];

  const [services, lawyers] = await Promise.all([activeServices(firm.id), publicLawyers(firm.id)]);
  const base = `${origin}/${firm.slug}`;
  const now = new Date();
  const statics = ["", "/about", "/services", "/lawyers", "/contact", "/book", "/terms", "/privacy"];
  return [
    ...statics.map((p) => ({ url: `${base}${p}`, lastModified: now, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...services.map((s) => ({ url: `${base}/services/${s.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...lawyers.map((l) => ({ url: `${base}/lawyers/${l.slug ?? l.id}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
