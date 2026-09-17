import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Authenticated user journeys against a REAL Supabase project.
//
// STATUS: these run in CI on every push (the `journeys` job), against the staging project
// described in docs/ENVIRONMENTS.md, on fixtures scripts/seed-staging-fixtures.mjs provisions.
// Their first executions, on 17 Sep 2026, found things a read-through had not — a client who had
// never accepted a firm's terms, selectors written against markup that does not exist, and a
// portal that opens on whichever firm sorts first — so what is here has been corrected against
// the product as it runs, not as it was remembered.
//
// NOTHING HERE SKIPS. `beforeAll` refuses the whole file, naming every variable it lacks, and
// the run is red; the fixture checks further down are assertions for the same reason. A skip is
// not a pass — see tests/integration/README.md.
//
// These tests sign in as real people and read real rows. Point them at a
// project whose data you are willing to have read — never one a firm is using.
// They write only what reading writes (a document_reads row, a message the
// messaging journey posts and then leaves).
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const FIRM_SLUG = process.env.E2E_FIRM_SLUG ?? "";

// Client account: a person a firm acts for, with at least one matter.
const CLIENT_PHONE = process.env.E2E_CLIENT_PHONE ?? "";
const CLIENT_OTP = process.env.E2E_CLIENT_OTP ?? "";

// Staff account: a firm_members row, with TOTP already enrolled.
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? "";
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? "";
const STAFF_TOTP_SECRET = process.env.E2E_STAFF_TOTP_SECRET ?? "";

// The second firm that also acts for the client, for the switching journey.
const SECOND_FIRM_NAME = process.env.E2E_SECOND_FIRM_NAME ?? "";

// A matter id belonging to a firm that does NOT act for the client account.
// The denial journey asserts this stays unreachable. Getting this wrong — a
// matter the client legitimately holds — turns the most important test in the
// file into one that passes while proving the opposite.
const FORBIDDEN_MATTER_ID = process.env.E2E_FORBIDDEN_MATTER_ID ?? "";

// NOTHING HERE SKIPS. Every test below used to guard itself with test.skip() when its own
// configuration was absent, and this folder's README said the true thing about that: "a skip is
// not a pass". But a skipped test and a passed test are the same colour on a pull request, so a
// missing secret produced a green run that had verified nothing — the precise defect the e2e gate
// had, one level down, and the reason nothing above the database was ever really checked. Now the
// whole file refuses to run, once, naming everything it lacks, and the run is red. The three checks
// on the FIXTURES further down (a thread, a matter, a document) are assertions for the same reason:
// a fixture that has quietly gone missing must not read as a pass either.
const REQUIRED: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  E2E_FIRM_SLUG: FIRM_SLUG,
  E2E_CLIENT_PHONE: CLIENT_PHONE,
  E2E_CLIENT_OTP: CLIENT_OTP,
  E2E_STAFF_EMAIL: STAFF_EMAIL,
  E2E_STAFF_PASSWORD: STAFF_PASSWORD,
  E2E_STAFF_TOTP_SECRET: STAFF_TOTP_SECRET,
  E2E_SECOND_FIRM_NAME: SECOND_FIRM_NAME,
  E2E_FORBIDDEN_MATTER_ID: FORBIDDEN_MATTER_ID,
};
test.beforeAll(() => {
  const absent = Object.keys(REQUIRED).filter((k) => !REQUIRED[k]);
  if (absent.length > 0) {
    throw new Error(`refusing to run: set ${absent.join(", ")} — see tests/integration/README.md`);
  }
});

// ---------------------------------------------------------------------------
// TOTP, RFC 6238, so staff MFA can be completed without a phone in the room.
// Implemented here rather than pulled in, so this file adds no dependency.
// ---------------------------------------------------------------------------

