import { test, expect } from "@playwright/test"

/**
 * Critical journey: Create agent → submit for review → (approved) → execute
 * → appears in revenue.
 *
 * This is the single most important journey on the platform — it's the
 * entire reason AgentDyne exists. Most of these need an authenticated
 * session; see the shared login helper. Several are marked skip with a
 * clear TODO for the specific staging fixture they need, rather than
 * faking a pass.
 */

test.describe("Agent creation wizard", () => {
  test.skip("wizard validates required fields at each step", async ({ page }) => {
    // TODO: requires login. Walk through builder/page.tsx's 3-step wizard
    // (Details → AI Config → Pricing), asserting the Next button is
    // disabled / shows an error until each step's required fields are filled.
    await page.goto("/builder")
    await page.getByRole("button", { name: /next/i }).click()
    await expect(page.getByText(/name is required/i)).toBeVisible()
  })

  test.skip("free-plan user cannot set paid pricing on step 3", async ({ page }) => {
    // TODO: regression guard for the plan-gate on monetization — a free-plan
    // user should see pricing fields disabled or gated with an upgrade
    // prompt, not a working paid-pricing form.
  })

  test.skip("submitting redirects to the editor at the correct tab", async ({ page }) => {
    // TODO: regression guard for the ?defaultTab=rag → "behavior" tab mapping
    // traced during the audit — verify a RAG-type agent lands on the
    // Behavior tab (not a blank/broken tab) after creation.
  })
})

test.describe("Agent editor", () => {
  test.skip("Knowledge Base section shows previously-saved sources on reload", async ({ page }) => {
    // ✅ Regression guard for the specific bug found and fixed: knowledgeItems
    // previously always initialized to [] regardless of what was saved,
    // making saved RAG sources look like they'd been silently lost.
    // TODO: requires an existing agent fixture with >=1 saved knowledge source.
    // await page.goto(`/builder/${agentId}?defaultTab=rag`)
    // await expect(page.getByText(savedSourceName)).toBeVisible()
  })

  test.skip("Test Playground is only usable for active agents", async ({ page }) => {
    // TODO: verify draft/rejected agents show the playground collapsed or
    // disabled with a clear reason, not a broken "test" button.
  })

  test.skip("submitting for review shows an instant upgrade prompt for free-plan users, not a fake evaluation delay", async ({ page }) => {
    // ✅ Regression guard: my-agents-client.tsx previously ran a fake
    // "Running evaluation harness (5–15s)…" loading toast before telling a
    // free user they can't publish — even though the plan check is
    // instant server-side. Assert the upgrade toast appears immediately
    // (well under the old fake delay), not after a multi-second wait.
    const start = Date.now()
    // TODO: click submit-for-review as a free-plan user
    // await expect(page.getByText(/requires Starter plan/i)).toBeVisible()
    // expect(Date.now() - start).toBeLessThan(2000)
  })
})

test.describe("Agent execution", () => {
  test.skip("running an agent in the Test Playground shows real latency, tokens, and cost", async ({ page }) => {
    // TODO: requires an active agent fixture with a stable, cheap test prompt.
  })

  test.skip("a completed execution appears in /executions and counts toward /revenue", async ({ page }) => {
    // TODO: end-to-end value-delivery check — run an agent, then verify the
    // SAME execution shows up in both the Executions list and (if it's a
    // seller's own agent) the Revenue dashboard's recent activity.
  })

  test.skip("exceeding the monthly quota shows an upgrade prompt, not a silent failure", async ({ page }) => {
    // TODO: requires a fixture account already at/near its quota. Regression
    // guard for the swarm/pipeline quota enforcement added during the audit.
  })
})
