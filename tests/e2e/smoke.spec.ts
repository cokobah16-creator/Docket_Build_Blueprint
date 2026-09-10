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
  await page.goto(`/?firm=${firmSlug}`);
  await expect(page.getByRole("link", { name: /book/i }).first()).toBeVisible();
  // the tenant layout puts the firm's name in the header link
  await expect(page.locator("header a").first()).not.toBeEmpty();
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
