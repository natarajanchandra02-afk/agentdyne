import { test, expect } from "@playwright/test"
import { testEmail } from "../../helpers/auth"

/**
 * Critical journey: Forgot password → reset link → new password → login.
 *
 * The "request reset" half is fully testable without email access. The
 * "click the link and set a new password" half needs the same email-reading
 * infrastructure noted in tests/helpers/auth.ts — left as TODO rather than
 * faked.
 */

test.describe("Forgot / reset password", () => {
  test("request form validates email and shows a generic confirmation", async ({ page }) => {
    await page.goto("/forgot-password")
    await page.getByRole("button", { name: /send reset link/i }).click()
    await expect(page.getByText(/valid email/i)).toBeVisible()

    await page.getByLabel(/email/i).fill(testEmail())
    await page.getByRole("button", { name: /send reset link/i }).click()

    // Should show a generic "check your email" confirmation regardless of
    // whether the address exists — a reset flow that reveals account
    // existence via a different message for known vs unknown emails is an
    // enumeration vulnerability, and this test guards against introducing one.
    await expect(page.getByText(/check your email|reset link sent/i)).toBeVisible({ timeout: 8_000 })
  })

  test.skip("clicking the reset link allows setting a new password", async ({ page }) => {
    // TODO: requires reading the sent email for the reset token/link.
    // await getLatestEmailFor(email) → extract link → page.goto(link)
    // → fill new password + confirm → submit → expect redirect to /login
  })
})

/**
 * Critical journey: Delete account.
 *
 * Regression-guards the specific bug fixed earlier: signout must fire ONLY
 * after the delete API call actually succeeds, never before — otherwise a
 * failed deletion leaves the user logged out with their account still intact
 * and no clear path forward.
 */
test.describe("Delete account", () => {
  test.skip("typing DELETE and confirming removes the account and signs out", async ({ page }) => {
    // TODO: requires a disposable, already-logged-in test account created
    // fresh for this test (not a shared staging account, since this
    // permanently deletes it). Seed via Supabase admin API in test setup.
    await page.goto("/settings")
    await page.getByRole("tab", { name: /danger/i }).click()
    await page.getByPlaceholder("DELETE").fill("DELETE")
    await page.getByRole("button", { name: /delete my account/i }).click()
    await expect(page).toHaveURL(/account_deleted=1/, { timeout: 10_000 })
  })

  test.skip("a failed deletion does NOT sign the user out", async ({ page }) => {
    // TODO: simulate a failure (e.g. mock /api/user/delete to return 500 via
    // page.route()) and assert the user is STILL on /settings, still
    // authenticated, and sees an error toast — not silently logged out.
    await page.route("**/api/user/delete", route => route.fulfill({ status: 500, body: "{}" }))
    await page.goto("/settings")
    await page.getByRole("tab", { name: /danger/i }).click()
    await page.getByPlaceholder("DELETE").fill("DELETE")
    await page.getByRole("button", { name: /delete my account/i }).click()
    await expect(page.getByText(/contact support/i)).toBeVisible({ timeout: 8_000 })
    await expect(page).toHaveURL(/\/settings/) // still here, still logged in
  })
})

/**
 * Critical journey: MFA enrollment (Settings → Security tab).
 *
 * Covers the enrollment UI built alongside the login-page challenge and
 * middleware enforcement. The QR/secret rendering and code verification
 * against a REAL TOTP secret can't be faked without implementing an actual
 * TOTP generator in the test (doable — see the TODO below — just not done
 * here to keep this scaffold's scope honest).
 */
test.describe("MFA enrollment", () => {
  test.skip("enrolling shows a QR code and a manual entry secret", async ({ page }) => {
    // TODO: requires a logged-in session (see login helper) with no existing
    // MFA factor.
    await page.goto("/settings")
    await page.getByRole("tab", { name: /security/i }).click()
    await page.getByRole("button", { name: /enable two-factor/i }).click()
    await expect(page.locator("svg").first()).toBeVisible() // QR code SVG
    await expect(page.getByText(/can't scan/i)).toBeVisible()
  })

  test.skip("entering a valid TOTP code completes enrollment", async ({ page }) => {
    // TODO: use a library like `otplib` in the test itself to generate a
    // real 6-digit code from the secret shown on screen, then verify the
    // "Two-factor authentication enabled" success state appears.
    //   import { authenticator } from "otplib"
    //   const code = authenticator.generate(secretFromPage)
  })

  test.skip("removing MFA requires an explicit confirm step", async ({ page }) => {
    // TODO: requires an account with MFA already enrolled. Verifies the
    // two-step "Remove" → "Yes, remove" confirm pattern can't be triggered
    // by a single accidental click.
  })
})
