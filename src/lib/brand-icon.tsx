// Brand icon rendered on demand: firm initial on the primary colour (ImageResponse → PNG).
import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { resolveFirm } from "@/lib/tenant";

export async function brandIcon(size: number): Promise<Response> {
  const h = await headers();
  const firm = await resolveFirm(h.get("x-forwarded-host") ?? h.get("host"), null);
  const primary = firm?.brand?.colours?.primary ?? "#0F2A44";
  const accent = firm?.brand?.colours?.accent ?? "#B08D57";
  const initial = (firm?.name ?? "Docket").trim().charAt(0).toUpperCase() || "D";
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: primary, color: "#FFFFFF", fontSize: Math.round(size * 0.58), fontWeight: 700, fontFamily: "serif", borderRadius: Math.round(size * 0.18) }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.round(size * 0.08), background: accent }} />
        {initial}
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=3600" } },
  );
}
