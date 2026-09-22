// DESIGN FIXTURE — the landing page's design linter, pointed at the whole application.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
//
// design/home/verify.mjs judges ONE static artboard against the rules in design/home/README.md,
// and it has been green since it was written. The application has never been judged by anything.
// That is how `text-gray-500` reached 459 uses at 4.43:1 and `border-gray-300` reached 150 at
// 1.35:1: nothing was watching. This file watches.
//
// It runs the real screens in a real browser against tests/fixtures/supabase-mock.mjs, the same
// stand-in Supabase shots.mjs uses, and it inherits that file's limits wholesale: the stand-in
// implements NO row-level security and checks NO session. A green run here says NOTHING about who
// may see a matter, a message or an invoice. See tests/fixtures/README.md before citing one.
//
// WHAT IS MACHINE-CHECKABLE HERE
//
//   a. text contrast below WCAG 2.2 AA, measured against the ground actually painted behind it
//   b. a control boundary below 3:1 (SC 1.4.11)
//   c. a font size off the ramp — inputs excepted, and instead held at 16px or more
//   d. a colour that came from outside the token set (the anti-decay check)
//   e. a corner radius off the scale
//   f. a tenant's brand colour reaching a Docket-owned surface
//   g. a status colour carrying meaning without both a word and a mark
//
// all of it twice, once with data-theme="light" on the root and once with data-theme="dark", which
// is what makes the dark theme an enforced fact rather than an aspiration.
//
// WHAT IS NOT MACHINE-CHECKABLE, AND IS NOT CHECKED HERE
//
// design/home/README.md lists six mitigations for the Nigerian brand risk — dark green with gold
// sits close to the flag and the passport. Three of them are arithmetic and this file or
// verify.mjs can hold them: the green's chroma stays below flag green, the ground is warm rather
// than white, gold is never text off green. Three are judgement and NOTHING here touches them:
//
//   - "no green-and-gold crest or card object" — a program cannot recognise a crest
//   - "the layout is asymmetric" — nor can it tell deliberate asymmetry from a mistake
//   - "no symmetric green-white-green thirds" — partly measurable, but only a person can say
//     whether a given arrangement reads as the flag
//
// A green run from this file is NOT a statement that the brand-risk posture is intact. It is a
// statement about contrast, ramp, tokens, radii, the tenant firewall and status affordances. The
// remaining three mitigations are reviewed by a person, or they are not reviewed at all.
//
// Beyond those, and stated plainly so a green run is not over-read:
//   - it reads computed styles, so a colour inside a background-image gradient, an SVG `fill`,
//     an ::after pseudo-element or a raster asset is invisible to it
//   - white passes the token check because it IS a token value (--t-on-danger, --dk-on-primary),
//     so a stray `bg-white` is not caught here
//   - a status conveyed by a coloured BACKGROUND alone is not caught by (g), which reads `color`
//   - (g) leaves out the quiet tone, because --t-quiet-ink is byte-identical to --t-ink-muted in
//     both themes and no check reading `color` can tell a "cancelled" pill from muted prose
//   - (f) matches the firm's SEED colours, the three in firms.brand. brandStyle() derives a lifted
//     pair for the dark theme (src/lib/brand.ts), and those derived values are not in the set:
//     reproducing liftForDark() here would be the second copy of a rule this file exists to stop
//     drifting, so what (f) catches is a seed colour reaching a Docket surface, not a lift of one
//   - it judges the mock's data. A screen whose empty state is never rendered is never checked
//
// TO RUN IT
//   node tests/fixtures/supabase-mock.mjs --port 54321 --role staff &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//     NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> npm run dev &
//   MOCK_TOKEN=<key> npm run test:design
//
// Options, the same three shots.mjs takes plus four of its own:
//   --out <dir>          where the full report lands (default /tmp/design)
//   --base <url>         default http://localhost:3000
//   --only <substring>   run the routes whose name contains it
//   --viewports <names>  comma-separated, from the WIDTHS table below, or "all" (default 390,1440)
//   --themes <names>     comma-separated light|dark (default light,dark)
//   --inventory <file>   record every text-bearing element instead of gating — see below
//   --diff <a> <b>       print the rows that changed between two inventories, and exit
//
// THE INVENTORY IS A SEMANTIC SCREENSHOT DIFF
//
// The consolidation of ~60 screens ahead of this will change a great many elements on purpose.
// Image diffing is the usual net for that and it is the wrong one: it is flaky across font
// rendering and it reports a wall of pixels rather than a cause. `--inventory` writes one JSON row
// per text-bearing element per route x viewport x theme — a stable selector path plus the style
// that matters — and `--diff before.json after.json` prints only what moved, with the selector
// path attached. The expected changes are then enumerable and everything else is a regression
// that names itself.
//
// It EXITS NONZERO when it finds problems, like its four siblings, so CI and a person rerunning
// it cannot read a failure as a pass. `--inventory` and `--diff` are recording modes and exit 0:
// they are how you capture a baseline, not how you gate.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_GLOBAL, browserInstallScript } from "./contrast.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = arg("out", "/tmp/design");
const BASE = arg("base", "http://localhost:3000");
const ONLY = arg("only", "");
const INVENTORY = arg("inventory", "");
// `--inventory` with no path would otherwise fall through to gating mode and record nothing,
// which is the one failure a recording run must not have: you discover the baseline is missing
// after the change it was meant to be compared against has already landed.
if (args.includes("--inventory") && !INVENTORY) {
  throw new Error("--inventory needs a file to write: --inventory /tmp/before.json (via npm: `npm run test:design:inventory -- /tmp/before.json`)");
}

