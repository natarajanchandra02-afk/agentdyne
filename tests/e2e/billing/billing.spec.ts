import { test, expect } from "@playwright/test"

/**
 * Critical journey: Billing — upgrade, downgrade, cancel, webhook handling.
 *
 * ⚠️ SAFETY: every test in this file must run against STRIPE TEST MODE keys
 * only. Point STRIPE_SECRET_KEY / STRIPE_STARTER_PRICE_ID / etc. at test-mode
 * values in whatever env this test suite runs against. Running this file
 * against live keys will create real charges.
 *
 * This is the category GPT's own review correctly flagged as needing the
 * most validation before launch — checkout, webhooks, failed payments,
 * refunds, plan resets. Almost everything here is skip+TODO because it
 * genuinely requires a live Stripe test-mode session, which can't be
 * faked without lying about what was tested.
 */

test.describe("Pricing → checkout", () => {
  test("pricing page CTA for a logged-out user leads to signup with the plan param, not straight to checkout", async ({ page }) => {
    await page.goto("/pricing")
    const starterCta = page.getByRole("link", { name: /get started with starter|start.*starter/i }).first()
    await starterCta.click()
    await expect(page).toHaveURL(/\/signup\?plan=starter/)
  })

  test.skip("logged-in free user clicking Upgrade on /billing redirects to a real Stripe Checkout session", async ({ page }) => {
    // TODO: requires a logged-in free-plan session + Stripe test-mode keys
    // configured on the target environment.
    await page.goto("/billing?upgrade=starter")
    await expect(page).toHaveURL(/checkout\.stripe\.com/, { timeout: 10_000 })
  })

  test.skip("completing Stripe test-mode checkout upgrades the account and fires the webhook", async ({ page }) => {
    // TODO: Stripe test mode provides fixed test card numbers (4242 4242 4242
    // 4242) for exactly this. After completing checkout, poll /api/user or
    // reload /billing and assert the plan badge now shows "Starter", AND
    // separately verify (via Supabase query or an admin endpoint) that the
    // webhook actually updated profiles.subscription_plan — completing
    // checkout in the browser is necessary but not sufficient; the webhook
    // firing correctly is the part most likely to silently fail.
  })

  test.skip("an unrecognized Stripe price ID does NOT silently downgrade the account to starter", async ({ page }) => {
    // ✅ Regression guard for the specific bug fixed: the webhook previously
    // defaulted an unmatched price ID to "starter" silently. Now it should
    // insert into failed_webhooks and leave the account plan untouched.
    // TODO: requires ability to fire a crafted webhook event with a bogus
    // price ID against the staging webhook endpoint (Stripe CLI's
    // `stripe trigger` with a custom fixture, or a direct signed POST).
  })
})

test.describe("Plan management", () => {
  test.skip("downgrading from Pro to Starter takes effect at period end, not immediately", async ({ page }) => {
    // TODO: verify whatever the intended proration/timing behavior is —
    // confirm it matches what pricing.tsx actually promises the customer.
  })

  test.skip("cancelling a subscription shows a clear confirmation and the correct access-until date", async ({ page }) => {
    // TODO
  })

  test.skip("a failed renewal payment surfaces a clear, actionable banner — not a silent downgrade", async ({ page }) => {
    // TODO: Stripe test mode has a specific test card for triggering
    // declined renewals. Verify the user sees a "payment failed, update
    // your card" state rather than just losing access with no explanation.
  })
})

test.describe("Pipeline step limits (plan enforcement)", () => {
  test.skip("free-plan user cannot create a pipeline at all", async ({ page }) => {
    // ✅ Regression guard for the fix applied during the audit: POST
    // /api/pipelines now rejects free-plan users with a 402 + PLAN_REQUIRED,
    // where previously there was no check at all.
  })

  test.skip("starter-plan user is blocked from saving a 6th pipeline step", async ({ page }) => {
    // ✅ Regression guard: PATCH /api/pipelines/[id] previously enforced a
    // flat 50-node cap for every plan; now it's plan-tiered (Starter = 5).
    // TODO: build a 6-node pipeline in the editor and assert the save is
    // rejected with a clear "Your starter plan allows up to 5" message.
  })
})
