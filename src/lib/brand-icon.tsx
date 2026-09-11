// Brand icon rendered on demand: firm initial on the primary colour (ImageResponse → PNG).
//
// Two shapes, because Android and iOS want different things. The "any" icon is
// the finished artwork: rounded corners, an accent bar along the foot. The
// maskable icon is drawn for a platform that will crop it — Android guarantees
// only the centre 40% radius survives — so it fills the square edge to edge,
// drops the corner radius the mask supplies itself, loses the accent bar that
// the crop would cut through, and pulls the letterform in to sit safely inside
// the circle. Serving the same artwork for both put a clipped letter and half
// an accent bar on the home screen.
import { ImageResponse } from "next/og";
import { headers } from "next/headers";
import { resolveFirm } from "@/lib/tenant";
import { DEFAULT_TOKENS, readableForeground } from "@/lib/brand";

export async function brandIcon(size: number, maskable = false): Promise<Response> {
  const h = await headers();
  const firm = await resolveFirm(h.get("x-forwarded-host") ?? h.get("host"), null);
  const primary = firm?.brand?.colours?.primary ?? DEFAULT_TOKENS.primary;
  const accent = firm?.brand?.colours?.accent ?? DEFAULT_TOKENS.accent;
  const initial = (firm?.name ?? "Docket").trim().charAt(0).toUpperCase() || "D";
  const ink = readableForeground(primary);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: primary,
          color: ink,
          // Inside the mask's safe zone the letter has to be smaller to survive
          // the crop; unmasked it can fill the tile.
          fontSize: Math.round(size * (maskable ? 0.42 : 0.58)),
          fontWeight: 700,
          fontFamily: "serif",
          borderRadius: maskable ? 0 : Math.round(size * 0.18),
        }}
      >
        {!maskable && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: Math.round(size * 0.08),
              background: accent,
            }}
          />
        )}
        {initial}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        // The artwork is keyed on the host, so a shared cache must not serve one
        // firm's mark on another firm's domain.
        "cache-control": "public, max-age=3600",
        vary: "host, x-forwarded-host",
      },
    },
  );
}