// ── the scales, which are the rules ───────────────────────────────────────
//
// The ramp is tailwind.config.ts's fontSize keys. The landing's own eight-step ramp in
// design/home/verify.mjs is a strict subset of it; the app adds 17 (card and section titles)
// and 32. The radii are the borderRadius keys: chip, control, card, sheet. `rounded-full`
// resolves to 9999px and is allowed as "full"; a percentage is not, because the scale has no
// percentage in it and an arbitrary one is exactly the decay this file exists to stop.
const RAMP = [11, 13, 15, 17, 21, 26, 32, 44, 56, 88];
const RADII = [4, 6, 8, 12];

// A real input under 16px makes iOS Safari zoom the whole page on focus. Every field is
// therefore pinned at 16px, which is off the ramp by platform constraint rather than by
// carelessness — so fields are exempt from (c) and held to this instead.
const FIELD_MIN_PX = 16;

const WIDTHS = [
  { name: "360", width: 360, height: 780 },
  { name: "390", width: 390, height: 844 },
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

// Two widths by default rather than shots.mjs's six. What this file measures — a colour, a size,
// a radius — changes with width only where a responsive utility changes it, and phone vs desktop
// is where that split lives. The other four are a `--viewports` flag away, and `--viewports all`
// runs the same table shots.mjs does.
const VIEWPORTS = (() => {
  const want = arg("viewports", "390,1440");
  if (want === "all") return WIDTHS;
  const names = want.split(",").map((s) => s.trim()).filter(Boolean);
  const picked = names.map((n) => {
    const vp = WIDTHS.find((w) => w.name === n);
    if (!vp) throw new Error(`unknown viewport ${JSON.stringify(n)} — pick from ${WIDTHS.map((w) => w.name).join(", ")} or "all"`);
    return vp;
  });
  if (!picked.length) throw new Error("--viewports was given nothing to run");
  return picked;
})();

const THEMES = arg("themes", "light,dark").split(",").map((s) => s.trim()).filter(Boolean);
for (const t of THEMES) if (t !== "light" && t !== "dark") throw new Error(`unknown theme ${JSON.stringify(t)} — light or dark`);

// ── --diff, before anything else ──────────────────────────────────────────
//
// A diff reads two files and needs no browser, no dev server and no token, so it runs before the
// MOCK_TOKEN check below. Rows are matched on route|viewport|theme|selector-path. A path that
// appeared or disappeared is reported as such rather than as a change, because a wall of
// "changed" rows caused by one inserted sibling shifting every nth-of-type after it is worse than
// no report at all — see the caveat in tests/fixtures/README.md.
const diffAt = args.indexOf("--diff");
if (diffAt >= 0) {
  const [a, b] = [args[diffAt + 1], args[diffAt + 2]];
  if (!a || !b) throw new Error("--diff takes two inventory files: --diff before.json after.json");
  process.exit(await runDiff(a, b));
}

const TOKEN = process.env.MOCK_TOKEN;
if (!TOKEN) throw new Error("set MOCK_TOKEN to the access token the mock printed");

// ── what the mock serves, read from the mock ──────────────────────────────
//
// The firm slug, the row ids and the tenant's seed colours are read out of supabase-mock.mjs
// rather than copied here, so a change to the fixture data cannot leave this file quietly
// checking a 404 page or firewalling against a colour nobody uses any more. Both readers throw
// when they find nothing: a linter that silently checks less than it claims is worse than one
// that fails to start.
const mockSource = await readFile(path.join(HERE, "supabase-mock.mjs"), "utf8");

const FIRM_SLUG = (mockSource.match(/slug:\s*"([a-z0-9-]+)"/) ?? [])[1];
if (!FIRM_SLUG) throw new Error("could not read the firm slug out of supabase-mock.mjs");

// The tenant's own colours. Check (f) asserts that not one of them reaches a Docket-owned
// surface — the platform landing, the staff console, the registry console, the platform admin.
// A firm that could repaint those pages would be wearing the platform's authority, and that
// firewall has never had a test on it until now.
const TENANT_SEED = (mockSource.match(/colours:\s*\{([^}]*)\}/) ?? [])[1]?.match(/#[0-9a-fA-F]{6}/g) ?? [];
if (TENANT_SEED.length < 3) throw new Error("could not read the tenant's brand colours out of supabase-mock.mjs");

// Docket's own literal palette. It is hex in tailwind.config.ts rather than a CSS variable on
// purpose — a firm must not be able to reach it — so it cannot be read off the page the way the
// --t-* and --dk-* tokens can, and is lifted from the config here instead of being copied.
const configSource = await readFile(path.join(ROOT, "tailwind.config.ts"), "utf8");
const DOCKET_PALETTE = [...((configSource.match(/docket:\s*\{([\s\S]*?)\n\s{8}\}/) ?? [])[1] ?? "").matchAll(/"(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1]);
if (DOCKET_PALETTE.length < 8) throw new Error("could not read the docket-* palette out of tailwind.config.ts");

const MATTER = "44444444-4444-4444-8444-444444444444";
const APPT = "55555555-5555-4555-8555-555555555555";
const INVOICE = "66666666-6666-4666-8666-666666666666";
const CLIENT = "11111111-1111-4111-8111-111111111111";

// ── the routes ────────────────────────────────────────────────────────────
//
// All five surfaces, not shots.mjs's ten screens. `docket` marks a surface Docket owns and a
// tenant's brand must never reach; `auth` says whether the session cookie is presented, which is
// how the public firm site and both sign-in flows get checked as a stranger actually meets them.
const R = (name, url, docket, auth = true) => ({ name, url, docket, auth });
const ROUTES = [
  // The platform landing. Docket's own, and seen by strangers.
  R("landing", "/", true, false),

  // The tenant's public site. Branded on purpose — this is the one surface where a firm's
  // colours belong — and reached with no session at all.
  R("site-home", `/${FIRM_SLUG}`, false, false),
  R("site-book", `/${FIRM_SLUG}/book`, false, false),
  R("site-services", `/${FIRM_SLUG}/services`, false, false),
  R("site-service", `/${FIRM_SLUG}/services/legal-consultation`, false, false),
  R("site-lawyers", `/${FIRM_SLUG}/lawyers`, false, false),
  R("site-about", `/${FIRM_SLUG}/about`, false, false),
  R("site-contact", `/${FIRM_SLUG}/contact`, false, false),
  R("site-privacy", `/${FIRM_SLUG}/privacy`, false, false),
  R("site-terms", `/${FIRM_SLUG}/terms`, false, false),

  // The client portal, signed out and signed in.
  R("client-login", "/app/login", false, false),
  R("client-join", "/app/join", false, false),
  R("client-home", "/app", false),
  R("client-matters", "/app/matters", false),
  R("client-matter", `/app/matters/${MATTER}`, false),
  R("client-messages", "/app/messages", false),
  R("client-thread", `/app/messages/matter/${MATTER}`, false),
  R("client-appointments", "/app/appointments", false),
  R("client-appointment", `/app/appointments/${APPT}`, false),
  R("client-payments", "/app/payments", false),
  R("client-invoice", `/app/payments/${INVOICE}`, false),
  R("client-court-dates", "/app/court-dates", false),
  R("client-authority", "/app/authority", false),
  R("client-notifications", "/app/notifications", false),
  R("client-preferences", "/app/notifications/preferences", false),
  R("client-profile", "/app/profile", false),
  R("client-search", "/app/search", false),

  // The staff console. Docket-owned and deliberately near-monochrome, so the status pills are
  // the only saturated things on screen.
  R("staff-login", "/firm/login", true, false),
  R("staff-start", "/firm/start", true, false),
  R("staff-forgot", "/firm/forgot", true, false),
  R("staff-today", "/firm", true),
  R("staff-overview", "/firm/overview", true),
  R("staff-matters", "/firm/matters", true),
  R("staff-matter", `/firm/matters/${MATTER}`, true),
  R("staff-matter-new", "/firm/matters/new", true),
  R("staff-messages", "/firm/messages", true),
  R("staff-inbox", "/firm/inbox", true),
  R("staff-appointments", "/firm/appointments", true),
  R("staff-appointment", `/firm/appointments/${APPT}`, true),
  R("staff-clients", "/firm/clients", true),
  R("staff-client", `/firm/clients/${CLIENT}`, true),
  R("staff-invoices", "/firm/invoices", true),
  R("staff-invoice-new", "/firm/invoices/new", true),
  R("staff-tasks", "/firm/tasks", true),
  R("staff-sittings", "/firm/sittings", true),
  R("staff-availability", "/firm/availability", true),
  R("staff-uploads", "/firm/uploads", true),
  R("staff-collaborations", "/firm/collaborations", true),
  R("staff-search", "/firm/search", true),
  R("staff-me", "/firm/me", true),
  R("staff-admin", "/firm/admin", true),
  R("staff-admin-people", "/firm/admin/people", true),
  R("staff-admin-services", "/firm/admin/services", true),
  R("staff-admin-settings", "/firm/admin/settings", true),
  R("staff-admin-intake", "/firm/admin/intake", true),
  R("staff-admin-documents", "/firm/admin/documents", true),
  R("staff-admin-templates", "/firm/admin/templates", true),
  R("staff-admin-workflow", "/firm/admin/workflow", true),
  R("staff-admin-audit", "/firm/admin/audit", true),
  R("staff-admin-import", "/firm/admin/import", true),

  // The registry console and the platform admin. Both Docket's own.
  R("registry-home", "/registry", true),
  R("registry-import", "/registry/import", true),
  R("admin-home", "/admin", true),
  R("admin-health", "/admin/health", true),
  R("admin-reference", "/admin/reference", true),
  R("admin-registries", "/admin/registries", true),
  R("admin-workflow", "/admin/workflow", true),
];

const selected = ROUTES.filter((r) => !ONLY || r.name.includes(ONLY));
if (!selected.length) throw new Error(`--only ${JSON.stringify(ONLY)} matched no route`);

// ── what may be waived, and nothing else ──────────────────────────────────
//
// The same contract shots.mjs's IGNORE list keeps: each entry is one NAMED, DOCUMENTED gap, a
// waived finding is still counted and printed under "ignored" so a reader can see what was
// excused and argue with it, and everything else counts toward the exit status.
//
// It is EMPTY, and that is deliberate. Every finding this file reports today is a real one — the
// application has never been linted, so the first run is the inventory of the debt rather than a
// list of false alarms. Nothing should be added here to quieten a genuine finding; the place for
// a rule the design has decided against is the rule, not a waiver under it.
//
// Next.js's own development overlay is not waived here because it is not ours to judge at all:
// it is skipped inside the page, by element, before a finding is ever made.
const IGNORE = [];

const sessionCookie = {
  name: "sb-127-auth-token",
  value: `base64-${Buffer.from(JSON.stringify({
    access_token: TOKEN,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: CLIENT, aud: "authenticated", role: "authenticated" },
  })).toString("base64")}`,
  domain: "localhost",
  path: "/",
};

// @playwright/test is the declared devDependency; plain playwright is its runtime and is what a
// global install provides — the same fallback design/home/verify.mjs uses. It is imported here
// rather than at the top of the file so that --diff, which is arithmetic over two JSON files and
// opens no browser, runs in an environment that has no Playwright at all.
const { chromium } = await import("@playwright/test").catch(() => import("playwright"));

// This sandbox ships a Chromium that the pinned Playwright would otherwise try to re-download.
// PW_CHROMIUM points at the one that is already here.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

const problems = [];
const ignored = new Map();
const blocked = new Map();
const notes = [];
const rows = [];
let inspected = 0;
const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (const vp of VIEWPORTS) {
  // Two contexts per width: one carrying the session, one carrying nothing. The signed-out pass
  // is the point of the second — the landing, the tenant's public site and both sign-in screens
  // are how a stranger meets Docket, and a fixture that only ever arrives holding a session never
  // sees them.
  for (const authed of [true, false]) {
    const routes = selected.filter((r) => r.auth === authed);
    if (!routes.length) continue;

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      // Pinned so the OS preference can never decide a run. The theme is set explicitly on the
      // root below and `data-theme` beats the media query in app/globals.css either way, but a
      // fixture whose result depends on the machine it ran on is not a fixture.
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    if (authed) await context.addCookies([sessionCookie]);

    // The shared colour maths, installed before the first navigation and surviving every one
    // after it. See tests/fixtures/contrast.mjs for why it goes in this way and not as a
    // <script> tag: a tag would be walked by the sweeps below, which is a linter changing the
    // thing it measures.
    await context.addInitScript({ content: browserInstallScript() });

    // No outbound network here, so every external request must fail. Abort rather than fulfil,
    // for the reason shots.mjs gives at length: answering with `200 text/css` makes a broken
    // image or script look like a success and lies about content type. The visible consequence
    // is that the tenant's Google Fonts stylesheet does not load, so the public site renders in
    // a fallback face — which matters to the inventory's width and height fields and to nothing
    // else this file checks.
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
      tally(blocked, new URL(route.request().url()).host);
      return route.abort();
    });

    const page = await context.newPage();

    for (const route of routes) {
      let status = 0;
      try {
        const res = await page.goto(`${BASE}${route.url}`, { waitUntil: "networkidle", timeout: 30_000 });
        status = res?.status() ?? 0;
      } catch (e) {
        problems.push({ check: "route", signature: `navigation failed — ${e.message}`, where: `${route.name} @${vp.name}`, path: route.url });
        continue;
      }
      // A 404 or a 500 still renders a page, and a linter that judges an error page and reports
      // green on it is worse than one that does not run. The mismatch is reported here and the
      // sweep below still runs — an error page is a surface too — but the report says plainly
      // that what was measured is not the route that was asked for.
      if (status >= 400) {
        problems.push({ check: "route", signature: `HTTP ${status} — the page checked below is an error page, not ${route.url}`, where: `${route.name} @${vp.name}`, path: route.url });
      }

      for (const theme of THEMES) {
        // Pure CSS: every token is a variable that re-aliases itself, so flipping the attribute
        // repaints without a re-render and one navigation serves both themes. It is set after
        // the page has settled so React's hydration cannot take the attribute back off again.
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForTimeout(80);

        const audit = await page.evaluate(auditPage, {
          G: BROWSER_GLOBAL,
          RAMP,
          RADII,
          FIELD_MIN_PX,
          SEED: TENANT_SEED,
          PALETTE: DOCKET_PALETTE,
          docketOwned: route.docket,
          collectRows: Boolean(INVENTORY),
          where: { route: route.name, viewport: vp.name, theme },
        });

        inspected += audit.inspected;
        for (const f of audit.findings) problems.push({ ...f, where: `${route.name} @${vp.name}/${theme}` });
        if (INVENTORY) rows.push(...audit.rows);
      }
    }
    await page.close();
    await context.close();
  }
}

await browser.close();

/**
 * Everything that has to be asked of the browser, asked once per route x viewport x theme.
 *
 * It runs inside the page, so it may use nothing from the module scope above — every constant it
 * needs arrives in the single argument, and the colour arithmetic arrives on globalThis from the
 * init script. It returns findings and, when asked, inventory rows; it decides nothing about
 * exit status, which belongs to the report at the bottom of this file.
 */
function auditPage({ G, RAMP, RADII, FIELD_MIN_PX, SEED, PALETTE, docketOwned, collectRows, where }) {
  const { parse, ratio, over, hex, needed, bgOf } = globalThis[G];

  // Next.js's development overlay, its build indicator and its error dialogs are the framework's
  // own furniture. They are not Docket's design and a finding on them would be noise nobody can
  // act on, so they are skipped by element rather than waived after the fact.
  const DEV_FURNITURE = "nextjs-portal, #__next-build-watcher, [data-nextjs-dialog], [data-nextjs-toast], [data-nextjs-dialog-overlay]";
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "LINK", "META", "TITLE", "HEAD"]);

  const findings = [];
  const rows = [];
  // One box is judged once by (g), whatever it is reached through: colour is inherited, so the
  // same alert is arrived at again from every paragraph inside it.
  const lonelyJudged = new Set();
  const push = (check, signature, el) =>
    findings.push({ check, signature, path: pathOf(el), text: (el.textContent ?? "").trim().slice(0, 40) });

  /** A selector path stable enough to follow the same element across two runs. */
  const pathOf = (el) => {
    const seg = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      const sibs = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : [n];
      seg.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(n) + 1})` : tag);
    }
    return seg.join(">");
  };

  /** Text this element paints itself, rather than text a descendant paints. */
  const owns = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());

  const key = (c) => `${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;

  /**
   * "246 245 242", "#0F2A44" or "rgb(…)" — the three shapes a token value arrives in, and only
   * those three. The last is anchored where `parse` is not, because a token's value either IS a
   * colour or is not one: --t-shadow-e1 is "0 1px 2px rgb(16 24 40 / 0.04)", and an unanchored
   * search finds the rgb() inside it and adds a shadow's tint — and, from the dark shadows, pure
   * black — to the set of colours an element is allowed to paint. The anti-decay check below is
   * only worth running if the allowed set is the colours the system actually named.
   */
  const asColour = (value) => {
    const v = String(value).trim();
    if (!v) return null;
    const triple = v.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    if (triple) return { r: +triple[1], g: +triple[2], b: +triple[3], a: 1 };
    const h = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (h) {
      const full = h[1].length === 3 ? h[1].replace(/./g, (c) => c + c) : h[1];
      return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 };
    }
    return /^rgba?\([^()]*\)$/.test(v) ? parse(v) : null;
  };

  // ── the token set, read off the page rather than copied from it ─────────
  //
  // Every --t-* (the theme's own neutrals and status tints) and --dk-* (the tenant's colours)
  // in play, plus Docket's literal palette, which is hex in tailwind.config.ts precisely so a
  // firm cannot reach it and therefore cannot be read from a variable.
  //
  // The sweep visits the root and then every element that re-declares either family: the staff
  // and registry consoles pin --dk-* to a fixed monochrome set on their own wrapper, and
  // [data-theme-scope="light"] re-aliases --t-* on the landing's subtree so it stays light in a
  // dark browser. Reading only the root would flag every colour on those subtrees as a stray.
  const allowed = new Set();
  const collect = (el) => {
    const cs = getComputedStyle(el);
    for (let i = 0; i < cs.length; i++) {
      const name = cs.item(i);
      if (!name.startsWith("--t-") && !name.startsWith("--dk-") && !name.startsWith("--os-")) continue;
      const c = asColour(cs.getPropertyValue(name));
      if (c) allowed.add(key(c));
    }
  };
  const scopes = [document.documentElement, ...document.querySelectorAll('[style*="--dk-"], [data-theme-scope], .legal-os')];
  for (const el of scopes) collect(el);
  for (const literal of PALETTE) { const c = asColour(literal); if (c) allowed.add(key(c)); }

  // The four neutral text inks, read first so (g) below can leave out any status tone that is
  // one of them. --t-quiet-ink is byte-identical to --t-ink-muted in both themes — "cancelled"
  // and ordinary secondary prose are literally the same colour — so a check reading `color`
  // cannot tell them apart, and asking would put every muted paragraph in the app on the work
  // list for want of an icon it was never meant to carry.
  const neutralInks = new Set();
  for (const el of scopes) {
    const cs = getComputedStyle(el);
    for (const role of ["--t-ink", "--t-ink-strong", "--t-ink-muted", "--t-ink-disabled"]) {
      const c = asColour(cs.getPropertyValue(role));
      if (c) neutralInks.add(key(c));
    }
  }

  // The status inks, for (g). Read by name from every scope rather than typed out here, so the
  // check follows the tokens wherever they are re-aliased — a [data-theme-scope="light"] subtree
  // in a dark run holds six status inks the root does not.
  const statusInks = new Set();
  for (const el of scopes) {
    const cs = getComputedStyle(el);
    for (const tone of ["settled", "waiting", "wrong", "over", "quiet", "informing"]) {
      const c = asColour(cs.getPropertyValue(`--t-${tone}-ink`));
      if (c && !neutralInks.has(key(c))) statusInks.add(key(c));
    }
  }

  const seed = new Set(SEED.map((s) => key(asColour(s))));

  /** Every corner has to land on the scale, or on 0, or on full. */
  const radiusOk = (value) =>
    String(value).split(/\s+/).filter(Boolean).every((part) => {
      if (part.endsWith("%")) return false;
      const n = parseFloat(part);
      if (!Number.isFinite(n)) return false;
      return n === 0 || RADII.includes(n) || n >= 999;
    });

  let inspected = 0;

  for (const el of document.querySelectorAll("body *")) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest(DEV_FURNITURE)) continue;
    // getClientRects() is empty for display:none and for anything inside it, which
    // getComputedStyle(el).display is not — a child of a hidden parent reports its own display.
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    inspected++;

    const tag = el.tagName.toLowerCase();
    const isField = tag === "input" || tag === "select" || tag === "textarea";
    const textual = owns(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const ground = bgOf(el);
    const fg = parse(cs.color);

    // ── a. text contrast, against the ground actually behind it ──────────
    if (textual && fg && fg.a > 0.02) {
      const need = needed(size, weight);
      const r = ratio(over(fg, ground), ground);
      if (r < need) push("contrast", `${r.toFixed(2)}:1 needs ${need} — ${hex(over(fg, ground))} on ${hex(ground)}`, el);
    }

    // ── c. the ramp, and the one size that is allowed off it ─────────────
    if (isField) {
      if (size < FIELD_MIN_PX) push("field", `${size}px — iOS Safari zooms the page when a field under ${FIELD_MIN_PX}px is focused`, el);
    } else if (textual) {
      const rounded = Math.round(size * 10) / 10;
      if (!RAMP.includes(rounded)) push("ramp", `${rounded}px`, el);
    }

    // ── d/f. the colours this element actually paints ────────────────────
    //
    // `color` counts only where the element paints text of its own: it is inherited, so on a
    // wrapper it names a colour nobody can see and would report the same stray once per
    // descendant.
    const slots = [];
    if (textual) slots.push(["color", cs.color]);
    slots.push(["background", cs.backgroundColor]);
    // One border reported once. The four sides are read separately because a Tailwind
    // `border-b` paints only one of them, but the ordinary case is four sides of the same
    // colour, and four identical findings for one declaration is noise in a report whose whole
    // job is to be a work list.
    const sides = ["Top", "Right", "Bottom", "Left"].filter(
      (s) => (parseFloat(cs[`border${s}Width`]) || 0) > 0 && cs[`border${s}Style`] !== "none",
    );
    const sideColours = sides.map((s) => cs[`border${s}Color`]);
    if (sides.length === 4 && new Set(sideColours).size === 1) slots.push(["border", sideColours[0]]);
    else sides.forEach((s, i) => slots.push([`border-${s.toLowerCase()}`, sideColours[i]]));
    if (cs.outlineStyle !== "none" && (parseFloat(cs.outlineWidth) || 0) > 0) slots.push(["outline", cs.outlineColor]);

    for (const [slot, value] of slots) {
      const c = parse(value);
      if (!c || c.a <= 0.02) continue; // nothing painted
      const k = key(c);
      if (!allowed.has(k)) push("token", `${slot} ${hex(c)}`, el);
      // One shape of this finding is not a breach: a settings screen showing a firm its own
      // brand colour back as a swatch is a legitimate use of it on a Docket surface. That is a
      // named exception for the IGNORE list above, decided by a person, and not a reason to
      // weaken the rule for every other element.
      if (docketOwned && seed.has(k)) push("brand", `${slot} ${hex(c)} is the tenant's own colour, on a surface Docket owns`, el);
    }

    // ── e. the radius scale ──────────────────────────────────────────────
    for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
      if (!radiusOk(cs[corner])) { push("radius", `${cs[corner]}`, el); break; }
    }

    // ── g. status colour, never alone ────────────────────────────────────
    //
    // Colour is not readable to everyone and is not readable in every light, so a status carries
    // a word AND a mark or it is not a status. StatusPill always renders both; Badge's icon is
    // optional, and a tone reached for by hand has nothing holding it to either.
    //
    // The question goes to the element that DECIDED the colour, which is the highest ancestor
    // still painting the same ink — the pill, the alert, the toast — and not to everything that
    // merely inherited it. Asking each descendant instead reports one alert once per paragraph
    // inside it, and reports the <path> geometry inside a status icon, which paints nothing a
    // reader can see and cannot carry a label of its own.
    if (fg && fg.a > 0.02 && statusInks.has(key(fg))) {
      let box = el;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const c = parse(getComputedStyle(n).color);
        if (!c || key(c) !== key(fg)) break;
        box = n;
      }
      if (!lonelyJudged.has(box)) {
        lonelyJudged.add(box);
        const word = Boolean((box.textContent ?? "").trim());
        const mark = box.tagName.toLowerCase() === "svg" || Boolean(box.querySelector("svg"));
        if (!word || !mark)
          push("lonely", `${hex(fg)} is a status ink with ${word ? "a label" : "no label"} and ${mark ? "an icon" : "no icon"}`, box);
      }
    }

    // ── b. the control boundary ──────────────────────────────────────────
    //
    // Inputs, selects, textareas, buttons and anything with role=button always. An anchor only
    // when it has been given a control's box — not inline, and painted with a border or a
    // ground of its own — because a link inside a sentence is identified by being a link, and
    // SC 1.4.11 does not ask it for a boundary.
    //
    // A control with no border and no ground of its own is skipped rather than failed for the
    // same reason: a text button is identified by its label, and there is no boundary to judge.
    const isControl =
      isField || tag === "button" || el.getAttribute("role") === "button" ||
      (tag === "a" && cs.display !== "inline" && el.getBoundingClientRect().height >= 28);
    if (isControl) {
      const behind = bgOf(el.parentElement);
      const bw = parseFloat(cs.borderTopWidth) || 0;
      const edge = bw > 0 && cs.borderTopStyle !== "none" ? parse(cs.borderTopColor) : parse(cs.backgroundColor);
      if (edge && edge.a > 0.02) {
        const r = ratio(over(edge, behind), behind);
        if (r < 3) push("boundary", `${r.toFixed(2)}:1 needs 3 — ${tag} edge ${hex(over(edge, behind))} on ${hex(behind)}`, el);
      }
    }

    // ── the inventory row ────────────────────────────────────────────────
    if (collectRows && textual) {
      const box = el.getBoundingClientRect();
      rows.push({
        route: where.route,
        viewport: where.viewport,
        theme: where.theme,
        path: pathOf(el),
        text: (el.textContent ?? "").trim().slice(0, 48),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        background: hex(ground),
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
    }
  }

  return { findings, rows, inspected };
}

