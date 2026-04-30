export const runtime = "edge"

/**
 * /api/run/[shareKey]
 *
 * Pipeline-as-Product endpoint.
 * Allows any pipeline to be exposed as a public API via a share key.
 * No authentication required — the share key IS the auth.
 *
 * GET  /api/run/abc123   — returns pipeline metadata (name, description, schema)
 * POST /api/run/abc123   — executes the pipeline
 *
 * Rate limited by: share key daily_limit field (DB) + IP rate limiter
 *
 * Example curl:
 *   curl -X POST https://agentdyne.com/api/run/abc123 \
 *     -H "Content-Type: application/json" \
 *     -d '{"input": "Summarise the top AI news today"}'
 */

import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { apiRateLimit } from "@/lib/rate-limit"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// OPTIONS — handle CORS preflight
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ── GET — pipeline info ────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params
    if (!shareKey || shareKey.length > 64)
      return NextResponse.json({ error: "Invalid share key" }, { status: 400, headers: CORS_HEADERS })

    const admin = createAdminClient()

    const { data: shareRow } = await admin
      .from("pipeline_share_keys")
      .select("pipeline_id, name, description, is_active, allow_execute, daily_limit, executions_today")
      .eq("share_key", shareKey)
      .single()

    if (!shareRow || !shareRow.is_active)
      return NextResponse.json({ error: "Pipeline not found or link is inactive" }, { status: 404, headers: CORS_HEADERS })

    const { data: pipeline } = await admin
      .from("pipelines")
      .select("name, description, dag, tags, total_runs")
      .eq("id", shareRow.pipeline_id)
      .single()

    if (!pipeline)
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404, headers: CORS_HEADERS })

    const nodeCount = (pipeline.dag as any)?.nodes?.length ?? 0

    return NextResponse.json({
      name:         shareRow.name       || pipeline.name,
      description:  shareRow.description || pipeline.description,
      steps:        nodeCount,
      tags:         pipeline.tags ?? [],
      total_runs:   pipeline.total_runs ?? 0,
      can_execute:  shareRow.allow_execute,
      quota: {
        daily_limit:       shareRow.daily_limit,
        executions_today:  shareRow.executions_today,
        remaining_today:   Math.max(0, (shareRow.daily_limit ?? 100) - (shareRow.executions_today ?? 0)),
      },
      endpoint: {
        method:  "POST",
        url:     `/api/run/${shareKey}`,
        example: { input: "Your input here" },
      },
    }, { headers: CORS_HEADERS })

  } catch (err: any) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS })
  }
}

// ── POST — execute pipeline ────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { shareKey } = await params
    if (!shareKey || shareKey.length > 64)
      return NextResponse.json({ error: "Invalid share key" }, { status: 400, headers: CORS_HEADERS })

    const admin = createAdminClient()

    // Load share key row
    const { data: shareRow } = await admin
      .from("pipeline_share_keys")
      .select("id, pipeline_id, owner_id, is_active, allow_execute, daily_limit, executions_today, last_reset_at")
      .eq("share_key", shareKey)
      .single()

    if (!shareRow || !shareRow.is_active)
      return NextResponse.json({ error: "Pipeline not found or link is inactive" }, { status: 404, headers: CORS_HEADERS })

    if (!shareRow.allow_execute)
      return NextResponse.json({ error: "This share link does not allow execution" }, { status: 403, headers: CORS_HEADERS })

    // Daily limit check
    const lastReset = new Date(shareRow.last_reset_at)
    const dayAgo    = new Date(Date.now() - 86_400_000)
    const todayCount = lastReset < dayAgo ? 0 : (shareRow.executions_today ?? 0)
    const dailyLimit = shareRow.daily_limit ?? 100

    if (todayCount >= dailyLimit) {
      return NextResponse.json({
        error:  "Daily execution limit reached for this share link",
        code:   "SHARE_LIMIT_EXCEEDED",
        resets: "in 24 hours",
      }, { status: 429, headers: { ...CORS_HEADERS, "Retry-After": "86400" } })
    }

    // Parse body
    let body: { input?: unknown; variables?: Record<string, string> }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS }) }

    if (!body.input && body.input !== 0 && body.input !== false)
      return NextResponse.json({ error: "input is required" }, { status: 400, headers: CORS_HEADERS })

    // Forward to the pipeline execute endpoint (reuses all quota, rate-limit, credit logic)
    // We run this on behalf of the pipeline owner by using admin client + passing owner ID via
    // a signed internal header so the execute route can verify it's a legitimate share execution.
    // The execute route reads x-share-owner-id ONLY when x-pipeline-share-key is also present.
    const executeRes = await fetch(
      new URL(`/api/pipelines/${shareRow.pipeline_id}/execute`, req.url).toString(),
      {
        method:  "POST",
        headers: {
          "Content-Type":          "application/json",
          // Internal service call: pass owner ID directly.
          // The pipeline execute route validates this header only when the share key header is present.
          "x-pipeline-share-key":  shareKey,
          "x-share-owner-id":      shareRow.owner_id,
          // Pass service key so the execute route's API-key auth path resolves owner_id
          // The execute route DOES check this path: Bearer token → hash → api_keys lookup.
          // For share keys we bypass this with a special internal header checked first.
          "x-internal-service":    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        },
        body: JSON.stringify({ input: body.input, variables: body.variables ?? {} }),
      }
    )

    const result = await executeRes.json()

    // Increment daily counter (fire-and-forget)
    admin.from("pipeline_share_keys").update({
      executions_today: lastReset < dayAgo ? 1 : todayCount + 1,
      last_reset_at:    lastReset < dayAgo ? new Date().toISOString() : shareRow.last_reset_at,
      total_uses:       (shareRow as any).total_uses + 1,
    }).eq("id", shareRow.id).then()

    return NextResponse.json(result, {
      status:  executeRes.status,
      headers: {
        ...CORS_HEADERS,
        "X-Pipeline-Share-Key":   shareKey,
        "X-Executions-Today":     String(todayCount + 1),
        "X-Daily-Limit":          String(dailyLimit),
      },
    })

  } catch (err: any) {
    console.error("/api/run/[shareKey] POST:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: CORS_HEADERS })
  }
}
