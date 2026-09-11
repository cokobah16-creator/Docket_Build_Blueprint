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
  /** The two candidates drawn on top of a brand colour. */
  ink: "#111827",
  paper: "#ffffff",
};

/** #abc or #aabbcc → [r, g, b]. Anything else → null. */
function parseHex(colour: string): [number, number, number] | null {
  const value = colour.trim().replace(/^#/, "");
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance. Returns null for a colour we cannot read. */
export function relativeLuminance(colour: string): number | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function ratio(a: number, b: number): number {
  return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);
}

/** WCAG 2.1 contrast ratio, 1–21. Returns null if either colour is unreadable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  return ratio(la, lb);
}

const INK_LUMINANCE = relativeLuminance(DEFAULT_TOKENS.ink) ?? 0;
const PAPER_LUMINANCE = relativeLuminance(DEFAULT_TOKENS.paper) ?? 1;

/**
 * The readable foreground for a background: whichever of ink or paper has the
 * higher contrast ratio against it. A firm that picks yellow gets ink; a firm
 * that picks navy gets paper. Malformed input falls back to paper, which is
 * what every one of these surfaces used before.
 */
export function readableForeground(background: string | null | undefined): string {
  const bg = relativeLuminance(background ?? "");
  if (bg === null) return DEFAULT_TOKENS.paper;
  return ratio(bg, INK_LUMINANCE) > ratio(bg, PAPER_LUMINANCE)
    ? DEFAULT_TOKENS.ink
    : DEFAULT_TOKENS.paper;
}

export function brandStyle(brand: FirmBrand | null | undefined): CSSProperties {
  const colours = brand?.colours ?? {};
  const fonts = brand?.fonts ?? {};
  const primary = colours.primary ?? DEFAULT_TOKENS.primary;
  const accent = colours.accent ?? DEFAULT_TOKENS.accent;
  return {
    "--dk-primary": primary,
    "--dk-accent": accent,
    "--dk-surface": colours.surface ?? DEFAULT_TOKENS.surface,
    "--dk-on-primary": readableForeground(primary),
    "--dk-on-accent": readableForeground(accent),
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
