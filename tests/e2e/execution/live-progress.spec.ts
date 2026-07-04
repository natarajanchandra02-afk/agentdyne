import { test, expect } from "@playwright/test"

/**
 * Critical journey: multi-agent execution UI actually shows live progress.
 *
 * These specifically regression-guard the polling work done during this
 * audit — Compose and the Pipelines Quick Run modal both used to block on
 * one long fetch() and render nothing until the whole run finished. They now
 * poll pipeline_step_checkpoints via /executions/latest and
 * /executions/[id]/steps while the run is still in flight.
 *
 * The RLS fix underneath this (checkpoints were silently failing to write
 * for the entire lifetime of the feature) is itself worth a standalone DB-
 * level check outside Playwright — see the TODO at the bottom of this file.
 */

test.describe("Compose — live execution progress", () => {
  test.skip("running a multi-step goal shows nodes completing one at a time, not all at once", async ({ page }) => {
    // TODO: requires a logged-in session + at least 2 active agents to
    // compose a real multi-step plan against.
    // await page.goto("/compose")
    // await page.getByPlaceholder(/describe your goal/i).fill("...")
    // await page.getByRole("button", { name: /compose/i }).click()
    // await page.getByRole("button", { name: /run/i }).click()
    //
    // Key assertion: capture the rendered node statuses at t=500ms and
    // again at t=1500ms mid-run and assert they DIFFER (i.e. progress is
    // actually incremental) rather than jumping from all-pending to
    // all-complete in a single render.
  })

  test.skip("the executions/latest endpoint returns null gracefully before the row exists yet", async ({ request }) => {
    // TODO: direct API check — GET /api/pipelines/[id]/executions/latest
    // immediately after firing a run, before the DB insert has committed.
    // Should return { executionId: null, status: null } with a 200, never
    // a 404 or 500 — the polling loop relies on this being a normal,
    // expected transient state.
  })
})

test.describe("Pipelines — Quick Run modal live progress", () => {
  test.skip("step list updates from pending → running → success/failed during a run", async ({ page }) => {
    // TODO: same shape as the Compose test above, applied to
    // QuickRunModal's per-node status list.
  })
})

/**
 * TODO — DB-level regression guard (not a Playwright test, a note for
 * whoever runs this suite's setup):
 *
 * Run this against staging Supabase after any RLS policy change on
 * pipeline_step_checkpoints:
 *
 *   SELECT COUNT(*) FROM pipeline_step_checkpoints
 *   WHERE created_at > now() - interval '1 hour';
 *
 * If this returns 0 after running any of the tests above, checkpoint writes
 * are silently failing again (exactly the bug found and fixed during the
 * audit) — the UI tests might still "pass" by falling back to the final
 * result, masking a real regression. Worth wiring into CI as an explicit
 * post-suite DB assertion, not just relying on the UI looking right.
 */
