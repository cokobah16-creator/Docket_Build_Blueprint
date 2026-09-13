import { defineConfig, devices } from "@playwright/test";

// Smoke tests: point PLAYWRIGHT_BASE_URL at a deployment, or let the config
// start `next dev` locally.

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Some sandboxes ship a Chromium of their own and forbid the download this
// version of Playwright would otherwise insist on. PW_CHROMIUM points at it.
// Unset — on a developer's machine and in CI — nothing here changes.
const launchOptions = process.env.PW_CHROMIUM
  ? { executablePath: process.env.PW_CHROMIUM }
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    ...(launchOptions ? { launchOptions } : {}),
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
