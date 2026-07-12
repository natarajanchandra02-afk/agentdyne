export const runtime = "edge"

/**
 * GET /api/admin/governance
 *
 * Enterprise trust/audit surface — the admin-facing "who ran what, on which
 * model, why, and what did it cost" view. This is the UI layer for
 * execution_traces, which existed with a well-designed schema (selected_model,
 * routing_reason, depth_assessment) but had zero write path until this session
 * wired routeModel() into the pipeline execute route. This route is the read
 * side that makes that data actually visible.
 *
 * Query params:
 *   status    "success" | "failed" | undefined (all)
 *   agentId   filter to one agent
 *   userId    filter to one user
 *   limit     default 50, max 200
 *   cursor    ISO timestamp — return rows created before this (pagination)
 */

import { NextRequest, NextResponse } from "next/server"
import { verifyAdmin } from "../_auth"

export async function GET(req: NextRequest) {
  const { error, status, adminDb } = await verifyAdmin(req)
  if (error) return NextResponse.json({ error }, { status: status! })

  const params    = req.nextUrl.searchParams
  const statusF   = params.get("status")
  const agentId   = params.get("agentId")
  const userId    = params.get("userId")
  const cursor    = params.get("cursor")
  const limit     = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200)

  let query = adminDb!
    .from("execution_traces")
    .select(`
      id, execution_id, agent_id, user_id, model, selected_model, routing_reason,
      depth_assessment, total_ms, tokens_input, tokens_output, cost_usd, status,
      error_message, temperature, system_prompt, user_message, assistant_reply,
      created_at,
      agents ( name ),
      profiles!execution_traces_user_id_fkey ( full_name, email )
    `)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (statusF)  query = query.eq("status", statusF)
  if (agentId)  query = query.eq("agent_id", agentId)
  if (userId)   query = query.eq("user_id", userId)
  if (cursor)   query = query.lt("created_at", cursor)

  const { data: traces, error: queryErr } = await query
  if (queryErr) {
    console.error("[admin/governance]", queryErr.message)
    return NextResponse.json({ error: "Failed to load execution traces" }, { status: 500 })
  }

  // Summary stats over the same filter set (separate lightweight query,
  // not derived from the paginated page — a "success rate" computed only
  // from the current page would be misleading once pagination is in play)
  let statsQuery = adminDb!
    .from("execution_traces")
    .select("status, cost_usd, total_ms", { count: "exact" })
  if (agentId) statsQuery = statsQuery.eq("agent_id", agentId)
  if (userId)  statsQuery = statsQuery.eq("user_id", userId)

  const { data: statsRows, count: totalCount } = await statsQuery.limit(5000)

  const successCount = (statsRows ?? []).filter(r => r.status === "success").length
  const totalCost    = (statsRows ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0)
  const avgLatency   = statsRows?.length
    ? Math.round((statsRows ?? []).reduce((s, r) => s + (r.total_ms ?? 0), 0) / statsRows.length)
    : 0

  return NextResponse.json({
    traces: (traces ?? []).map((t: any) => ({
      id:              t.id,
      executionId:     t.execution_id,
      agentId:         t.agent_id,
      agentName:       t.agents?.name ?? "Unknown agent",
      userId:          t.user_id,
      userName:        t.profiles?.full_name ?? t.profiles?.email ?? "Unknown user",
      model:           t.model,
      selectedModel:   t.selected_model,
      routingReason:   t.routing_reason,
      depthAssessment: t.depth_assessment,
      totalMs:         t.total_ms,
      tokensIn:        t.tokens_input,
      tokensOut:       t.tokens_output,
      costUsd:         t.cost_usd,
      status:          t.status,
      errorMessage:    t.error_message,
      temperature:     t.temperature,
      // Full replay data — deliberately included even though it's heavier,
      // since "can I replay this exact execution" is the actual trust
      // signal an enterprise buyer is checking for, not just the metadata.
      systemPrompt:    t.system_prompt,
      userMessage:     t.user_message,
      assistantReply:  t.assistant_reply,
      createdAt:       t.created_at,
    })),
    stats: {
      totalTracked: totalCount ?? 0,
      successRate:  statsRows?.length ? Math.round((successCount / statsRows.length) * 100) : 0,
      totalCostUsd: totalCost,
      avgLatencyMs: avgLatency,
    },
    nextCursor: traces && traces.length === limit ? traces[traces.length - 1].created_at : null,
  })
}
