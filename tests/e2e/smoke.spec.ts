import { expect, test, type BrowserContext } from "@playwright/test";
import { CONSENT_COOKIE, consentValue } from "../../src/lib/consent-cookie";

// Smoke: the platform landing, a tenant's public home (any firm — set
// E2E_FIRM_SLUG; defaults to tenant #1) and the sign-in surfaces render,
// and no analytics cookie is set before a visitor allows it.
// Tenant data comes from firm_public, so the tenant test needs Supabase env.

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const firmSlug = process.env.E2E_FIRM_SLUG ?? "attorneys-klinique";

/** The analytics visitor id middleware.ts mints (VISITOR_COOKIE in src/lib/observability). */
const VISITOR_COOKIE = "docket_did";

// The cookie banner (src/components/ui/cookie-banner.tsx) shows on a first visit
// whenever the server under test has POSTHOG_KEY set, and it sits over the foot
// of the screen. The tests that tap controls store "Only necessary" first, so
// the banner is never in the way of what they tap.
async function storeNecessaryOnly(context: BrowserContext, baseURL: string | undefined) {
  if (!baseURL) return;
  await context.addCookies([{ name: CONSENT_COOKIE, value: consentValue(false), url: baseURL }]);
}

test("platform landing responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("h1").first()).toBeVisible();
});

test("no analytics cookie without consent", async ({ page, request }) => {
  // A first visit stores no choice, so it must not be given a visitor id —
  // with or without POSTHOG_KEY. context.cookies() rather than document.cookie,
  // which cannot see an httpOnly cookie such as this one.
  await page.goto("/");
  const names = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(names).not.toContain(VISITOR_COOKIE);

  // A browser still holding an id from before, with no consent stored, gets it
  // expired on the response.
  const response = await request.get("/", {
    headers: { cookie: `${VISITOR_COOKIE}=00000000-0000-4000-8000-000000000000` },
  });
  expect(response.ok()).toBeTruthy();
  const expired = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .filter((value) => value.startsWith(`${VISITOR_COOKIE}=;`));
  expect(expired).toHaveLength(1);
  expect(expired[0]).toMatch(/expires=thu, 01 jan 1970/i);
});

test("tenant public home renders with the firm's branding", async ({ page }) => {
  test.skip(!configured, "NEXT_PUBLIC_SUPABASE_URL not set");
  // ?firm= only resolves a tenant OFF production (src/lib/tenant.ts). Against a production-mode
  // target this lands on the Docket landing page — and that page has a footer link matching
  // /book/i and a non-empty first header anchor, so the old assertions passed there, green,
  // having checked nothing about any firm. Every assertion below is one the landing page cannot
  // satisfy: the CTA must point INTO this firm, and the brand tokens must be set inline, which
  // only the tenant layout does (brandStyle() in src/lib/brand.ts).
  await page.goto(`/?firm=${firmSlug}`);
  const cta = page.locator(`a[href="/${firmSlug}/book"]`).first();
  await expect(cta).toBeVisible();
  await expect(page.locator('[style*="--dk-primary"]').first()).toBeAttached();
  await expect(page.locator("header a").first()).not.toHaveText(/sign in/i);
});

test("firm registration is reachable from the landing", async ({ page, baseURL }) => {
  await storeNecessaryOnly(page.context(), baseURL);
  await page.goto("/");

  // The landing repeats this call to action on purpose — the header, the hero,
  // the "for firms" card, the closing panel and the footer each carry one. So
  // the test's job is not to pick one of them and hope: it is to hold the
  // invariant that makes repeating them safe, which is that every one of them
  // leads to firm registration. A CTA that drifts to some other href is the
  // bug actually worth catching here, and it is exactly the bug .first() would
  // sail past. The count is deliberately not pinned — adding or removing a CTA
  // is a design decision, pointing one somewhere else is a regression.
  const registerLinks = page.getByRole("link", { name: /register your firm/i });
  await expect(registerLinks).not.toHaveCount(0);
  const hrefs = await registerLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  expect([...new Set(hrefs)]).toEqual(["/firm/start"]);

  // Then navigate through one named, scoped instance rather than an arbitrary
  // one: the primary CTA in the page banner. It is the topmost of the five and
  // the first thing a firm sees, and on the phone viewport this suite runs at
  // (Pixel 7, the only project in playwright.config.ts) it renders inside the
  // header's wrapped row — so this also holds the header CTA to surviving the
  // responsive header wrap.
  const headerCta = page
    .getByRole("banner")
    .getByRole("link", { name: /register your firm/i });
  await expect(headerCta).toBeVisible();
  await headerCta.click();

  // Longer than the 5s default expect timeout, and well inside the 30s test
  // timeout: a dev server that is compiling a route, or busy, can take several
  // seconds to serve /firm/start, and that is a slow machine rather than a
  // broken link. A CTA that genuinely goes nowhere still fails here.
  await expect(page).toHaveURL(/\/firm\/start/, { timeout: 15_000 });
  if (configured) {
    await expect(page.getByRole("heading", { name: /register your firm/i })).toBeVisible();
  }
});

test("client login renders both sign-in methods", async ({ page, baseURL }) => {
  await storeNecessaryOnly(page.context(), baseURL);
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  if (configured) {
    await expect(page.getByRole("tab", { name: "Phone" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Email" })).toBeVisible();

    // The production provider sends a magic link, not a numeric email OTP. Stub the provider call
    // so this smoke test proves the post-send contract without delivering a real message.
    await page.route("**/auth/v1/otp*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.getByRole("tab", { name: "Email" }).click();
    await page.getByLabel("Email address").fill("client@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    await expect(page.getByText(/we sent a sign-in link to client@example\.com/i)).toBeVisible();
    await expect(page.getByLabel(/code from the email/i)).toHaveCount(0);
  }
});
