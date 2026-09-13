// LAYOUT FIXTURE — screenshots and layout assertions only.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
// This runs the real screens in a real browser against tests/fixtures/supabase-mock.mjs, a
// stand-in Supabase. That stand-in implements NO row-level security and checks NO session: it
// hands out a user and a fixed set of rows because it was asked. So this file proves that a
// screen lays out and reads correctly at a given width, and NOTHING WHATEVER about who may see
// it. Authorization belongs to the database and only a real project can demonstrate it. Do not
// cite a green run here as evidence that any access rule works.
//
// It is separate from tests/e2e/, which runs against a real target (a deployment, or a dev
// server wired to a real Supabase project) and is where anything about real data belongs.
//
// TO RERUN THIS (layout fixtures, stand-in Supabase)
//   node tests/fixtures/supabase-mock.mjs --port 54321 --role staff &
//   # the mock prints ANON_KEY=<key>; use that same value for both variables below
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//     NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> npm run dev &
//   MOCK_TOKEN=<key> npm run test:layout        # === node tests/fixtures/shots.mjs
//   MOCK_TOKEN=<key> npm run test:ergonomics    # === node tests/fixtures/ergonomics.mjs
//
// TO RERUN THE REAL TESTS (tests/e2e/, real target)
//   npm run test:e2e                                          # starts next dev itself
//   PLAYWRIGHT_BASE_URL=https://<deployment> npm run test:e2e # against a deployment
//
// Options: --out <dir> (default /tmp/shots), --base <url>, --only <substring of a screen name>.
// In a sandbox with no bundled Playwright browser, set PW_CHROMIUM to a Chromium binary.
//
// It writes a PNG per screen per width, and fails loudly on the two things a responsive change
// breaks most often: a page wider than its viewport, and anything the browser logged as an error
// while rendering it. It EXITS NONZERO when it found problems — see the exit at the end.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const OUT = arg("out", "/tmp/shots");
const BASE = arg("base", "http://localhost:3000");
const ONLY = arg("only", "");

const TOKEN = process.env.MOCK_TOKEN;
if (!TOKEN) throw new Error("set MOCK_TOKEN to the access token the mock printed");

