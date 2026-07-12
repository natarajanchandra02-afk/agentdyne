export const runtime = "edge"

/**
 * GET /api/pipelines/[id]/executions/latest
 *
 * Discovery endpoint that lets the client find the executionId for a run it
 * just kicked off, without waiting for POST /execute to fully resolve.
 *
 * Why this exists: POST /execute is one long-running synchronous request on
 * Cloudflare's edge runtime — it creates the pipeline_executions row very
 * early (right after DAG validation, before any node runs), but only returns
 * that row's id in the FINAL response, once every node has finished. That
 * meant a client had no way to start polling per-step progress (via
 * .../executions/[executionId]/steps) until the thing it wanted progress
 * FOR had already completed.
 *
 * This endpoint closes that gap: the client fires POST /execute without
 * fully awaiting it, then polls this route (on a separate connection —
 * Cloudflare Workers serves concurrent requests fine) until it finds the
 * row that request just inserted, switches to polling /steps with the real
 * executionId, and gets genuine incremental progress instead of a fake
 * "running…" state that jumps straight to 100% when the batch finally lands.
 *
 * Scoped to `createdAfter` so a fast succession of runs on the same pipeline
 * can't accidentally latch onto a stale, already-finished execution.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { validateApiKey, extractRawKey } from "@/lib/api-key-auth"

// ✅ Bug fix: this route only checked supabase.auth.getUser() (cookie
// session) — an SDK caller authenticating with a Bearer/X-Api-Key header
// would get 401 Unauthorized, since createClient()'s session has no
// knowledge of API key headers at all. Added the same validateApiKey()
// fallback used by the properly-built /api/execute route, so SDK polling
// actually works, not just browser sessions.
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: pipelineId } = await params

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!UUID_RE.test(pipelineId)) {
    return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })
  }

  const supabase = await createClient()
  const userId = await resolveUserId(req, supabase)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Only match executions created after this timestamp — passed by the client
  // as the moment it fired the POST /execute request. Prevents a burst of
  // "run again" clicks from ever picking up a previous run's execution id.
  const createdAfterParam = req.nextUrl.searchParams.get("createdAfter")
  const createdAfter = createdAfterParam ? new Date(createdAfterParam) : null
  if (!createdAfter || isNaN(createdAfter.getTime())) {
    return NextResponse.json({ error: "createdAfter query param (ISO timestamp) is required" }, { status: 400 })
  }

  const { data: execution, error } = await supabase
    .from("pipeline_executions")
    .select("id, status, created_at")
    .eq("pipeline_id", pipelineId)
    .eq("user_id", userId)
    .gte("created_at", createdAfter.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("[executions/latest]", error.message)
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 })
  }

  // Not found yet is a normal, expected state early in polling — the insert
  // inside POST /execute may simply not have committed yet. 200 + null,
  // not a 404, since this isn't an error condition from the client's view.
  if (!execution) {
    return NextResponse.json({ executionId: null, status: null })
  }

  return NextResponse.json({ executionId: execution.id, status: execution.status })
}
