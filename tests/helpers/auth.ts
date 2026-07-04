/**
 * Shared test helpers for the AgentDyne E2E suite.
 *
 * These are intentionally thin wrappers, not a heavy page-object framework —
 * the goal is that someone reading a .spec.ts file can follow the flow
 * without jumping through five layers of abstraction.
 */

import type { Page } from "@playwright/test"

/** Generates a unique, obviously-a-test-account email so these never collide
 *  with real users and are easy to identify/clean up in Supabase later. */
export function testEmail(prefix = "e2e"): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return `${prefix}+${id}@agentdyne-e2e.test`
}

export const TEST_PASSWORD = "E2E-Test-Password-9182!"

/** Fills and submits the login form. Does NOT wait for the MFA challenge
 *  screen — call expectMfaChallenge() separately if the test account has
 *  2FA enabled. */
export async function login(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()
}

/** Fills and submits the signup form. planKey is optional — pass "starter"
 *  or "pro" to test the ?plan= upgrade-redirect path. */
export async function signup(page: Page, opts: {
  name: string; email: string; password: string; planKey?: "starter" | "pro"
}) {
  const url = opts.planKey ? `/signup?plan=${opts.planKey}` : "/signup"
  await page.goto(url)
  await page.getByLabel(/full name/i).fill(opts.name)
  await page.getByLabel(/email/i).fill(opts.email)
  await page.getByLabel("Password", { exact: true }).fill(opts.password)
  await page.getByLabel(/confirm password/i).fill(opts.password)
  await page.getByRole("button", { name: /create account/i }).click()
}

/**
 * Stub — email-dependent flows (signup confirmation, password reset) need a
 * way to read the email that was actually sent. Wire this up to whichever
 * inbox strategy the staging environment uses:
 *
 *   - Supabase local dev: Inbucket at http://localhost:54324, fetch via its API
 *   - Mailosaur / Mailtrap: fetch via their REST API using the test inbox ID
 *   - A custom /api/debug/last-email endpoint gated to staging only
 *
 * Throwing here on purpose — a test that silently no-ops on missing email
 * infrastructure is worse than one that fails loudly and tells you why.
 */
export async function getLatestEmailFor(_address: string): Promise<{ subject: string; html: string }> {
  throw new Error(
    "getLatestEmailFor() is not wired up yet. See tests/helpers/email.ts header comment " +
    "for options (Inbucket, Mailosaur, etc.) before running email-dependent specs."
  )
}

/** Waits for and returns the 6-digit MFA code input, asserting the challenge
 *  screen actually rendered (as opposed to silently skipping past it, which
 *  would be a false-positive pass on the exact security check this test cares about). */
export async function expectMfaChallenge(page: Page) {
  const heading = page.getByText(/two-factor authentication/i)
  await heading.waitFor({ state: "visible", timeout: 5_000 })
  return page.getByPlaceholder("000000")
}