// ── the report ────────────────────────────────────────────────────────────
//
// Grouped by check and then by signature, because the same stray value is usually the same line
// of one shared component seen from forty screens, and forty identical lines is a wall rather
// than a work list. Each group prints its count, one example location and one example selector
// path — enough to go straight to it — and the whole ungrouped list goes to the output directory
// for anyone who wants it.

const LABELS = {
  route: "routes that did not render",
  contrast: "text below the WCAG AA ratio",
  boundary: "control boundaries below 3:1",
  ramp: "font sizes off the ramp",
  field: "fields under 16px — iOS Safari zooms on focus",
  token: "colours from outside the token set",
  radius: "corner radii off the scale",
  brand: "a tenant's brand colour on a Docket-owned surface",
  lonely: "status colour without both a label and an icon",
};

const kept = [];
for (const p of problems) {
  const waived = IGNORE.find((rule) => rule.test(p));
  if (waived) { tally(ignored, waived.label); continue; }
  kept.push(p);
}

const lines = [...ignored].map(([label, n]) => `  ${String(n).padStart(4)} x  ${label}`);
for (const [host, n] of blocked) {
  lines.push(`  ${String(n).padStart(4)} x  external request aborted (no outbound network here): ${host}`);
}
const ignoredReport = lines.length
  ? ["ignored (known fixture gaps) — waived, NOT counted as problems, listed so they can be challenged:", ...lines].join("\n")
  : "ignored (known fixture gaps): none";

