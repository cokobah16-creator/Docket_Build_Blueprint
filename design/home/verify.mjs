// Checks the Docket home artboard against the rules in README.md.
//
//   node design/home/verify.mjs
//
// Renders Main.dc.html at 1440px in headless Chromium and fails on: text under
// the WCAG AA ratio, a control boundary under 3:1, a display heading ending in
// a one-word line, a font size outside the ramp, gold text anywhere but on
// green, or content clipped by a fixed-height box.
//
// Load the real typefaces before trusting the result. Archivo and Fraunces are
// metrically nothing like the Liberation/DejaVu fallbacks, and a fallback run
// silently reports a page that fits when the published one does not:
//
//   git clone --filter=blob:none --no-checkout --depth 1 \
//     https://github.com/google/fonts.git /tmp/gfonts
//   cd /tmp/gfonts && git sparse-checkout init --cone \
//     && git sparse-checkout set ofl/archivo ofl/fraunces && git checkout main
//   export ARCHIVO_TTF='/tmp/gfonts/ofl/archivo/Archivo[wdth,wght].ttf'
//   export FRAUNCES_TTF='/tmp/gfonts/ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf'
//
// Set PLAYWRIGHT_CHROMIUM to override the browser binary.
//
// The colour arithmetic is not here: it is in tests/fixtures/contrast.mjs, which
// tests/fixtures/design.mjs — the same rules applied to the running app — imports
// too. Two copies of "what 4.5:1 means" is how the two gates would come to
// disagree, so there is one copy and both read it.

// @playwright/test is the declared devDependency; plain playwright is its
// runtime and is what a global install provides.
const { chromium } = await import('@playwright/test').catch(() => import('playwright'));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_GLOBAL, browserInstallScript } from '../../tests/fixtures/contrast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAMP = [11, 13, 15, 21, 26, 44, 56, 88];
const GOLD = ['#ffb81c', '#ffcb71'];
const GREEN = ['#2c4a34', '#203024'];

const archivo = process.env.ARCHIVO_TTF;
const fraunces = process.env.FRAUNCES_TTF;
const haveFonts = [archivo, fraunces].every((f) => f && fs.existsSync(f));
if (!haveFonts) {
  console.warn(
    'WARNING: ARCHIVO_TTF / FRAUNCES_TTF are not set to readable files.\n' +
      '         Falling back to system fonts. Wrapping and heights will be wrong.\n' +
      '         See the header of this file for how to fetch the real typefaces.\n',
  );
}

const faces = haveFonts
  ? `<style>
@font-face { font-family: "Archivo"; src: url("file://${archivo}") format("truetype-variations");
             font-weight: 100 900; font-stretch: 62% 125%; font-display: block; }
@font-face { font-family: "Fraunces"; src: url("file://${fraunces}") format("truetype-variations");
             font-weight: 100 900; font-display: block; }
</style>`
  : '';

// The .dc.html wrapper only means something inside the design canvas; strip it
// and the webfont link (blocked offline) so the artboard renders as a page.
const source = fs
  .readFileSync(path.join(HERE, 'Main.dc.html'), 'utf8')
  .replace(/<script src="\.\/support\.js"><\/script>/g, '')
  .replace(/<\/?x-dc>/g, '')
  .replace(/<\/?helmet>/g, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '')
  .replace('</head>', faces + '\n</head>');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docket-home-'));
