import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config for AgentDyne's critical-path E2E suite.
 *
 * This is the "Phase 0 / launch validation" test scaffold — it automates the
 * manual critical-journey checklist (signup → verify → create agent →
 * publish → execute → upgrade → cancel, etc.) so a staged rollout has a
 * repeatable test pass instead of a one-time manual click-through.
 *
 * ⚠️  IMPORTANT — what this suite can and cannot do on its own:
 *   - It CAN exercise every UI flow against a real running instance of the app.
 *   - It CANNOT safely run against PRODUCTION Stripe, real email delivery, or
 *     a shared Supabase project without care. Point BASE_URL and the Supabase/
 *     Stripe env vars at a dedicated staging project before running billing
 *     or signup-email tests. Never run tests/billing/*.spec.ts against live
 *     Stripe keys.
 *   - Email-dependent flows (signup confirmation, password reset) need a way
 *     to read the sent email. Recommended: Supabase's local Inbucket (if using
 *     supabase start locally) or a disposable-inbox API (e.g. Mailosaur) —
 *     see tests/helpers/email.ts for the integration point, currently a stub.
 *
 * Run:
 *   npm run test:e2e          # headless, all browsers
 *   npm run test:e2e:ui       # interactive UI mode — best for writing new tests
 *   npm run test:e2e:report   # view the last HTML report
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"]]
    : [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit",   use: { ...devices["Desktop Safari"] } }, // catches Safari-specific auth/cookie quirks
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },   // mobile drawer, dvh swarm layout
  ],

  // Uncomment once you have a staging deployment or want Playwright to boot
  // the dev server itself. Left off by default so this config doesn't
  // accidentally spin up a server against production env vars.
  // webServer: {
  //   command: "npm run dev",
  //   url: BASE_URL,
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
})
