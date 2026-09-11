import { expect, test } from "@playwright/test";

// Smoke: the platform landing, a tenant's public home (any firm — set
// E2E_FIRM_SLUG; defaults to tenant #1) and the sign-in surfaces render.
// Tenant data comes from firm_public, so the tenant test needs Supabase env.

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const firmSlug = process.env.E2E_FIRM_SLUG ?? "attorneys-klinique";

test("platform landing responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("h1").first()).toBeVisible();
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

test("firm registration is reachable from the landing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /register your firm/i }).click();
  await expect(page).toHaveURL(/\/firm\/start/);
  if (configured) {
    await expect(page.getByRole("heading", { name: /register your firm/i })).toBeVisible();
  }
});

test("client login renders both sign-in methods", async ({ page }) => {
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  if (configured) {
    await expect(page.getByRole("tab", { name: "Phone" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Email" })).toBeVisible();
  }
});
