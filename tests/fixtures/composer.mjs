// Regression harness for the first second of a form's life.
//
// Mostly the client's message composer, and at the end the lawyer's court-update
// form, which had the same defect for the same reason.
//
//   node tests/fixtures/supabase-mock.mjs --port 54321 &
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 ... npm run dev &
//   MOCK_TOKEN=<token> PW_CHROMIUM=<chromium> node tests/fixtures/composer.mjs
//
// This is a LAYOUT-AND-LIFECYCLE fixture, not an authorisation test: it runs
// against tests/fixtures/supabase-mock.mjs, which implements no row-level
// security and checks no session. See tests/fixtures/README.md.
//
// What it is guarding
// -------------------
// The thread page is server-rendered, so the composer is on the glass and
// accepts keystrokes roughly a second before React attaches to it. Every case
// below types or pastes AT THE MOMENT THE COMPOSER APPEARS. None of them waits
// for the page to settle first: waiting is what hid this bug, and a regression
// test that waits would pass over the defect it exists to catch.
//
// A note on Playwright's fill(): it does dispatch a real `input` event, so it
// is not "bypassing React". Before hydration there is simply no React listener
// on the element yet — the same reason a human's keystrokes were lost. Both
// typing and pasting are covered below because they take different paths
// through the browser but the same path through the application.

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const TOKEN = process.env.MOCK_TOKEN;
if (!TOKEN) throw new Error("set MOCK_TOKEN to the access token the mock printed");

const USER = "11111111-1111-4111-8111-111111111111";
const MATTER = "44444444-4444-4444-8444-444444444444";
const THREAD = `/app/messages/matter/${MATTER}`;
const DRAFT_KEY = `docket:draft:${USER}:message:${MATTER}`;

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
      user: { id: USER, aud: "authenticated", role: "authenticated" },
    }),
  ).toString("base64")}`,
};

const problems = [];
const notes = [];
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);

/**
 * Opens the thread and hands back a page positioned at the exact instant the
 * composer exists in the DOM — which is well before React has attached to it.
 */
async function openThread({ seedDraft = null, slowActions = 0, hydrateAfter = 1500, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([sessionCookie]);
  // No outbound network in the sandbox: refuse rather than fake a success.
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());

  // Hold the client bundle back so hydration is reliably later than the first
  // keystroke. Without this the test is a race against a warm dev server and
  // passes or fails by luck; with it the window under test is always open.
  // It slows hydration, it does not change what the application does in it.
  if (hydrateAfter > 0) {
    await ctx.route("**/_next/static/chunks/**", async (route) => {
      await new Promise((r) => setTimeout(r, hydrateAfter));
      return route.continue();
    });
  }

  if (slowActions > 0) {
    // Hold every server action and data round trip back, so hydration and the
    // first responses land far apart. A composer that is correct only when the
    // server is quick is not correct.
    await ctx.route("**/app/**", async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((r) => setTimeout(r, slowActions));
      }
      return route.continue();
    });
  }

  const page = await ctx.newPage();

  // Record whether React had attached when each keystroke landed, so a failure
  // report says WHY rather than just "characters went missing".
  await page.addInitScript(() => {
    window.__reactAttached = () => {
      const el = document.querySelector("textarea");
      return Boolean(el) && Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    };
  });

  if (seedDraft !== null) {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([key, value]) =>
        localStorage.setItem(key, JSON.stringify({ v: value, at: new Date().toISOString() })),
      [DRAFT_KEY, seedDraft],
    );
  } else {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    await page.evaluate((key) => localStorage.removeItem(key), DRAFT_KEY);
  }

  await page.goto(`${BASE}${THREAD}`, { waitUntil: "commit" });
  await page.waitForSelector("textarea", { state: "attached", timeout: 20_000 });
  const hydratedAlready = await page.evaluate(() => window.__reactAttached());
  // If React had already attached we never entered the window this harness
  // exists to test, and a pass would mean nothing.
  if (hydratedAlready && hydrateAfter > 0) {
    problems.push("SETUP  React had already attached when the composer appeared — the pre-hydration window was not exercised");
  }
  return { ctx, page, hydratedAlready };
}

/** Waits until React has taken the element over and any restore has settled. */
async function settle(page) {
  await page.waitForFunction(() => window.__reactAttached(), null, { timeout: 20_000 });
  await page.waitForTimeout(700); // the draft's 400ms write, plus room
}

function check(name, actual, expected, extra = "") {
  if (actual === expected) {
    notes.push(`PASS  ${name}`);
  } else {
    problems.push(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}${extra ? `\n        ${extra}` : ""}`);
  }
}