function base32Decode(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`E2E_STAFF_TOTP_SECRET is not base32: bad char ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

// A code is valid for a 30s step. If we are near the boundary, wait for the
// next step rather than submit one that expires in transit.
async function freshTotp(secret: string): Promise<string> {
  const msIntoStep = Date.now() % 30_000;
  if (msIntoStep > 27_000) await new Promise((r) => setTimeout(r, 30_000 - msIntoStep + 500));
  return totp(secret);
}

// ---------------------------------------------------------------------------
// Sign-in helpers
// ---------------------------------------------------------------------------

async function signInClient(page: Page) {
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  await page.getByRole("tab", { name: "Phone" }).click();
  await page.getByLabel(/phone/i).fill(CLIENT_PHONE);
  await page.getByRole("button", { name: /send|continue|code/i }).first().click();

  // The verify stage only appears once GoTrue has accepted the number.
  const codeField = page.getByLabel(/code/i);
  await expect(codeField).toBeVisible({ timeout: 30_000 });
  await codeField.fill(CLIENT_OTP);
  await page.getByRole("button", { name: /verify|sign in|continue/i }).first().click();

  await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/app\/login/);
}

async function signInStaff(page: Page) {
  await page.goto("/firm/login");
  await expect(page.getByRole("heading", { name: /staff console/i })).toBeVisible();

  await page.getByLabel("Email").fill(STAFF_EMAIL);
  await page.getByLabel("Password").fill(STAFF_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  // signInWithPassword lands an aal1 session. The console layout refuses it
  // (`if (aal?.currentLevel !== "aal2") redirect("/firm/security/mfa")`) and
  // sends the browser to the challenge; the database refuses staff writes below
  // aal2 regardless of what the UI does.
  //
  // Wait for the challenge FIELD, not for a URL: /\/firm/ also matches the
  // /firm/login page we are standing on, so it resolves on the first poll and
  // waits for nothing — and `isVisible()` does not wait either. Together they
  // would step past the MFA form before it had a chance to render, every time.
  const challenge = page.getByLabel(/code|authentication/i);
  await challenge.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {
    /* already aal2 from a previous factor verification — checked below */
  });
  if (await challenge.isVisible().catch(() => false)) {
    await challenge.fill(await freshTotp(STAFF_TOTP_SECRET));
    await page.getByRole("button", { name: /verify|continue|submit/i }).first().click();
  }

  // aal2 reached: the console renders rather than bouncing to the challenge, and
  // we are no longer sitting on the sign-in form with an error.
  await expect(page).not.toHaveURL(/\/firm\/login/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/firm\/security\/mfa/, { timeout: 30_000 });
}

/**
 * The access token the browser client has stored, so we can ask PostgREST directly.
 *
 * It is in a COOKIE, not localStorage. `src/lib/supabase/browser.ts` builds its
 * client with `createBrowserClient` from `@supabase/ssr`, whose storage adapter
 * is `document.cookie` — the session lands in `sb-<ref>-auth-token`, split into
 * `.0`, `.1`, … when it is longer than a cookie may be, and prefixed `base64-`.
 * Nothing is ever written to localStorage, so looking there finds an empty
 * string and every assertion built on this helper fails before it starts.
 * localStorage is still tried second, for a client built the plain
 * supabase-js way.
 */
async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const sessionFrom = (raw: string): string => {
      let text = raw;
      if (text.startsWith("base64-")) {
        const b64 = text.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/");
        const bytes = Uint8Array.from(
          atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")),
          (ch) => ch.charCodeAt(0),
        );
        text = new TextDecoder().decode(bytes);
      }
      try {
        const parsed = JSON.parse(text);
        return typeof parsed?.access_token === "string" ? parsed.access_token : "";
      } catch {
        return "";
      }
    };

    // The cookie the SSR client writes, reassembled from its chunks in order.
    const chunks = new Map<string, string[]>();
    for (const pair of document.cookie.split("; ")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const parts = /^(sb-.*-auth-token)(?:\.(\d+))?$/.exec(name);
      if (!parts) continue;
      const list = chunks.get(parts[1]) ?? [];
      list[parts[2] === undefined ? 0 : Number(parts[2])] = value;
      chunks.set(parts[1], list);
    }
    for (const list of chunks.values()) {
      const found = sessionFrom(list.join(""));
      if (found) return found;
    }

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)!;
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const found = sessionFrom(raw);
      if (found) return found;
    }
    return "";
  });
  expect(
    token,
    "no Supabase session in the sb-*-auth-token cookie or localStorage — sign-in did not persist",
  ).not.toBe("");
  return token;
}

/**
 * Pin the portal to the fixture firm before reading anything firm-scoped.
 *
 * /app paints itself as ONE firm and narrows every read to it (src/lib/portal-firm.ts). With no
 * choice made, it opens on the client's first firm — and for a client with one matter at each
 * of two firms that is a tie, decided by row order, so half the runs opened on the second firm,
 * which holds neither the message nor the document the journeys below read. Measured on 17 Sep
 * 2026: three failures with one cause.
 *
 * The cookie is the same view preference selectFirm sets after a tap in the switcher, and it
 * confers nothing: selectedFirm() re-validates it against the client's own firms on every read,
 * and RLS decides what any query returns regardless. It accepts the slug, so no id is needed.
 */
async function viewFirm(page: Page, slug: string) {
  const { hostname } = new URL(page.url());
  await page.context().addCookies([{ name: "dk_firm", value: slug, domain: hostname, path: "/app", sameSite: "Lax" }]);
}

// ---------------------------------------------------------------------------
// 1. Client sign-in
// ---------------------------------------------------------------------------

test("client signs in with a phone OTP and reaches the portal", async ({ page }) => {

  await signInClient(page);

  // A session that exists is not the same as a session the database honours.
  // Ask PostgREST as this user: firm_members is a table a client holds no row
  // in, so the useful assertion is that the request is ACCEPTED (a real JWT)
  // and returns the client's own firms.
  const token = await accessToken(page);
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/firm_public?select=slug&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  expect(res.status(), "PostgREST rejected the signed-in client's token").toBe(200);
});

// ---------------------------------------------------------------------------
// 2. Staff sign-in with MFA
// ---------------------------------------------------------------------------

test("staff signs in with password and TOTP and reaches the console at aal2", async ({ page }) => {

  await signInStaff(page);

  // The claim under test is aal2, not "a page rendered". Read it from the JWT
  // the browser holds: the console layout and every staff-write policy key off
  // exactly this claim.
  const token = await accessToken(page);
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  expect(claims.aal, "staff session is not aal2 — MFA did not complete").toBe("aal2");
});

// ---------------------------------------------------------------------------
// 3. Navigation
// ---------------------------------------------------------------------------

test("a signed-in client can reach every primary portal destination", async ({ page }) => {

  await signInClient(page);

  for (const path of [
    "/app/matters",
    "/app/messages",
    "/app/appointments",
    "/app/payments",
    "/app/court-dates",
    "/app/notifications",
    "/app/profile",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} did not render for a signed-in client`).toBeLessThan(400);
    // Bounced back to sign-in is the failure this loop exists to catch.
    await expect(page, `${path} bounced to sign-in`).not.toHaveURL(/\/app\/login/);
  }
});

