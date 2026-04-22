export const runtime = "edge"

/**
 * POST /api/pipelines/[id]/explain
 *
 * AI-powered failure explanation for a specific pipeline execution.
 * Called by the ExplainFailure component in the pipeline editor history tab.
 *
 * Input:  { executionId: string }
 * Output: { summary, rootCause, fix, suggestion, severity, retryable }
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id: pipelineId } = await params
    if (!UUID_RE.test(pipelineId))
      return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: { executionId?: string }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { executionId } = body
    if (!executionId || !UUID_RE.test(executionId))
      return NextResponse.json({ error: "executionId is required" }, { status: 400 })

    // Load the failed execution
    const { data: execution } = await supabase
      .from("pipeline_executions")
      .select("id, pipeline_id, status, error_message, node_results, total_latency_ms, total_cost, created_at")
      .eq("id", executionId)
      .eq("pipeline_id", pipelineId)
      .eq("user_id", user.id)
      .single()

    if (!execution) return NextResponse.json({ error: "Execution not found" }, { status: 404 })

    // Build failure summary for LLM
    const nodeResults: any[] = execution.node_results ?? []
    const failedNodes = nodeResults.filter((n: any) => n.status === "failed")
    const nodesSummary = nodeResults.map((n: any) =>
      `${n.agent_name}: ${n.status}${n.error ? ` — ${n.error}` : ""}${n.latency_ms ? ` (${n.latency_ms}ms)` : ""}`
    ).join("\n")

    // Rule-based fast path for common errors (no LLM needed)
    const errorMsg = execution.error_message?.toLowerCase() ?? ""
    const firstFailedError = failedNodes[0]?.error?.toLowerCase() ?? ""

    if (errorMsg.includes("timed out") || errorMsg.includes("timeout")) {
      return NextResponse.json({
        summary:    "Pipeline execution timed out.",
        rootCause:  "The total execution time exceeded the configured timeout limit.",
        fix:        "Increase the pipeline timeout in settings, or identify which node is slowest and optimize it.",
        suggestion: "Consider splitting slow sequential steps into a parallel group to reduce total latency.",
        severity:   "high",
        retryable:  true,
      })
    }

    if (errorMsg.includes("quota exceeded") || errorMsg.includes("quota")) {
      return NextResponse.json({
        summary:    "Monthly execution quota reached.",
        rootCause:  "Your plan's monthly execution limit was hit before the pipeline could finish.",
        fix:        "Upgrade your plan or wait for the monthly quota to reset.",
        suggestion: "Enable 'continue on failure' on pipeline nodes so partial results are still returned.",
        severity:   "medium",
        retryable:  false,
      })
    }

    if (firstFailedError.includes("agent has no system prompt") || firstFailedError.includes("system prompt")) {
      return NextResponse.json({
        summary:    "An agent is missing its system prompt.",
        rootCause:  `The agent "${failedNodes[0]?.agent_name ?? "unknown"}" has no configured system prompt and cannot run.`,
        fix:        "Open the agent builder and add a system prompt to this agent, then publish it.",
        suggestion: null,
        severity:   "critical",
        retryable:  false,
      })
    }

    if (firstFailedError.includes("insufficient credits") || firstFailedError.includes("credit")) {
      return NextResponse.json({
        summary:    "Insufficient credits to complete the pipeline.",
        rootCause:  "Your credit balance ran out mid-pipeline.",
        fix:        "Add credits in your billing dashboard and retry.",
        suggestion: "Set a pipeline cost kill switch budget to prevent unexpected spend.",
        severity:   "high",
        retryable:  true,
      })
    }

    // LLM-powered explanation for complex failures
    const systemPrompt = `You are an AI execution debugger for AgentDyne, a multi-agent pipeline platform.
Analyse the failed execution and provide a precise, actionable explanation.

RESPOND ONLY in valid JSON (no markdown):
{"summary":"One-sentence what happened","rootCause":"Technical root cause","fix":"Exact action to fix it","suggestion":"Optional workflow improvement","severity":"critical|high|medium|low","retryable":true|false}`

    const userMsg = `Pipeline execution FAILED.
Error: ${execution.error_message ?? "Unknown error"}
Duration: ${execution.total_latency_ms ?? "?"}ms
Cost incurred: $${parseFloat(String(execution.total_cost ?? 0)).toFixed(6)}

Node execution trace:
${nodesSummary || "No node results recorded"}

Failed node details:
${failedNodes.map((n: any) => `Agent: ${n.agent_name}\nError: ${n.error ?? "no error message"}\nLatency: ${n.latency_ms}ms`).join("\n\n")}`

    let explanation: any

    try {
      const { text } = await routeCompletion({
        model:       "claude-haiku-4-5-20251001",  // Fast + cheap for diagnostics
        system:      systemPrompt,
        userMessage: userMsg,
        maxTokens:   500,
        temperature: 0.1,
      })

      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim()
      explanation = JSON.parse(cleaned)
    } catch {
      // LLM call failed — return rule-based fallback
      explanation = {
        summary:    `Pipeline failed at "${failedNodes[0]?.agent_name ?? "a node"}".`,
        rootCause:  execution.error_message ?? failedNodes[0]?.error ?? "Unknown error",
        fix:        "Check the agent's configuration and system prompt, then retry the pipeline.",
        suggestion: "Enable 'continue on failure' on this node to let the pipeline proceed even when it fails.",
        severity:   "high",
        retryable:  true,
      }
    }

    return NextResponse.json(explanation)

  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/explain:", err)
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 })
  }
}
