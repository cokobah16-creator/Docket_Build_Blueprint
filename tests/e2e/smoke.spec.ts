import { expect, test } from "@playwright/test";

// Slice 0 smoke: the Klinique public home renders with tenant branding and
// the client login is reachable. Requires Supabase env vars (tenant data
// comes from firm_public); without them only the platform landing renders.

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

test("platform landing responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator("h1").first()).toBeVisible();
});

test("klinique public home renders", async ({ page }) => {
  test.skip(!configured, "NEXT_PUBLIC_SUPABASE_URL not set");
  await page.goto("/?firm=attorneys-klinique");
  await expect(page.getByRole("link", { name: /book a consultation/i }).first()).toBeVisible();
  await expect(page.getByText("Attorneys Klinique").first()).toBeVisible();
});

test("client login renders both sign-in methods", async ({ page }) => {
  await page.goto("/app/login");
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  if (configured) {
    await expect(page.getByRole("tab", { name: "Phone" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Email" })).toBeVisible();
  }
});