// ---------------------------------------------------------------------------
// 4. Messaging
// ---------------------------------------------------------------------------

test("a client reads a thread and posts a message that persists", async ({ page }) => {

  await signInClient(page);
  await viewFirm(page, FIRM_SLUG);
  await page.goto("/app/messages");

  // A matter's thread lives on the matter (`/app/matters/<id>?tab=messages`,
  // src/lib/portal-threads.ts); only a consultation's lives under /app/messages/.
  const thread = page.locator("a[href*='tab=messages'], a[href^='/app/messages/']").first();
  await expect(thread, "the client account has no message thread: the fixture is broken, and a skip here would read as a pass").toBeVisible();
  await thread.click();

  const body = `e2e ${new Date().toISOString()}`;
  const composer = page.getByRole("textbox").last();
  await composer.fill(body);
  await page.getByRole("button", { name: /send/i }).first().click();

  // Present after a reload, so this is the database's copy and not optimistic
  // UI that never reached a row.
  await expect(page.getByText(body)).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByText(body)).toBeVisible({ timeout: 30_000 });
});

// ---------------------------------------------------------------------------
// 5. Document access
// ---------------------------------------------------------------------------

test("a client opens a document on their own matter", async ({ page }) => {

  await signInClient(page);
  await viewFirm(page, FIRM_SLUG);
  await page.goto("/app/matters");

  const matter = page.locator("a[href^='/app/matters/']").first();
  await expect(matter, "the client account holds no matter: the fixture is broken, and a skip here would read as a pass").toBeVisible();
  const href = await matter.getAttribute("href");
  // The matter opens on its timeline; the files are a tab of their own.
  await page.goto(`${href!.split("?")[0]}?tab=documents`);

  // Each file with bytes behind it offers one button: "Preview" for a PDF or image, "Download"
  // for anything else (src/components/portal/documents-tab.tsx).
  const doc = page.getByRole("button", { name: /^(preview|download)$/i }).first();
  await expect(doc, "no document on the client's matter: the fixture is broken, and a skip here would read as a pass").toBeVisible();

  // Opening is two calls in order: open_document_version() writes the document_reads row, and
  // only then does storage mint a signed URL — the storage policy checks for that row (migration
  // 30). So a signed URL coming back is the whole chain working, and fetching it is the bytes.
  const [signed] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/storage/v1/object/sign/"), { timeout: 30_000 }),
    doc.click(),
  ]);
  expect(signed.status(), "storage refused to sign a URL for the client's own document").toBeLessThan(400);

  const open = page.getByRole("link", { name: /open in a new tab/i });
  await expect(open).toBeVisible({ timeout: 30_000 });
  const url = await open.getAttribute("href");
  expect(url, "the preview rendered without a URL").toBeTruthy();
  const bytes = await page.request.get(url!);
  expect(bytes.status(), "the signed URL did not return the document").toBe(200);
});

