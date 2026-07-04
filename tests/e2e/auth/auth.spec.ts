import { test, expect } from "@playwright/test"
import { testEmail, TEST_PASSWORD, signup, login } from "../../helpers/auth"

/**
 * Critical journey: Sign up → land on dashboard (or email-verify screen).
 *
 * ⚠️ This spec does NOT click the confirmation link — that requires reading
 * a real sent email (see tests/helpers/auth.ts → getLatestEmailFor). What it
 * DOES verify: the form itself, validation, and that the "check your email"
 * screen appears with the CORRECT copy — specifically regression-testing the
 * false "14-day free trial" claim that was found and removed from this page.
 */

test.describe("Signup", () => {
  test("shows validation errors for weak input", async ({ page }) => {
    await page.goto("/signup")
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(/name must be at least/i)).toBeVisible()
    await expect(page.getByText(/enter a valid email/i)).toBeVisible()
  })

  test("rejects mismatched passwords", async ({ page }) => {
    await page.goto("/signup")
    await page.getByLabel(/full name/i).fill("Test User")
    await page.getByLabel(/email/i).fill(testEmail())
    await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel(/confirm password/i).fill("SomethingDifferent!")
    await page.getByRole("button", { name: /create account/i }).click()
    await expect(page.getByText(/passwords do not match/i)).toBeVisible()
  })

  test("successful signup shows the check-your-email screen with accurate copy", async ({ page }) => {
    const email = testEmail()
    await signup(page, { name: "E2E Test User", email, password: TEST_PASSWORD })

    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 })

    // ✅ Regression guard: this exact claim was found on this screen and
    // removed for being false (Stripe checkout never sets trial_period_days).
    // If this text ever comes back, this assertion fails the build.
    await expect(page.getByText(/14-day free trial/i)).not.toBeVisible()
    await expect(page.getByText(/start your.*trial/i)).not.toBeVisible()
  })

  test("plan param produces an accurate (non-trial) upgrade message", async ({ page }) => {
    const email = testEmail()
    await signup(page, { name: "E2E Test User", email, password: TEST_PASSWORD, planKey: "starter" })

    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/upgrading to Starter/i)).toBeVisible()
    await expect(page.getByText(/trial/i)).not.toBeVisible()
  })
})

/**
 * Critical journey: Log in with valid / invalid credentials.
 *
 * Requires a CONFIRMED test account to exist already — either seed one via
 * Supabase admin API in a beforeAll/global-setup step, or point this at a
 * staging account created once and reused. Left as TODO rather than faked,
 * since a login test that can't actually log in isn't testing anything real.
 */
test.describe("Login", () => {
  test("shows an error for invalid credentials", async ({ page }) => {
    await login(page, testEmail(), "wrong-password-entirely")
    await expect(page.getByText(/wrong email or password/i)).toBeVisible({ timeout: 8_000 })
  })

  test.skip("valid credentials redirect to the dashboard", async ({ page }) => {
    // TODO: wire up TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD from env once
    // a confirmed staging account exists. Unskip then.
    await login(page, process.env.TEST_ACCOUNT_EMAIL!, process.env.TEST_ACCOUNT_PASSWORD!)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
  })

  test.skip("account with MFA enabled shows the challenge screen, not the dashboard", async ({ page }) => {
    // TODO: requires a staging account that has already completed MFA
    // enrollment (see tests/e2e/auth/mfa.spec.ts for the enrollment flow).
    // This test's entire point is verifying the challenge can't be skipped —
    // do not "fix" a failure here by removing the assertion.
    await login(page, process.env.TEST_MFA_ACCOUNT_EMAIL!, process.env.TEST_MFA_ACCOUNT_PASSWORD!)
    await expect(page.getByText(/two-factor authentication/i)).toBeVisible({ timeout: 8_000 })
    await expect(page).not.toHaveURL(/\/dashboard/)
  })
})

/**
 * Critical journey: middleware-level MFA enforcement.
 *
 * This is the security-critical test in this file — it verifies AAL2 is
 * enforced SERVER-SIDE, not just as a client-side UI step someone could
 * bypass by navigating directly. Requires a staging account with a verified
 * TOTP factor.
 */
test.describe("MFA server-side enforcement", () => {
  test.skip("navigating directly to a protected route bounces an unverified AAL1 session back to /login", async ({ page, context }) => {
    // TODO: sign in via API (bypassing the UI) to land at AAL1 without
    // completing the challenge, then try to hit a protected route directly.
    // Expected: redirected to /login?mfa=required, never reaches /dashboard.
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/login\?.*mfa=required/, { timeout: 8_000 })
  })
})