const WIDTHS = [
  { name: "360", width: 360, height: 780 },
  { name: "390", width: 390, height: 844 },
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

const SCREENS = [
  { name: "staff-today", url: "/firm" },
  { name: "staff-matter", url: "/firm/matters/44444444-4444-4444-8444-444444444444" },
  { name: "staff-messages", url: "/firm/messages" },
  { name: "staff-appointments", url: "/firm/appointments" },
  { name: "staff-clients", url: "/firm/clients" },
  { name: "client-home", url: "/app" },
  { name: "client-matter", url: "/app/matters/44444444-4444-4444-8444-444444444444" },
  { name: "client-messages", url: "/app/messages" },
  { name: "client-appointments", url: "/app/appointments" },
  { name: "client-appointment", url: "/app/appointments/55555555-5555-4555-8555-555555555555" },
];

const sessionCookie = {
  name: "sb-127-auth-token",
  value: `base64-${Buffer.from(JSON.stringify({
    access_token: TOKEN,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated" },
  })).toString("base64")}`,
  domain: "localhost",
  path: "/",
};

// ── what may be waived, and nothing else ──────────────────────────────────
//
// Each entry is one NAMED, DOCUMENTED gap in the fixture rig. A console error matches only if
// the predicate says so; everything else is a problem and counts toward the exit status. Waived
// errors are still counted and printed under "ignored (known fixture gaps)" below, so a reader
// can see what was excused and argue with it.
//
// The predicate gets both the message text and the URL the browser attributes the message to
// (ConsoleMessage.location().url), because Chromium's resource-load errors carry no URL in
// their text — "Failed to load resource: net::ERR_FAILED" and nothing more. Matching that text
// would waive EVERY failed resource in the app; matching the location URL waives exactly one.
const IGNORE = [
  {
    label: "Realtime handshake to the stand-in Supabase (it runs no Realtime server)",
    // Narrow on purpose: the local stand-in's realtime endpoint only. A WebSocket failure to
    // any other host or path is a real finding and must be reported.
    test: ({ text }) =>
      /WebSocket connection to 'wss?:\/\/(?:127\.0\.0\.1|localhost):\d+\/realtime\/v1\/websocket/i.test(text),
  },
  {
    label: "Tenant's Google Fonts stylesheet, blocked because this sandbox has no outbound network",
    // Matched by the console message's source URL, not by its text — see the note above. Only
    // the fonts.googleapis.com stylesheet is waived; a failed image, script or API call still
    // reports, because its location URL is not this one.
    test: ({ url }) => /^https:\/\/fonts\.googleapis\.com\//i.test(url),
  },
];

// This sandbox ships a Chromium that the pinned Playwright would otherwise try to
// re-download. PW_CHROMIUM points at the one that is already here.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

const problems = [];
// Waived console errors and blocked external requests, counted by reason so the summary is
// short but the volume is visible.
const ignored = new Map();
const blocked = new Map();
const tally = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

for (const vp of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await context.addCookies([sessionCookie]);

  // This sandbox has no outbound network, so every request that leaves it must fail. ABORT them
  // rather than fulfil them.
  //
  // WHY ABORT AND NOT FULFIL. The previous version answered every external request with
  // `200 text/css` and an empty body. That told two lies: a broken <img> or <script> came back
  // looking like a success, and a stylesheet's content type was claimed for resources that were
  // not stylesheets. An abort is the truth — there is no network — and the page reacts the way
  // it really would offline.
  //
  // The one console error this produces is the tenant's Google Fonts stylesheet failing to load
  // (app/firm/(console)/layout.tsx and src/lib/brand.ts build that <link>). That is legitimate
  // information rather than noise, so it is not hidden: it is waived by the second IGNORE entry
  // above — matched by its exact fonts.googleapis.com source URL, not by a broad text pattern —
  // and it is printed, with a count, in the "ignored" section. Every blocked host is listed
  // there too, so if something unexpected starts reaching for the network it shows up.
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
    tally(blocked, new URL(route.request().url()).host);
    return route.abort();
  });

  const page = await context.newPage();

  for (const screen of SCREENS) {
    if (ONLY && !screen.name.includes(ONLY)) continue;
    const errors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (m) => {
      if (m.type() === "error") errors.push({ text: m.text(), url: m.location()?.url ?? "" });
    });
    page.on("pageerror", (e) => errors.push({ text: `pageerror: ${e.message}`, url: "" }));

    let status = 0;
    try {
      const res = await page.goto(`${BASE}${screen.url}`, { waitUntil: "networkidle", timeout: 30_000 });
      status = res?.status() ?? 0;
    } catch (e) {
      problems.push(`${screen.name} @${vp.name}: navigation failed — ${e.message}`);
      continue;
    }

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      // The widest element actually sticking out, to name the culprit.
      culprit: (() => {
        const w = document.documentElement.clientWidth;
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > w + 1) {
            return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)}`;
          }
        }
        return null;
      })(),
    }));

    if (status >= 400) problems.push(`${screen.name} @${vp.name}: HTTP ${status}`);
    if (overflow.doc > overflow.win + 1) {
      problems.push(`${screen.name} @${vp.name}: horizontal overflow ${overflow.doc} > ${overflow.win} — ${overflow.culprit ?? "unknown"}`);
    }

    for (const e of errors) {
      const waived = IGNORE.find((rule) => rule.test(e));
      if (waived) { tally(ignored, waived.label); continue; }
      problems.push(`${screen.name} @${vp.name}: console ${e.text}`);
    }

    const dir = path.join(OUT, vp.name);
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${screen.name}.png`), fullPage: false });
  }
  await context.close();
}

await browser.close();

// ── report ────────────────────────────────────────────────────────────────
const lines = [...ignored].map(([label, n]) => `  ${String(n).padStart(4)} x  ${label}`);
for (const [host, n] of blocked) {
  lines.push(`  ${String(n).padStart(4)} x  external request aborted (no outbound network here): ${host}`);
}
const ignoredReport = lines.length
  ? ["ignored (known fixture gaps) — waived, NOT counted as problems, listed so they can be challenged:", ...lines].join("\n")
  : "ignored (known fixture gaps): none";

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "problems.txt"), problems.join("\n") || "none");
await writeFile(path.join(OUT, "ignored.txt"), `${ignoredReport}\n`);

console.log(ignoredReport);
console.log("");
console.log(problems.length ? `PROBLEMS (${problems.length}):\n` + problems.join("\n") : "no problems found");

// Nonzero on failure, so CI and a human rerunning this cannot read a failure as a pass.
process.exit(problems.length ? 1 : 0);