// ---------------------------------------------------------------------------
// 6. Firm switching
// ---------------------------------------------------------------------------

test("a client acting through two firms switches between them", async ({ page }) => {

  await signInClient(page);
  // Start on the first firm, so that what follows is a real switch and not a
  // tap on the firm already showing.
  await viewFirm(page, FIRM_SLUG);
  await page.goto("/app");

  // The firm's name under the welcome is the switcher's trigger — a button only
  // when there is more than one firm to choose from, which is itself the claim.
  const trigger = page.getByRole("button", { name: /switch firm/i });
  await expect(trigger, "the switcher is not offered, so the portal does not see two firms acting for this client").toBeVisible();
  await expect(trigger).not.toContainText(SECOND_FIRM_NAME);
  await trigger.click();

  const target = page.getByRole("dialog", { name: /your firms/i }).getByRole("button", { name: new RegExp(SECOND_FIRM_NAME, "i") });
  await expect(target, `${SECOND_FIRM_NAME} is not among this client's firms`).toBeVisible();
  await target.click();

  // selectFirm re-checks the firm against this client server-side before it
  // sets anything; the whole app repaints to that firm. The reload is the
  // proof: the sheet is closed then, so the name can only come from the
  // repainted home.
  await expect(page.getByRole("button", { name: /switch firm/i })).toContainText(SECOND_FIRM_NAME, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: /switch firm/i })).toContainText(SECOND_FIRM_NAME);
});

// ---------------------------------------------------------------------------
// 7. Denial of access to another firm's restricted records
//
// The most important test here, and the one most easily faked. A UI that hides
// a row proves nothing about who may READ it — so this asserts at the database,
// through PostgREST, with the client's own token. RLS is the thing under test.
// ---------------------------------------------------------------------------

