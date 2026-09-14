// The colour arithmetic the two design gates share.
//
// `design/home/verify.mjs` judges one static artboard; `tests/fixtures/design.mjs` judges the
// running app. Both have to mean the same thing by "4.5:1", and while each carried its own copy
// of these six functions they could quietly drift: a correction made to one left the other
// judging a slightly different rule, and the only symptom would have been a page that passed the
// landing gate and failed the app gate for no reason a reader could see. So the arithmetic lives
// here once and both import it.
//
// Everything here is pure and runs in Node, except `bgOf`, which needs a DOM.
//
// The checks themselves have to run INSIDE the page — only the browser knows a computed style —
// so `browserInstallScript()` serialises these same function objects into a script that hangs
// them off `globalThis.__docketColour` before the document loads. That is the point of doing it
// this way rather than pasting the functions into each `page.evaluate`: the browser side and the
// Node side are the same source text, not two copies that happen to agree today.
//
// Nothing here is evaluated with eval() or new Function(): the install script is injected through
// the DevTools protocol, which is not a script element, so a page's Content-Security-Policy
// neither blocks it nor has to be relaxed for it. The app serves a strict CSP with a per-request
// nonce (middleware.ts), and a fixture that needed 'unsafe-eval' would be testing a policy the
// real site does not run under.

/**
 * "rgb(32, 30, 29)", "rgba(32, 30, 29, 0.7)" or "rgb(32 30 29 / 0.7)" → {r, g, b, a}.
 * Anything else — `transparent` keywords aside, which serialise as rgba(0, 0, 0, 0) — is null.
 *
 * Both separator styles are read. Chromium serialises an sRGB colour with commas, so the comma
 * form is what a computed style almost always gives back; but a colour that reaches the page
 * through a `rgb(var(--t-ink) / 0.7)` utility can come back in the space-and-slash form, and
 * splitting on commas alone turns that into NaN. A NaN then compares false against every
 * threshold, so the element passes silently instead of failing loudly — the worst outcome a
 * linter can have. The finite check below is the same guard from the other side.
 */
export const parse = (c) => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (!p.slice(0, 3).every((v) => Number.isFinite(v))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};

/** WCAG 2.2 relative luminance. */
export const lum = ({ r, g, b }) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** WCAG 2.2 contrast ratio between two opaque colours, 1–21. */
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** A translucent foreground flattened onto the ground behind it, so it can be measured. */
export const over = (fg, bg) =>
  fg.a >= 1
    ? fg
    : { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };

/** For the report. A ratio nobody can map back to a colour is not actionable. */
export const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/**
 * The ratio this text has to clear. WCAG 2.2 SC 1.4.3 lets large text sit at 3:1, where large
 * means 24px, or 18.66px when it is bold. Both gates ask this one function so that neither can
 * be more generous than the other about what counts as large.
 */
export const needed = (size, weight) => (size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5);

/**
 * The ground an element is actually painted on: the nearest ancestor with an opaque background.
 * DOM only.
 *
 * The walk stops at <html> and falls back to white, which is a real limitation and not a safe
 * default on a dark theme — but it is unreachable in both callers, because the artboard paints
 * its own wrapper and the app paints `body` (`background-color: rgb(var(--t-paper))` in
 * app/globals.css). If a future surface leaves the ground to <html>, this is the line to fix,
 * and it will announce itself as a page-wide contrast failure rather than as silence.
 */
export const bgOf = (el) => {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.999) return c;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
};

/** Where the functions above land in the page. */
export const BROWSER_GLOBAL = '__docketColour';

const SHARED = { parse, lum, ratio, over, hex, needed, bgOf };

/**
 * The source text of an init script that rebuilds the functions above inside a page.
 *
 * Pass it to `page.addInitScript({ content })` BEFORE the first navigation, then read them back
 * inside `page.evaluate` with `const { ratio, over, bgOf } = globalThis.__docketColour`. It adds
 * no element to the document: a `<script>` tag appended to the page would itself be walked by
 * the `document.querySelectorAll('*')` sweeps these gates run, which is a linter changing the
 * thing it is measuring.
 */
export function browserInstallScript() {
  const body = Object.entries(SHARED)
    .map(([name, fn]) => `  const ${name} = ${fn};`)
    .join('\n');
  return `globalThis.${BROWSER_GLOBAL} = (function () {\n${body}\n  return { ${Object.keys(SHARED).join(', ')} };\n})();`;
}
