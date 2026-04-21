export const runtime = "edge"

/**
 * POST /api/pipelines/[id]/explain
 *
 * "Explain this failure" — converts raw error data into plain English
 * with root cause, likely fix, and an alternative agent recommendation.
 *
 * Body: { executionId: string }
 *
 * Uses claude-haiku for speed/cost (this is a utility endpoint, not production AI).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id: pipelineId } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: { executionId?: string }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { executionId } = body
    if (!executionId) return NextResponse.json({ error: "executionId is required" }, { status: 400 })

    // Load pipeline execution with node results
    const { data: execution } = await supabase
      .from("pipeline_executions")
      .select("status, error_message, node_results, total_cost, total_latency_ms, created_at")
      .eq("id", executionId)
      .eq("pipeline_id", pipelineId)
      .single()

    if (!execution)
      return NextResponse.json({ error: "Execution not found" }, { status: 404 })

    if (execution.status === "success")
      return NextResponse.json({
        summary:    "This execution completed successfully — no failure to explain.",
        rootCause:  null,
        fix:        null,
        suggestion: null,
      })

    // Build context for the LLM
    const nodeResults = (execution.node_results as any[]) ?? []
    const failedNodes = nodeResults.filter((n: any) => n.status === "failed")
    const skippedNodes = nodeResults.filter((n: any) => n.status === "skipped")

    const context = [
      `Pipeline execution FAILED.`,
      `Overall error: ${execution.error_message ?? "Unknown"}`,
      `Total nodes: ${nodeResults.length}`,
      `Failed nodes: ${failedNodes.length}`,
      `Skipped nodes: ${skippedNodes.length}`,
      failedNodes.map((n: any) =>
        `\nFailed node "${n.agent_name}" (${n.node_id}):\n  Error: ${n.error ?? "Unknown"}\n  Latency: ${n.latency_ms}ms`
      ).join(""),
    ].join("\n")

    const { text: explanation } = await routeCompletion({
      model:   "claude-haiku-4-5-20251001",
      system:  `You are an expert AI pipeline debugger. Analyse pipeline execution failures and explain them in plain English for developers.
Always respond in this exact JSON format (no markdown, no prose outside JSON):
{
  "summary": "One-sentence plain English summary of what went wrong",
  "rootCause": "Technical root cause (2-3 sentences). Be specific.",
  "fix": "Concrete steps to fix this. Max 3 bullet points.",
  "suggestion": "One alternative approach or agent that might work better",
  "severity": "critical|warning|info",
  "retryable": true/false
}`,
      userMessage: context,
      maxTokens: 600,
      temperature: 0.1,
    })

    let parsed: any = {
      summary:    execution.error_message ?? "Pipeline failed",
      rootCause:  "Unable to determine root cause automatically",
      fix:        "Check the execution trace for detailed logs",
      suggestion: "Consider adding continue_on_failure on the failing node",
      severity:   "critical",
      retryable:  false,
    }

    try {
      const clean = explanation.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim()
      parsed = JSON.parse(clean)
    } catch { /* keep fallback */ }

    return NextResponse.json({
      executionId,
      pipelineId,
      status:   execution.status,
      ...parsed,
      failedNodes: failedNodes.map((n: any) => ({
        nodeId:    n.node_id,
        agentName: n.agent_name,
        error:     n.error,
        latencyMs: n.latency_ms,
      })),
      skippedNodes: skippedNodes.map((n: any) => n.agent_name),
    })

  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/explain:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
