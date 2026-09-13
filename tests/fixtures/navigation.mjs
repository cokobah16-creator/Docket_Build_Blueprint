// Regression harness for the primary navigation and the phone's More sheet.
//
//   MOCK_TOKEN=<token> PW_CHROMIUM=<chromium> node tests/fixtures/navigation.mjs
//
// A LAYOUT-AND-LIFECYCLE fixture against tests/fixtures/supabase-mock.mjs,
// which implements no row-level security and checks no session. It proves that
// the console keeps pointing at the firm on screen, and that the More sheet
// behaves like a dialog. It proves nothing about who may see which firm — that
// is the database's job and is covered in tests/integration/.
//
// The mock's staff member belongs to two firms, which is the only case in which
// any of this is ambiguous, and therefore the only case worth testing.

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TOKEN = process.env.MOCK_TOKEN;
if (!TOKEN) throw new Error("set MOCK_TOKEN to the access token the mock printed");

const FIRM_A = "22222222-2222-4222-8222-222222222222";
const FIRM_B = "33333333-3333-4333-8333-333333333333";

const sessionCookie = {
  name: "sb-127-auth-token",
  path: "/",
  domain: "localhost",
  value: `base64-${Buffer.from(
    JSON.stringify({
      access_token: TOKEN,
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated" },
    }),
  ).toString("base64")}`,
};

const problems = [];
const notes = [];
function check(name, actual, expected, extra = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) notes.push(`PASS  ${name}`);
  else problems.push(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}${extra ? `\n        ${extra}` : ""}`);
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

// Next compiles a route the first time it is asked for, which in dev can take
// longer than any sensible wait. Warm the ones this harness walks through, so a
// timeout below means a broken link rather than a cold compiler.
async function warm(paths) {
  const { ctx, page } = await newPage();
  for (const path of paths) await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await ctx.close();
}

async function newPage(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([sessionCookie]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  const page = await ctx.newPage();
  return { ctx, page };
}

/**
 * Waits until React has taken over the element, not merely until the server's
 * HTML for it has arrived. Clicking a button that is on the glass but not yet
 * hydrated does nothing at all, which would look exactly like a broken menu.
 */
async function interactive(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el) && Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    },
    selector,
    { timeout: 20_000 },
  );
}

/** Which firm every sidebar destination is pointing at. */
const navFirms = (page) =>
  page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("nav[aria-label=Console]")).find(
      (n) => getComputedStyle(n).display !== "none",
    );
    if (!nav) return ["NO VISIBLE NAV"];
    // Destinations only. The masthead's link to the console root and the
    // switcher's links to the OTHER firms live in the same element and are
    // meant to name a different firm — counting them would be asserting that
    // the switcher does not work.
    const firms = new Set();
    for (const a of nav.querySelectorAll('[data-dk-nav="destination"]')) {
      firms.add(new URL(a.getAttribute("href"), location.origin).searchParams.get("firm"));
    }
    return Array.from(firms).sort();
  });

await warm([`/firm?firm=${FIRM_A}`, `/firm?firm=${FIRM_B}`, `/firm/matters?firm=${FIRM_B}`]);

// ── 1. switching firm without leaving the route ──────────────────────────
//
// This is the case the old code could not see. The switcher is a Next.js Link,
// so clicking it is a client-side navigation: the query changes and the
// pathname does not. Navigation read the query in an effect keyed on the
// pathname, so it never ran again and every destination went on naming the
// firm just left — and because `requestedFirmId()` prefers the query over the
// cookie, the next click actually undid the switch. A hard reload would have
// hidden all of this, which is why nothing here reloads.
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/firm?firm=${FIRM_A}`, { waitUntil: "domcontentloaded" });
  await interactive(page, 'a[data-dk-nav="destination"]');
  check("on firm A every destination names firm A", await navFirms(page), [FIRM_A]);

  // Click "switch to the other firm" — a soft navigation, same pathname.
  await page.locator(`nav[aria-label="Switch firm"] a[href*="${FIRM_B}"]`).first().click();
  await page.waitForFunction((b) => location.search.includes(b), FIRM_B, { timeout: 30_000 });
  await interactive(page, 'a[data-dk-nav="destination"]');
  check("after switching on the same route the destinations name firm B", await navFirms(page), [FIRM_B], `url ${page.url()}`);

  // The chrome must agree with the address bar. The sidebar names the firm it
  // believes it is showing; if the layout were reused across the switch it
  // would still be naming the firm the member had just left.
  check(
    "the sidebar names the firm that is actually on screen",
    await page.evaluate(() => {
      const nav = Array.from(document.querySelectorAll("nav[aria-label=Console]")).find((n) => getComputedStyle(n).display !== "none");
      return nav?.querySelector('a[href="/firm"]')?.textContent?.trim() ?? null;
    }),
    "Bello & Co",
  );

  // Follow one of those destinations, again client-side.
  await page.locator('a[data-dk-nav="destination"][href*="/firm/matters"]').first().click();
  await page.waitForFunction(() => location.pathname.startsWith("/firm/matters"), null, { timeout: 30_000 });
  await interactive(page, 'a[data-dk-nav="destination"]');
  check("following a destination keeps firm B in the address", new URL(page.url()).searchParams.get("firm"), FIRM_B);
  check("after following it the destinations still name firm B", await navFirms(page), [FIRM_B], `url ${page.url()}`);

  await ctx.close();
}