notes.push(`${selected.length} routes x ${VIEWPORTS.length} viewports x ${THEMES.length} themes — ${inspected} elements inspected`);
notes.push(`a subtree pinned with data-theme-scope="light" (app/globals.css) — the landing, the 404s, and a firm's public site when its brand cannot carry a dark ground — has the same light pass twice, so a finding on one is counted once per pass and collapses into one row below`);

const report = [];
for (const [check, label] of Object.entries(LABELS)) {
  const group = kept.filter((p) => p.check === check);
  if (!group.length) { report.push(`ok    ${label}`); continue; }
  const bySignature = new Map();
  for (const p of group) {
    const seen = bySignature.get(p.signature);
    if (seen) seen.count++;
    else bySignature.set(p.signature, { count: 1, first: p });
  }
  report.push(`FAIL  ${label} (${group.length} in ${bySignature.size} distinct)`);
  const ordered = [...bySignature].sort((a, b) => b[1].count - a[1].count);
  for (const [signature, { count, first }] of ordered.slice(0, 12)) {
    report.push(`        ${String(count).padStart(4)} x  ${signature}`);
    report.push(`               e.g. ${first.where}  ${first.path}${first.text ? `  "${first.text}"` : ""}`);
  }
  if (ordered.length > 12) report.push(`        … and ${ordered.length - 12} more distinct, in ${path.join(OUT, "design-problems.txt")}`);
}

