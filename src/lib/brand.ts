// Design tokens: firms.brand → CSS variables. The Tailwind theme maps
// semantic colors (brand, brand-accent, brand-surface) onto these variables,
// so every tenant surface is branded with zero tenant-specific code.

import type { CSSProperties } from "react";
import type { FirmBrand } from "@/lib/db/types";

export const DEFAULT_TOKENS = {
  primary: "#1c2b3a",
  accent: "#8a6d3b",
  surface: "#f6f5f2",
  headingFont: "Georgia",
  bodyFont: "system-ui",
};

export function brandStyle(brand: FirmBrand | null | undefined): CSSProperties {
  const colours = brand?.colours ?? {};
  const fonts = brand?.fonts ?? {};
  return {
    "--dk-primary": colours.primary ?? DEFAULT_TOKENS.primary,
    "--dk-accent": colours.accent ?? DEFAULT_TOKENS.accent,
    "--dk-surface": colours.surface ?? DEFAULT_TOKENS.surface,
    "--dk-font-heading": fonts.heading ?? DEFAULT_TOKENS.headingFont,
    "--dk-font-body": fonts.body ?? DEFAULT_TOKENS.bodyFont,
  } as CSSProperties;
}

/** Google Fonts stylesheet URL for the tenant's typefaces, if any. */
export function brandFontsUrl(brand: FirmBrand | null | undefined): string | null {
  const families = [brand?.fonts?.heading, brand?.fonts?.body]
    .filter((f): f is string => Boolean(f))
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`);
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