test("a client cannot read another firm's matter, at the UI or the API", async ({ page, browser }) => {

  await signInClient(page);
  const token = await accessToken(page);
  const asClient = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };

  // -------------------------------------------------------------------------
  // POSITIVE CONTROLS. Everything below this point passes by reading ZERO rows,
  // and there are three uninteresting ways to read zero rows: a malformed
  // request, a token that is not being sent or has expired, and an id that
  // names nothing at all. Each would let the most important test in this file
  // report a pass having proved nothing. The README warns about the third in
  // prose; these are the checks that stop all three.
  // -------------------------------------------------------------------------

  // (i) The request shape works and the session is live: the same call, against
  // the same table, with the same headers, returns the client's OWN matters.
  const mine = await page.request.get(
    `${SUPABASE_URL}/rest/v1/matters?select=id`,
    { headers: asClient },
  );
  expect(mine.status(), "the client could not read their own matters — the token or the request is wrong, so a zero below would mean nothing").toBe(200);
  const myIds = ((await mine.json()) as Array<{ id: string }>).map((m) => m.id);
  expect(
    myIds.length,
    "this client holds no matters at all, so 'cannot read another firm's matter' is not a claim this account can test",
  ).toBeGreaterThan(0);

  // (ii) The id under test is not one of theirs. Getting this wrong is the
  // misconfiguration the README warns about, and it inverts the test.
  expect(
    myIds,
    "E2E_FORBIDDEN_MATTER_ID is a matter this client legitimately holds — the test would assert the opposite of what it claims",
  ).not.toContain(FORBIDDEN_MATTER_ID);

  // (iii) The id names a real row. A typo, or a matter deleted since it was
  // chosen, behaves EXACTLY like a wall: zero rows, "not found" in the UI, green
  // all the way. Somebody who can legitimately see it has to say it is there.
  // The staff account is the only other identity these tests hold.
  // Runs unconditionally: beforeAll has already refused the whole file if the staff account is
  // absent, so there is no configuration under which this control can be quietly skipped.
  const staffContext = await browser.newContext();
  try {
    const staffPage = await staffContext.newPage();
    await signInStaff(staffPage);
    const staffToken = await accessToken(staffPage);
    const seen = await staffPage.request.get(
      `${SUPABASE_URL}/rest/v1/matters?select=id&id=eq.${FORBIDDEN_MATTER_ID}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${staffToken}` } },
    );
    const rows = seen.status() === 200 ? ((await seen.json()) as unknown[]) : [];
    expect(
      rows.length,
      "the staff account cannot see E2E_FORBIDDEN_MATTER_ID either, so nothing here can tell a wall apart from a matter that does not exist. " +
        "Point it at a matter at the STAFF member's own firm that this client is not a party to: the staff token then proves the row is real, " +
        "and the client's zero proves the wall. That is also the stronger test — cross-firm isolation is already asserted 66 times in " +
        "supabase/tests/10_rls_isolation.sql, whereas the within-firm party wall is only ever exercised here.",
    ).toBe(1);
  } finally {
    await staffContext.close();
  }

  // (a) The database. Zero rows is the pass; a row is a confidentiality breach.
  const res = await page.request.get(
    `${SUPABASE_URL}/rest/v1/matters?select=id,title,reference&id=eq.${FORBIDDEN_MATTER_ID}`,
    { headers: asClient },
  );
  expect([200, 401, 403]).toContain(res.status());
  if (res.status() === 200) {
    expect(await res.json(), "RLS let a client read another firm's matter").toEqual([]);
  }

  // (b) Related content, reached by the same foreign key. A policy can be right
  // on matters and wrong on what hangs off them.
  for (const table of ["messages", "documents", "updates", "invoices"]) {
    const r = await page.request.get(
      `${SUPABASE_URL}/rest/v1/${table}?select=id&matter_id=eq.${FORBIDDEN_MATTER_ID}`,
      { headers: asClient },
    );
    if (r.status() === 200) {
      expect(await r.json(), `RLS let a client read another firm's ${table}`).toEqual([]);
    } else {
      // Anything else — 404 on a renamed table, 400 on a dropped column — means
      // this row was never asked for. Silently continuing would let the most
      // important test in the file report a pass having checked nothing, so it
      // is held to the same statuses as the matters check above.
      expect(
        [401, 403],
        `${table} answered ${r.status()} — this check asked nothing and proved nothing`,
      ).toContain(r.status());
    }
  }

  // (c) The UI, navigated to directly rather than clicked to.
  await page.goto(`/app/matters/${FORBIDDEN_MATTER_ID}`);
  await expect(page.getByText(/not found|no longer|don't have access|not available/i).first())
    .toBeVisible({ timeout: 30_000 });
});
