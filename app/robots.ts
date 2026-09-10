import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/firm", "/admin", "/auth"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
