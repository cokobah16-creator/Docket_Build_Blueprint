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

/** The two colours a foreground is chosen from: a theme's text colour and its ground. */
interface ForegroundPair {
  ink: string;
  paper: string;
}

/**
 * The readable foreground for a background: whichever of ink or paper has the
 * higher contrast ratio against it. A firm that picks yellow gets ink; a firm
 * that picks navy gets paper. Malformed input falls back to paper, which is
 * what every one of these surfaces used before.
 *
 * The candidate pair is a parameter because the dark theme draws on a different
 * one. DARK_TOKENS holds a near-white ink and the dark page as its paper, so the
 * foreground on a lifted brand colour is the warm near-black the rest of the dark
 * theme uses rather than the light theme's cooler, bluer #111827.
 */
export function readableForeground(
  background: string | null | undefined,
  candidates: ForegroundPair = DEFAULT_TOKENS,
): string {
  const bg = relativeLuminance(background ?? "");
  if (bg === null) return candidates.paper;
  const ink = relativeLuminance(candidates.ink) ?? 0;
  const paper = relativeLuminance(candidates.paper) ?? 1;
  return ratio(bg, ink) > ratio(bg, paper) ? candidates.ink : candidates.paper;
}

// ------------------------------------------------------------- lifting a tenant colour into dark

/**
 * HSL, because the whole point of the lift is to move ONE of the three numbers
 * and leave the other two exactly where the firm put them. Blending a colour
 * towards the dark theme's off-white clears the same contrast target, but it
 * drags saturation down with it — navy #0F2A44 comes out #748391, a grey — and a
 * firm that chose navy has then had its colour taken away rather than adapted.
 */