const page_html = path.join(tmp, 'standalone.html');
fs.writeFileSync(page_html, source);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
// The shared colour maths, before the first navigation so it is there when the
// checks below run. It adds nothing to the document — see contrast.mjs.
await page.addInitScript({ content: browserInstallScript() });
await page.goto('file://' + page_html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const report = await page.evaluate(
  ({ RAMP, GOLD, GREEN, G }) => {
    const { parse, ratio, over, hex, needed, bgOf } = globalThis[G];
    // The two branded firm frames render other firms' product UI in their own
    // brands. They are a deliberate exception to the type ramp, not to contrast.
    const inFrame = (el) => !!el.closest('[style*="width:384px"]');
    const owns = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

    const fail = { contrast: [], boundary: [], ramp: [], gold: [], orphan: [], clipped: [] };

    for (const el of document.querySelectorAll('body *')) {
      if (!owns(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const bg = bgOf(el);
      const fg0 = parse(cs.color);
      if (!fg0) continue;
      const fg = over(fg0, bg);
      const size = parseFloat(cs.fontSize);
      const need = needed(size, parseInt(cs.fontWeight, 10) || 400);
      const r = ratio(fg, bg);
      const text = el.textContent.trim().slice(0, 40);
      if (r < need) fail.contrast.push(`${r.toFixed(2)}:1 needs ${need} — ${hex(fg)} on ${hex(bg)} — "${text}"`);
      if (GOLD.includes(hex(fg).toLowerCase()) && !GREEN.includes(hex(bg).toLowerCase()))
        fail.gold.push(`${hex(fg)} on ${hex(bg)} — "${text}"`);
      const rounded = Math.round(size * 10) / 10;
      if (!inFrame(el) && !RAMP.includes(rounded)) fail.ramp.push(`${rounded}px — "${text}"`);
    }

    for (const el of document.querySelectorAll('input, textarea, select, #walkthrough span, #booking span')) {
      const cs = getComputedStyle(el);
      const bg = bgOf(el.parentElement);
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const edge = bw > 0 ? parse(cs.borderTopColor) : parse(cs.backgroundColor);
      if (!edge || edge.a <= 0.02) continue;
      const r = ratio(over(edge, bg), bg);
      if (r < 3) fail.boundary.push(`${r.toFixed(2)}:1 needs 3 — ${el.tagName.toLowerCase()} "${(el.textContent || el.placeholder || '').trim().slice(0, 30)}"`);
    }

    // A display heading whose last line is one short word reads as a mistake.
    for (const el of document.querySelectorAll('h1, h2')) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 26 || inFrame(el)) continue;
      const original = el.innerHTML;
      el.innerHTML = original
        .split(/<br\s*\/?>/i)
        .map((seg) => seg.trim().split(/\s+/).map((w) => `<span>${w}</span>`).join(' '))
        .join('<br>');
      const lines = [];
      for (const s of el.querySelectorAll('span')) {
        const b = s.getBoundingClientRect();
        const hit = lines.find((l) => Math.abs(l.top - b.top) < size * 0.4);
        if (hit) { hit.words.push(s.textContent); hit.left = Math.min(hit.left, b.left); hit.right = Math.max(hit.right, b.right); }
        else lines.push({ top: b.top, left: b.left, right: b.right, words: [s.textContent] });
      }
      lines.sort((a, b) => a.top - b.top);
      el.innerHTML = original;
      if (lines.length < 2) continue;
      const w = lines.map((l) => l.right - l.left);
      const last = lines[lines.length - 1];
      if (last.words.length === 1 && w[w.length - 1] / Math.max(...w) < 0.7)
        fail.orphan.push(`${size}px ends on "${last.words[0]}" — ${el.textContent.trim().slice(0, 48)}`);
    }

    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const hiddenX = cs.overflowX === 'hidden' || cs.overflow === 'hidden';
      const hiddenY = cs.overflowY === 'hidden' || cs.overflow === 'hidden';
      if ((hiddenX && el.scrollWidth > el.clientWidth + 1 && el.clientWidth) ||
          (hiddenY && el.scrollHeight > el.clientHeight + 1 && el.clientHeight))
        fail.clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`);
    }

    return { fail, height: document.documentElement.scrollHeight, wide: document.body.scrollWidth > 1440 };
  },
  { RAMP, GOLD, GREEN, G: BROWSER_GLOBAL },
);

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

const LABELS = {
  contrast: 'text under the WCAG AA ratio',
  boundary: 'control boundaries under 3:1',
  ramp: 'font sizes outside the ramp',
  gold: 'gold used as text off green',
  orphan: 'display headings ending in one word',
  clipped: 'content clipped by a fixed-height box',
};

let failed = 0;
for (const [key, label] of Object.entries(LABELS)) {
  const rows = report.fail[key];
  if (!rows.length) { console.log(`ok    ${label}`); continue; }
  failed += rows.length;
  console.log(`FAIL  ${label} (${rows.length})`);
  for (const r of rows) console.log(`        ${r}`);
}
if (report.wide) { failed++; console.log('FAIL  the page scrolls horizontally at 1440px'); }

console.log(`\npage height ${report.height}px — keep canvas.json "h" above this with a little slack`);
if (!haveFonts) console.log('checked with fallback fonts; wrapping results are not trustworthy');
process.exit(failed ? 1 : 0);