// ── 1. typing the instant the composer appears ────────────────────────────
{
  const { ctx, page, hydratedAlready } = await openThread();
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially("Please confirm the hearing date.", { delay: 25 });
  await settle(page);
  check(
    "typing as soon as the composer appears keeps every character",
    await page.locator("textarea").inputValue(),
    "Please confirm the hearing date.",
    `React had attached before typing: ${hydratedAlready}`,
  );
  await ctx.close();
}

// ── 2. pasting the instant the composer appears ───────────────────────────
{
  const { ctx, page } = await openThread();
  const PASTED = "Pasted from the court's cause list: ID/4471GCM/2026";
  await page.locator("textarea").click();
  // A real paste: the clipboard event carries the text, as it would from a
  // long-press Paste on a phone.
  await page.locator("textarea").evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    // Browsers apply the paste themselves; in a dispatched event we apply it,
    // then fire the same input event the browser would.
    if (el.value === "") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, PASTED);
  await settle(page);
  check("pasting as soon as the composer appears keeps every character", await page.locator("textarea").inputValue(), PASTED);
  await ctx.close();
}

// ── 3. fill() the instant the composer appears ────────────────────────────
// fill() dispatches a genuine input event. If this loses text, the application
// was not ready, and no amount of test-side cleverness should paper over it.
{
  const { ctx, page } = await openThread();
  const TEXT = "Filled before hydration";
  await page.locator("textarea").fill(TEXT);
  await settle(page);
  check("fill() as soon as the composer appears keeps every character", await page.locator("textarea").inputValue(), TEXT);
  await ctx.close();
}

// ── 4. a saved draft and early typing must not destroy each other ─────────
{
  const { ctx, page } = await openThread({
    seedDraft: { body: "Saved earlier. ", attachments: [], id: "draft-id-kept" },
  });
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially("Typed now.", { delay: 25 });
  await settle(page);
  const value = await page.locator("textarea").inputValue();
  const keptBoth = value.includes("Saved earlier.") && value.includes("Typed now.");
  check("a restored draft and early typing both survive", keptBoth, true, `composer held ${JSON.stringify(value)}`);

  // The id the send will carry must still be the saved one, or a retry after a
  // lost reply would land a second copy.
  const storedId = await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null")?.v?.id ?? null; } catch { return null; }
  }, DRAFT_KEY);
  check("the saved draft's send id is preserved for duplicate protection", storedId, "draft-id-kept");
  await ctx.close();
}

// ── 5. a slow server must not cost characters ─────────────────────────────
{
  const { ctx, page } = await openThread({ slowActions: 2500 });
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially("Typed while the server was slow.", { delay: 25 });
  await settle(page);
  await page.waitForTimeout(3000); // let the held-back responses land
  check(
    "characters survive a server that answers late",
    await page.locator("textarea").inputValue(),
    "Typed while the server was slow.",
  );
  await ctx.close();
}