function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  // A grey has no hue to hold, and the saturation divisor below is 0 for it.
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** 0–1 back to a byte. Clamped as well as rounded: floating point lands a hair outside. */
function toByte(value: number): number {
  const byte = Math.round(value * 255);
  if (byte < 0) return 0;
  return byte > 255 ? 255 : byte;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((sector % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (sector < 1) {
    r = c;
    g = x;
  } else if (sector < 2) {
    r = x;
    g = c;
  } else if (sector < 3) {
    g = c;
    b = x;
  } else if (sector < 4) {
    g = x;
    b = c;
  } else if (sector < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [toByte(r + m), toByte(g + m), toByte(b + m)];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The theme's own dark page ground, --d-paper in app/globals.css. Every lift is
 * measured against it because that is what a tenant colour sits on in dark.
 */
const DARK_GROUND = "#1a1918";

/** The theme's --d-ink: near-white, and what a colour we cannot read falls back to. */
const DARK_INK = "#f2f0ec";

/**
 * 4.6, one tenth above the 4.5 a lifted colour actually has to clear. The search
 * stops at the first lightness whose ROUNDED hex clears the target, and aiming at
 * 4.5 exactly left one colour measuring 4.49 — inside the rounding, outside the
 * standard. The tenth of headroom costs a step or two of lightness and nothing else.
 */
const DARK_TARGET = 4.6;

/**
 * A tenant colour moved far enough up in lightness to be legible on a dark
 * ground, with its hue and saturation held exactly where the firm put them.
 *
 * A firm that picked navy #0F2A44 renders at 1.20:1 on rgb(26 25 24): text-brand
 * is invisible and bg-brand is a hole in the page. Lifting only the L of its HSL
 * lands it on #3686d3 at 4.60:1, still hue 209 at 64% saturation — a shade of the
 * firm's own navy, not a colour the firm never chose.
 *
 * The search is a binary chop on lightness that judges each candidate by the
 * contrast of its ROUNDED hex, so what comes back is what the browser will paint
 * rather than a continuous value that rounds back under the target. A colour that
 * already clears `need` is returned exactly as it came in, so a firm's gold or
 * yellow is never touched at all. Malformed input falls back to the dark theme's
 * own ink, the same way readableForeground() falls back to paper.
 */
export function liftForDark(
  colour: string,
  ground: string = DARK_GROUND,
  need: number = DARK_TARGET,
): string {
  const rgb = parseHex(colour);
  const here = contrastRatio(colour, ground);
  if (!rgb || here === null) return DARK_INK;
  if (here >= need) return colour;

  const [h, s, l] = rgbToHsl(rgb);
  // Lightness 1 is white whatever the hue and saturation, so it is both the
  // ceiling of the search and the answer if a caller ever passes a ground that
  // nothing on this hue can clear.
  let lo = l;
  let hi = 1;
  let best = toHex(hslToRgb(h, s, hi));
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = toHex(hslToRgb(h, s, mid));
    if ((contrastRatio(candidate, ground) ?? 0) >= need) {
      hi = mid;
      best = candidate;
    } else {
      lo = mid;
    }
  }
  return best;
}

/**
 * The dark counterparts of DEFAULT_TOKENS. The two colours are lifted here rather
 * than written down, so a change to a default lands in both themes at once.
 */
export const DARK_TOKENS = {
  primary: liftForDark(DEFAULT_TOKENS.primary),
  accent: liftForDark(DEFAULT_TOKENS.accent),
  /**
   * A page ground cannot be lifted. --dk-surface is a pale cream a firm chose to
   * set text on, and no lightness of it is a dark page, so the theme's own dark
   * ground stands in: a branded page in dark is the same ground as every other
   * Docket page in dark.
   */
  surface: DARK_GROUND,
  /**
   * --d-raised, the ground a card makes on that page, and the worse case for a
   * lifted colour: one lifted to 4.60:1 on the page measures about 4.2:1 on a
   * card. Nothing here targets it yet — a caller that needs AA on cards passes
   * this to liftForDark() as the ground instead.
   */
  raised: "#24221f",
  headingFont: DEFAULT_TOKENS.headingFont,
  bodyFont: DEFAULT_TOKENS.bodyFont,
  /**
   * The two candidates drawn on top of a brand colour in dark. Named for their
   * ROLE like everything in app/globals.css, so `ink` is the text colour and
   * `paper` is the page: the same two roles as the light pair above, with their
   * lightnesses the other way round.
   */
  ink: DARK_INK,
  paper: DARK_GROUND,
};

/**
 * Has the firm opted its own public site into the dark theme? Absent means no,
 * which is the answer for every firm that has never been asked.
 */
export function tenantAllowsDark(brand: FirmBrand | null | undefined): boolean {
  return brand?.colours?.dark_mode === true;
}

export interface BrandStyleOptions {
  /**
   * May this surface show the firm's colours re-toned for dark? Docket's own
   * surfaces — the client portal, the staff console — always may, which is why
   * this defaults to true. The firm's public site passes tenantAllowsDark(brand).
   */
  allowDark?: boolean;
}

// brandStyle() runs on every portal and every public render, and a lift is twenty
// rounds of pow() per colour, so the finished variables are kept. The cap is there
// because a long-lived server that has served a thousand firms should not be
// holding a thousand of these; the entry inserted longest ago is the one dropped.
const STYLE_CACHE = new Map<string, CSSProperties>();
const STYLE_CACHE_LIMIT = 500;

/**
 * The firm's colours as CSS variables, in BOTH themes at once.
 *
 * Every colour is emitted twice, as --dk-*-l and --dk-*-d, and the static rules at
 * the end of app/globals.css pick a set. That indirection is forced on us: these
 * values arrive as a style ATTRIBUTE, an attribute holds one value per variable
 * and outranks every selector in the stylesheet, so a single --dk-primary set here
 * could never be re-pointed by a media query — and choosing the set in JavaScript
 * instead would paint the light colours first and correct them after hydration.
 * THE ELEMENT CARRYING THIS STYLE MUST ALSO CARRY data-brand, or none of those
 * rules match and the page falls back to the :root defaults.
 *
 * `allowDark` is a product decision rather than a rendering one. In dark a firm's
 * colour is re-toned by liftForDark() — navy comes back a lighter navy — and on
 * the firm's OWN public site that is a change to a page the firm considers theirs;
 * the first support ticket is "our green is wrong". So the public site passes
 * tenantAllowsDark(brand) and a firm gets dark there only by turning on
 * colours.dark_mode, while Docket's own surfaces always allow it. A surface that
 * may not go dark gets the light values under both names, so the rules in
 * globals.css resolve to the same colour whichever theme the visitor is in.
 */
export function brandStyle(
  brand: FirmBrand | null | undefined,
  options?: BrandStyleOptions,
): CSSProperties {
  const colours = brand?.colours ?? {};
  const fonts = brand?.fonts ?? {};
  const primary = colours.primary ?? DEFAULT_TOKENS.primary;
  const accent = colours.accent ?? DEFAULT_TOKENS.accent;
  const surface = colours.surface ?? DEFAULT_TOKENS.surface;
  const heading = fonts.heading ?? DEFAULT_TOKENS.headingFont;
  const body = fonts.body ?? DEFAULT_TOKENS.bodyFont;
  const allowDark = options?.allowDark ?? true;

  const key = `${primary}|${accent}|${surface}|${heading}|${body}|${allowDark}`;
  const cached = STYLE_CACHE.get(key);
  if (cached) return cached;

  const darkPrimary = allowDark ? liftForDark(primary) : primary;
  const darkAccent = allowDark ? liftForDark(accent) : accent;
  const darkSurface = allowDark ? DARK_TOKENS.surface : surface;
  const darkPair = allowDark ? DARK_TOKENS : DEFAULT_TOKENS;

  const style = {
    "--dk-primary-l": primary,
    "--dk-primary-d": darkPrimary,
    "--dk-accent-l": accent,
    "--dk-accent-d": darkAccent,
    "--dk-surface-l": surface,
    "--dk-surface-d": darkSurface,
    // One lifted colour serves the fill and the text both: the foreground chosen
    // against the lifted value clears 4.5:1 on it, so bg-brand and text-brand can
    // go on sharing --dk-primary and nothing that uses them has to be renamed.
    "--dk-on-primary-l": readableForeground(primary),
    "--dk-on-primary-d": readableForeground(darkPrimary, darkPair),
    "--dk-on-accent-l": readableForeground(accent),
    "--dk-on-accent-d": readableForeground(darkAccent, darkPair),
    // Typefaces are the firm's in either theme, so they are emitted once.
    "--dk-font-heading": heading,
    "--dk-font-body": body,
  } as CSSProperties;

  if (STYLE_CACHE.size >= STYLE_CACHE_LIMIT) {
    const oldest = STYLE_CACHE.keys().next().value;
    if (oldest !== undefined) STYLE_CACHE.delete(oldest);
  }
  STYLE_CACHE.set(key, style);
  return style;
}

/** Google Fonts stylesheet URL for the tenant's typefaces, if any. */
export function brandFontsUrl(brand: FirmBrand | null | undefined): string | null {
  const families = [brand?.fonts?.heading, brand?.fonts?.body]
    .filter((f): f is string => Boolean(f))
    .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`);
  if (families.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}