await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, "design-problems.txt"),
  kept.map((p) => `${p.check}\t${p.where}\t${p.signature}\t${p.path}\t${p.text ?? ""}`).join("\n") || "none",
);
await writeFile(path.join(OUT, "ignored.txt"), `${ignoredReport}\n`);

if (INVENTORY) {
  await mkdir(path.dirname(path.resolve(INVENTORY)), { recursive: true });
  await writeFile(INVENTORY, JSON.stringify({
    meta: {
      recorded: new Date().toISOString(),
      base: BASE,
      routes: selected.map((r) => r.name),
      viewports: VIEWPORTS.map((v) => v.name),
      themes: THEMES,
    },
    rows,
  }));
  notes.push(`inventory: ${rows.length} rows → ${INVENTORY}`);
}

console.log(ignoredReport);
console.log("");
console.log(notes.map((n) => `note: ${n}`).join("\n"));
console.log("");
console.log(report.join("\n"));
console.log("");
console.log(kept.length ? `PROBLEMS (${kept.length}) — the full list is in ${path.join(OUT, "design-problems.txt")}` : "no problems found");

// Recording is not gating. `--inventory` exists to capture a baseline before a change and an
// after alongside it, and a nonzero exit there would make the capture itself fail a shell that
// stops on error — with nothing gained, because the run that gates is the one without the flag.
process.exit(INVENTORY ? 0 : kept.length ? 1 : 0);