// ── 6. attachments and text survive a resize across every breakpoint ──────
{
  const { ctx, page } = await openThread();
  const TEXT = "Half a sentence that must survive the rotation";
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially(TEXT, { delay: 12 });
  await settle(page);
  for (const [name, width, height] of [
    ["landscape", 844, 390],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
    ["back to phone", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const boxes = await page.locator("textarea").count();
    check(`the draft survives ${name}`, await page.locator("textarea").first().inputValue(), TEXT);
    check(`exactly one composer exists at ${name}`, boxes, 1);
  }
  await ctx.close();
}

// ── 7. the draft still reaches storage, and Send still works ──────────────
{
  const { ctx, page } = await openThread();
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially("Kept on this device.", { delay: 20 });
  await settle(page);
  const stored = await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null")?.v?.body ?? null; } catch { return null; }
  }, DRAFT_KEY);
  check("what was typed early is written to the device draft", stored, "Kept on this device.");

  const sendEnabled = await page.getByRole("button", { name: /^send$/i }).isEnabled();
  check("Send is available once the composer is live", sendEnabled, true);
  await ctx.close();
}

// ── 8. a send that does not arrive keeps the words for the retry ──────────
{
  const { ctx, page } = await openThread({ hydrateAfter: 0 });
  await settle(page);
  const TEXT = "Filed today, please confirm receipt.";
  await page.locator("textarea").click();
  await page.locator("textarea").pressSequentially(TEXT, { delay: 10 });
  await page.waitForTimeout(500);

  // The connection drops at the moment of sending. Nothing may be thrown away:
  // the message might have landed, and the words are the only copy.
  await ctx.route("**/app/**", (route) =>
    route.request().method() === "POST" ? route.abort("connectionfailed") : route.continue(),
  );
  await page.getByRole("button", { name: /^send$/i }).click();
  await page.waitForTimeout(1500);

  check("a send that fails leaves every character in the composer", await page.locator("textarea").inputValue(), TEXT);
  const stored = await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null")?.v?.body ?? null; } catch { return null; }
  }, DRAFT_KEY);
  check("and the device still holds the draft after a failed send", stored, TEXT);
  await ctx.close();
}

// ── 9. the staff court-update form, which had the same bug ───────────────
//
// The matter timeline's note form is the same story on the console side, and a
// worse loss: it is what a lawyer types after a sitting. It sits inside a
// <details>, which opens without JavaScript, so the journey is real — open it,
// start typing, and the page hydrates underneath you.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([sessionCookie]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await ctx.route("**/_next/static/chunks/**", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__reactAttached = () => {
      const el = document.querySelector("#note-body");
      return Boolean(el) && Object.keys(el).some((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
    };
  });
  await page.goto(`${BASE}/firm/matters/${MATTER}`, { waitUntil: "commit" });
  await page.waitForSelector("#note-body", { state: "attached", timeout: 60_000 });
  await page.locator("summary").first().click();

  const HEADING = "Adjourned for continuation";
  const DETAIL = "The court did not reach the matter and adjourned it.";
  await page.locator("#note-title").click();
  await page.locator("#note-title").pressSequentially(HEADING, { delay: 12 });
  await page.locator("#note-body").click();
  await page.locator("#note-body").pressSequentially(DETAIL, { delay: 12 });
  await page.locator("#note-meaning").click();
  await page.locator("#note-meaning").pressSequentially("The case did not finish today.", { delay: 12 });

  await page.waitForFunction(() => window.__reactAttached(), null, { timeout: 30_000 });
  await page.waitForTimeout(900);

  check("the court update's heading survives hydration", await page.locator("#note-title").inputValue(), HEADING);
  check("the court update's detail survives hydration", await page.locator("#note-body").inputValue(), DETAIL);
  check("the shared client-update field survives hydration", await page.locator("#note-meaning").inputValue(), "The case did not finish today.");
  await ctx.close();
}

// Not covered here: a message arriving from another person mid-typing. The
// stand-in Supabase runs no Realtime server, so the subscription never fires
// and this harness cannot exercise it. The composer is uncontrolled and the
// only effect that writes to it is keyed on the draft body, so an incoming
// message cannot reach it — but that is an argument, not a test, and it is
// recorded as a gap rather than claimed as a pass.

await browser.close();

for (const n of notes) console.log(n);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(p);
} else {
  console.log("\nno problems found");
}
process.exit(problems.length ? 1 : 0);