// ── 2. Back and Forward ───────────────────────────────────────────────────
{
  const { ctx, page } = await newPage();
  await page.goto(`${BASE}/firm?firm=${FIRM_A}`, { waitUntil: "domcontentloaded" });
  await interactive(page, 'a[data-dk-nav="destination"]');
  await page.locator(`nav[aria-label="Switch firm"] a[href*="${FIRM_B}"]`).first().click();
  await page.waitForFunction((b) => location.search.includes(b), FIRM_B, { timeout: 30_000 });
  await interactive(page, 'a[data-dk-nav="destination"]');

  await page.goBack();
  await page.waitForFunction((a) => location.search.includes(a), FIRM_A, { timeout: 30_000 });
  await interactive(page, 'a[data-dk-nav="destination"]');
  check("Back returns to firm A and the destinations follow", await navFirms(page), [FIRM_A], `url ${page.url()}`);

  await page.goForward();
  await page.waitForFunction((b) => location.search.includes(b), FIRM_B, { timeout: 30_000 });
  await interactive(page, 'a[data-dk-nav="destination"]');
  check("Forward returns to firm B and the destinations follow", await navFirms(page), [FIRM_B], `url ${page.url()}`);
  await ctx.close();
}

// ── 3. the More sheet behaves like a dialog ───────────────────────────────
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.goto(`${BASE}/firm`, { waitUntil: "domcontentloaded" });
  await interactive(page, "button[aria-controls]");

  const moreButton = page.getByRole("button", { name: "More" });
  await moreButton.click();
  const sheet = page.getByRole("dialog", { name: "More destinations" });
  await sheet.waitFor({ state: "visible", timeout: 5000 });

  check("opening More locks the page behind it", await page.evaluate(() => document.body.style.overflow), "hidden");

  check(
    "the page behind is inert",
    await page.evaluate(() => {
      const dialog = document.querySelector('[role=dialog]');
      const main = document.querySelector("#main");
      // Inert applies to an ancestor of main, not necessarily main itself.
      let node = main;
      while (node) {
        if (node.hasAttribute?.("inert")) return true;
        node = node.parentElement;
      }
      return Boolean(dialog) && false;
    }),
    true,
  );

  check("focus moves into the sheet", await page.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    return Boolean(d && d.contains(document.activeElement));
  }), true);

  // Tab all the way round: focus must never leave the sheet.
  let escaped = false;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      return Boolean(d && d.contains(document.activeElement));
    });
    if (!inside) { escaped = true; break; }
  }
  check("Tab cannot leave the sheet", escaped, false);

  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached", timeout: 5000 });
  check("Escape closes the sheet", await page.getByRole("dialog").count(), 0);
  check("the page scrolls again", await page.evaluate(() => document.body.style.overflow), "");
  check(
    "nothing is left inert",
    await page.evaluate(() => document.querySelectorAll("[inert]").length),
    0,
  );
  check(
    "focus returns to the More button",
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
    "More",
  );
  await ctx.close();
}

// ── 4. a rotation into tablet width must not strand the sheet ─────────────
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.goto(`${BASE}/firm`, { waitUntil: "domcontentloaded" });
  await interactive(page, "button[aria-controls]");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More destinations" }).waitFor({ state: "visible", timeout: 5000 });

  // 844x390 is the same phone, turned on its side — and wide enough to be the
  // tablet arrangement, where the sheet is display:none.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);

  check("rotating past the breakpoint closes the sheet", await page.getByRole("dialog").count(), 0);
  check("the page scrolls again after the rotation", await page.evaluate(() => document.body.style.overflow), "");
  check("nothing is left inert after the rotation", await page.evaluate(() => document.querySelectorAll("[inert]").length), 0);
  check(
    "focus is not stranded inside something hidden",
    await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return true;
      // Visible means it has a box; a display:none ancestor gives it none.
      return el.getBoundingClientRect().width > 0 || el.getBoundingClientRect().height > 0;
    }),
    true,
  );
  await ctx.close();
}

await browser.close();
for (const n of notes) console.log(n);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(p);
} else {
  console.log("\nno problems found");
}
process.exit(problems.length ? 1 : 0);
