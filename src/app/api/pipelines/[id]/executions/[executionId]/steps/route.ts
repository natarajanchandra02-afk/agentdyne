export const runtime = "edge"

/**
 * GET /api/pipelines/[id]/executions/[executionId]/steps
 *
 * Polling endpoint for live pipeline execution progress.
 *
 * ✅ This is the read side of the pipeline_step_checkpoints RLS fix.
 * That table has existed since the DAG execution engine was built, written
 * incrementally mid-run (PRE-STEP "started" checkpoint, then POST-STEP result),
 * but was never actually populated — every write silently failed under RLS
 * (write policy required service_role; the execute route authenticates as the
 * calling user). Verified empirically: 0 rows despite real completed
 * executions. Fixed via migration (owner-write + owner-update policies).
 *
 * With writes now landing, this endpoint lets the client poll real per-node
 * progress WHILE POST /execute is still running in a separate connection —
 * Cloudflare Workers serves concurrent requests fine, and Supabase commits
 * from the execute route are visible to this GET the moment they land.
 *
 * No new infrastructure. No event bus. No Durable Objects. Just exposing data
 * that was already being generated (once it could actually write).
 *
 * Response shape is intentionally close to what LiveExecution / the Compose
 * result card already render for node_results, so wiring this in as a polling
 * source is a drop-in swap rather than a new UI.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"

// ✅ Bug fix: cookie-only auth, same class of fix as the /latest route —
// an SDK caller with a Bearer/X-Api-Key header would 401 here otherwise.
async function resolveUserId(req: NextRequest, supabase: any): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.id) return user.id
  const rawKey = extractRawKey(req)
  if (!rawKey) return null
  const result = await validateApiKey(supabase, rawKey, { required: ["execute"] })
  return result.valid ? result.userId : null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id: pipelineId, executionId } = await params

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!UUID_RE.test(pipelineId) || !UUID_RE.test(executionId)) {
    return NextResponse.json({ error: "Invalid pipeline or execution id" }, { status: 400 })
  }

  const supabase = await createClient()
  const userId = await resolveUserId(req, supabase)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Ownership check via the execution record itself — cheaper than re-checking
  // pipeline ownership, and correctly scopes to "this specific run", not just
  // "this pipeline" (a pipeline can be public/shared while an execution's
  // step-level detail should still only be visible to whoever ran it).
  const { data: execution, error: execErr } = await supabase
    .from("pipeline_executions")
    .select("id, pipeline_id, user_id, status, total_cost, total_latency_ms, total_tokens_in, total_tokens_out, error_message, output, created_at, completed_at")
    .eq("id", executionId)
    .eq("pipeline_id", pipelineId)
    .single()

  if (execErr || !execution) {
    return NextResponse.json({ error: "Execution not found" }, { status: 404 })
  }
  if (execution.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Step checkpoints — RLS (owner-read policy) double-covers this, but the
  // explicit .eq("user_id", ...) keeps the query itself self-documenting.
  const { data: steps, error: stepsErr } = await supabase
    .from("pipeline_step_checkpoints")
    .select("node_id, agent_id, step_index, status, latency_ms, cost_usd, tokens_input, tokens_output, retry_count, error_message, started_at, completed_at")
    .eq("execution_id", executionId)
    .eq("user_id", userId)
    .order("step_index", { ascending: true })

  if (stepsErr) {
    console.error("[pipeline steps poll]", stepsErr.message)
    return NextResponse.json({ error: "Failed to load step checkpoints" }, { status: 500 })
  }

  // Collapse to one row per node_id, preferring the most complete record —
  // PRE-STEP writes "started" first, POST-STEP upserts the same row (same
  // execution_id + node_id via onConflict) with the final status. In the
  // normal case this is already 1:1, but a resumed/retried step could
  // theoretically leave more than one row-shape in flight, so we defend here
  // rather than assume the upsert always wins the race before the client polls.
  const byNode = new Map<string, (typeof steps)[number]>()
  for (const s of steps ?? []) {
    const existing = byNode.get(s.node_id)
    if (!existing || (existing.status === "started" && s.status !== "started")) {
      byNode.set(s.node_id, s)
    }
  }
  const orderedSteps = Array.from(byNode.values()).sort((a, b) => a.step_index - b.step_index)

  const isDone = execution.status === "success" || execution.status === "failed"

  return NextResponse.json({
    executionId,
    status:        execution.status,       // "running" | "success" | "failed"
    isDone,
    steps: orderedSteps.map(s => ({
      nodeId:      s.node_id,
      agentId:     s.agent_id,
      stepIndex:   s.step_index,
      status:      s.status,               // "started" | "success" | "failed" | "skipped"
      latencyMs:   s.latency_ms,
      costUsd:     s.cost_usd,
      tokensIn:    s.tokens_input,
      tokensOut:   s.tokens_output,
      retryCount:  s.retry_count,
      error:       s.error_message,
      startedAt:   s.started_at,
      completedAt: s.completed_at,
    })),
    // Only present once the execution has actually finished — mirrors the
    // shape POST /execute already returns, so a client that starts polling
    // then falls back to reading this final block needs no new parsing logic.
    ...(isDone && {
      final: {
        output:         execution.output,
        errorMessage:   execution.error_message,
        totalCostUsd:   execution.total_cost,
        totalLatencyMs: execution.total_latency_ms,
        totalTokensIn:  execution.total_tokens_in,
        totalTokensOut: execution.total_tokens_out,
        completedAt:    execution.completed_at,
      },
    }),
  })
}
