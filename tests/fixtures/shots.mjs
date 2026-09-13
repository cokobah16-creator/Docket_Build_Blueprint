// Opens the real screens at each breakpoint and writes a PNG per screen per width.
//
//   node tests/fixtures/supabase-mock.mjs --port 54321 &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> npm run dev &
//   node tests/fixtures/shots.mjs --out /tmp/shots
//
// It also fails loudly on the two things a responsive change breaks most often: a page wider
// than its viewport, and anything the browser logged as an error while rendering it.

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

// This sandbox ships a Chromium that the pinned Playwright would otherwise try to
// re-download. PW_CHROMIUM points at the one that is already here.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const problems = [];

for (const vp of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await context.addCookies([sessionCookie]);
  // This sandbox has no outbound network, so the tenant's Google Fonts link
  // hangs and then resets. Fulfil it empty: the layout is what is under test,
  // and a webfont that never arrives would only add noise to every console.
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );

  const page = await context.newPage();

  for (const screen of SCREENS) {
    if (ONLY && !screen.name.includes(ONLY)) continue;
    const errors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

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
    // The stand-in has no Realtime server, so every screen with a live
    // subscription logs a failed WebSocket handshake. That is the fixture's
    // gap, not the page's, and it would drown the findings that matter.
    const IGNORE = [/realtime\/v1\/websocket/i, /WebSocket/i];
    for (const e of errors) {
      if (IGNORE.some((re) => re.test(e))) continue;
      problems.push(`${screen.name} @${vp.name}: console ${e}`);
    }

    const dir = path.join(OUT, vp.name);
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${screen.name}.png`), fullPage: false });
  }
  await context.close();
}

await browser.close();
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "problems.txt"), problems.join("\n") || "none");
console.log(problems.length ? `PROBLEMS (${problems.length}):\n` + problems.join("\n") : "no problems found");
