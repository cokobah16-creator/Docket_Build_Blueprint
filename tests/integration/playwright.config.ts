import { defineConfig, devices } from "@playwright/test";

// A separate config, because the root playwright.config.ts pins testDir to
// ./tests/e2e and Playwright has no CLI flag to override it. The root config is
// for the public smoke tests, which sign nobody in. This one is for the
// authenticated journeys in this folder, which need a real project.
//
//   npx playwright test --config tests/integration/playwright.config.ts
//
// Nothing here starts a server: point PLAYWRIGHT_BASE_URL at the deployment (or
// a local `next dev` you have already started) that is wired to the SAME
// Supabase project the E2E_* accounts live in. A base URL pointing at one
// project while the accounts live in another fails in ways that look like
// application bugs.

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Some sandboxes ship a Chromium of their own and forbid the download this
// version of Playwright would otherwise insist on. PW_CHROMIUM points at it.
const launchOptions = process.env.PW_CHROMIUM
  ? { executablePath: process.env.PW_CHROMIUM }
  : undefined;

export default defineConfig({
  testDir: ".",
  // Journeys cross several pages and wait on a real database; 30s is too tight.
  timeout: 90_000,
  // Sign-in state is per-worker and these tests mutate read state (opening a
  // document writes a document_reads row). Serial keeps one journey from
  // reading another's half-finished state.
  workers: 1,
  fullyParallel: false,
  // Never retry: a retried auth journey hides a flaky session, which is the
  // exact failure these tests exist to catch.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(launchOptions ? { launchOptions } : {}),
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
});
