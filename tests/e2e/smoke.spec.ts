import { expect, test } from "@playwright/test";

// Smoke: the platform landing, a tenant's public home (any firm — set E2E_FIRM_SLUG) and the
// sign-in surfaces render. These read PUBLIC pages only; they sign nobody in and write nothing.
// The authenticated journeys are tests/integration/, which needs real accounts.
//
// NOTHING HERE SKIPS. It used to: a `configured` boolean gated one whole test with test.skip() and
// wrapped the sharpest assertions of two others in `if (configured)`, so running without Supabase
// configured produced a green run in which three of the four tests had checked almost nothing —
// and the CI job was itself gated off without secrets, which made the green doubly hollow. A skip
// is not a pass, and an assertion inside an `if` that is false is not an assertion. So the
// configuration is now a REQUIREMENT, checked once and loudly: point these at a project, or do not
// run them and do not report a result.
//
// Point them at STAGING, never at a project a firm is using (docs/ENVIRONMENTS.md).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const firmSlug = process.env.E2E_FIRM_SLUG ?? "";

test.beforeAll(() => {
  const missing = Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    E2E_FIRM_SLUG: firmSlug,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `these tests need a Supabase project and a firm in it. Unset: ${missing.join(", ")}.\n` +
        "They FAIL rather than skip on purpose — see docs/ENVIRONMENTS.md for which project to use.",
    );
  }
});

test("platform landing responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("h1").first()).toBeVisible();
});

test("tenant public home renders with the firm's branding", async ({ page }) => {
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

test("firm registration is reachable from the landing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /register your firm/i }).click();
  await expect(page).toHaveURL(/\/firm\/start/);
  await expect(page.getByRole("heading", { name: /register your firm/i })).toBeVisible();
});

test("client login renders both sign-in methods", async ({ page }) => {
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Phone" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Email" })).toBeVisible();
});
