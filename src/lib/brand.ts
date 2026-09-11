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

/** Scale every channel of a colour by `factor`, clamped to a byte. */
function scale(colour: string, factor: number): string | null {
  const rgb = parseHex(colour);
  if (!rgb) return null;
  const byte = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}`;
}

/**
 * The accent, darkened until it reads as text on a white card.
 *
 * A firm's accent is chosen to be drawn *as* a colour — a rule, a fill, a
 * border. Set as type on paper it is usually too light: Attorneys Klinique's
 * #B08D57 is 3.1:1 on white, well under the 4.5:1 body-text floor. So the
 * accent is walked down in luminance until it clears 6:1, which is where the
 * hand-picked inks in the PWA artboard sit (#7A5F33 is 5.98:1, #5A6152 is
 * 6.43:1). Used for accent-coloured type only; the accent itself is unchanged
 * wherever it is a fill or a border.
 */
export function accentInk(accent: string | null | undefined): string {
  const base = accent ?? DEFAULT_TOKENS.accent;
  if (parseHex(base) === null) return DEFAULT_TOKENS.ink;
  for (let factor = 100; factor > 0; factor -= 1) {
    const candidate = scale(base, factor / 100);
    if (!candidate) break;
    const contrast = contrastRatio(candidate, DEFAULT_TOKENS.paper);
    if (contrast !== null && contrast >= 6) return candidate;
  }
  return DEFAULT_TOKENS.ink;
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
    "--dk-accent-ink": accentInk(accent),
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