/**
 * The rows that changed between two inventories, and nothing else.
 *
 * Only the style fields are compared. `text` travels with a row so a diff can be read without
 * opening the app, but a copy edit is not a design change and does not make a row appear here.
 */
async function runDiff(beforePath, afterPath) {
  const load = async (p) => {
    const doc = JSON.parse(await readFile(p, "utf8"));
    const index = new Map();
    for (const row of doc.rows) index.set(`${row.route}|${row.viewport}|${row.theme}|${row.path}`, row);
    return { doc, index };
  };
  const a = await load(beforePath);
  const b = await load(afterPath);

  const FIELDS = ["fontSize", "fontWeight", "color", "background", "border", "radius", "shadow", "width", "height"];
  const changed = [];
  const gone = [];
  const added = [];

  for (const [k, before] of a.index) {
    const after = b.index.get(k);
    if (!after) { gone.push(before); continue; }
    const moved = FIELDS.filter((f) => before[f] !== after[f]);
    if (moved.length) changed.push({ before, after, moved });
  }
  for (const [k, after] of b.index) if (!a.index.has(k)) added.push(after);

  for (const { before, after, moved } of changed) {
    console.log(`${before.route} @${before.viewport}/${before.theme}  ${before.path}${before.text ? `  "${before.text}"` : ""}`);
    for (const f of moved) console.log(`    ${f.padEnd(12)} ${before[f]}  ->  ${after[f]}`);
  }

  console.log("");
  const s = (n) => (n === 1 ? "row" : "rows");
  console.log(`${changed.length} ${s(changed.length)} changed, ${added.length} appeared, ${gone.length} disappeared, out of ${a.index.size} before / ${b.index.size} after`);
  if (added.length || gone.length) {
    // Worth saying out loud: a selector path carries nth-of-type, so one element inserted among
    // its siblings renumbers every later sibling and each of those rows appears here as one that
    // disappeared and one that appeared. That is the known cost of a path-keyed diff, and it is
    // still cheaper to read than a pixel diff of the same change.
    console.log("rows that appeared or disappeared include every sibling renumbered by an insertion — see tests/fixtures/README.md");
  }
  // A diff reports; it does not judge. During a consolidation most of what it prints is the
  // change that was intended, and only a person can say which rows those are.
  return 0;
}
