export const runtime = "edge"

/**
 * POST /api/pipelines/[id]/improve
 *
 * AI-powered pipeline optimization advisor.
 *
 * Analyzes the pipeline's recent execution history and uses Claude to:
 *   1. Identify failure patterns
 *   2. Suggest better agents for underperforming nodes
 *   3. Recommend structural changes (parallelization, branching)
 *   4. Estimate cost/latency improvements
 *
 * This is the "AI that improves AI" moat feature.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface ImprovementSuggestion {
  type:        "agent_swap" | "add_parallel" | "add_branch" | "remove_node" | "reorder" | "cost_optimize" | "reliability"
  priority:    "critical" | "high" | "medium" | "low"
  title:       string
  description: string
  // For agent_swap: which node and to which agent
  nodeId?:      string
  nodeLabel?:   string
  suggestedAgentId?:   string
  suggestedAgentName?: string
  // Estimated impact
  estimatedCostSavingUsd?:   number
  estimatedLatencySavingMs?: number
  estimatedReliabilityGain?: number  // percentage points
}

export interface ImproveResponse {
  ok:             boolean
  suggestions:    ImprovementSuggestion[]
  summary:        string
  analysisDepth:  "rich" | "limited" | "insufficient_data"
  runsAnalyzed:   number
  failureRate:    number
  avgLatencyMs:   number
  avgCostUsd:     number
  error?:         string
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    if (!UUID_RE.test(id))
      return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // Load pipeline
    const { data: pipeline } = await supabase.from("pipelines")
      .select("id, name, dag, owner_id, timeout_seconds")
      .eq("id", id).single()

    if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (pipeline.owner_id !== user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Load recent execution history (last 20 runs)
    const { data: executions } = await supabase.from("pipeline_executions")
      .select("id, status, total_latency_ms, total_cost, error_message, node_results, created_at")
      .eq("pipeline_id", id)
      .order("created_at", { ascending: false })
      .limit(20)

    const runs = executions ?? []

    // Compute metrics
    const totalRuns    = runs.length
    const failedRuns   = runs.filter(r => r.status === "failed").length
    const failureRate  = totalRuns > 0 ? failedRuns / totalRuns : 0
    const avgLatency   = totalRuns > 0
      ? runs.reduce((s, r) => s + (r.total_latency_ms ?? 0), 0) / totalRuns
      : 0
    const avgCost      = totalRuns > 0
      ? runs.reduce((s, r) => s + parseFloat(String(r.total_cost ?? 0)), 0) / totalRuns
      : 0

    const analysisDepth: ImproveResponse["analysisDepth"] =
      totalRuns >= 10 ? "rich" : totalRuns >= 3 ? "limited" : "insufficient_data"

    // Build node failure stats from node_results
    const nodeStats: Record<string, { success: number; fail: number; totalMs: number; totalCost: number }> = {}
    const dag = pipeline.dag as { nodes: any[]; edges: any[] }

    for (const run of runs) {
      const nodeResults: any[] = run.node_results ?? []
      for (const nr of nodeResults) {
        if (!nr.node_id) continue
        if (!nodeStats[nr.node_id]) nodeStats[nr.node_id] = { success: 0, fail: 0, totalMs: 0, totalCost: 0 }
        if (nr.status === "success") nodeStats[nr.node_id].success++
        else if (nr.status === "failed") nodeStats[nr.node_id].fail++
        nodeStats[nr.node_id].totalMs   += nr.latency_ms ?? 0
        nodeStats[nr.node_id].totalCost += nr.cost ?? 0
      }
    }

    // Find available alternative agents for underperforming nodes
    const nodeIds    = dag.nodes.map((n: any) => n.agent_id).filter(Boolean)
    const { data: currentAgents } = await supabase.from("agents")
      .select("id, name, description, category, pricing_model, price_per_call, composite_score, average_latency_ms, average_rating")
      .in("id", nodeIds)

    // Get alternatives in same categories
    const categories = [...new Set((currentAgents ?? []).map((a: any) => a.category))]
    const { data: alternativeAgents } = await supabase.from("agents")
      .select("id, name, description, category, pricing_model, price_per_call, composite_score, average_latency_ms, average_rating")
      .in("category", categories)
      .eq("status", "active")
      .order("composite_score", { ascending: false })
      .limit(30)

    // Build LLM analysis prompt
    const nodeAnalysis = dag.nodes.map((node: any) => {
      const agent    = (currentAgents ?? []).find((a: any) => a.id === node.agent_id)
      const stats    = nodeStats[node.id]
      const runs_n   = stats ? stats.success + stats.fail : 0
      const failRate = runs_n > 0 ? (stats!.fail / runs_n * 100).toFixed(0) : "unknown"
      const avgMs    = runs_n > 0 ? (stats!.totalMs / runs_n).toFixed(0)    : "unknown"
      return `Node "${node.label}" (type: ${node.node_type ?? "linear"}): agent="${agent?.name ?? "unknown"}" category=${agent?.category} ` +
        `score=${agent?.composite_score ?? "?"} price=$${agent?.price_per_call ?? 0}/call ` +
        `failure_rate=${failRate}% avg_latency=${avgMs}ms`
    }).join("\n")

    const alternatives = (alternativeAgents ?? []).slice(0, 20).map((a: any) =>
      `ID:${a.id} "${a.name}" cat=${a.category} score=${a.composite_score} $${a.price_per_call ?? 0}/call`
    ).join("\n")

    const systemPrompt = `You are an expert multi-agent workflow optimizer for AgentDyne.
Analyze the pipeline execution data and suggest concrete improvements.
Focus on: reducing failures, cutting costs, improving latency, and better agent selection.

RESPOND ONLY in valid JSON, no markdown:
{"summary":"...","suggestions":[{"type":"agent_swap|add_parallel|add_branch|remove_node|reorder|cost_optimize|reliability","priority":"critical|high|medium|low","title":"...","description":"...","nodeId":"optional","nodeLabel":"optional","suggestedAgentId":"optional","suggestedAgentName":"optional","estimatedCostSavingUsd":0.0,"estimatedLatencySavingMs":0,"estimatedReliabilityGain":0}]}`

    const userMsg = `Pipeline: "${pipeline.name}"
Nodes:
${nodeAnalysis}

Execution stats (last ${totalRuns} runs):
- Failure rate: ${(failureRate * 100).toFixed(1)}%
- Avg latency: ${avgLatency.toFixed(0)}ms
- Avg cost: $${avgCost.toFixed(6)}/run

Available alternative agents:
${alternatives}

Suggest 2-4 specific, actionable improvements. Prioritize reliability over cost.`

    let suggestions: ImprovementSuggestion[] = []
    let aiSummary = ""

    // Only call LLM if we have meaningful data — don't waste tokens on empty pipelines
    if (totalRuns > 0 && dag.nodes.length > 0) {
      try {
        const { text } = await routeCompletion({
          model:       "claude-haiku-4-5-20251001",
          system:      systemPrompt,
          userMessage: userMsg,
          maxTokens:   1000,
          temperature: 0.2,
        })

        const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim()
        const parsed  = JSON.parse(cleaned)
        suggestions   = (parsed.suggestions ?? []) as ImprovementSuggestion[]
        aiSummary     = parsed.summary ?? ""
      } catch (parseErr) {
        // LLM call failed — provide rule-based fallback suggestions
        suggestions = buildRuleBasedSuggestions(dag.nodes, nodeStats, failureRate, avgLatency, avgCost)
        aiSummary   = "Analysis based on execution metrics (AI analysis unavailable)."
      }
    } else if (dag.nodes.length === 0) {
      aiSummary = "Pipeline has no agents. Add agents to get improvement suggestions."
    } else {
      // No runs yet — provide starter suggestions
      suggestions = buildStarterSuggestions(dag.nodes)
      aiSummary   = "No execution history yet. Run the pipeline at least once to get AI-powered suggestions."
    }

    return NextResponse.json({
      ok:            true,
      suggestions:   suggestions.slice(0, 5),  // max 5 to keep UI clean
      summary:       aiSummary,
      analysisDepth,
      runsAnalyzed:  totalRuns,
      failureRate:   parseFloat((failureRate * 100).toFixed(1)),
      avgLatencyMs:  Math.round(avgLatency),
      avgCostUsd:    parseFloat(avgCost.toFixed(6)),
    } satisfies ImproveResponse)

  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/improve:", err)
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 })
  }
}

// ─── Rule-based fallback when AI unavailable ───────────────────────────────────

function buildRuleBasedSuggestions(
  nodes:       any[],
  nodeStats:   Record<string, { success: number; fail: number; totalMs: number; totalCost: number }>,
  failureRate: number,
  avgLatency:  number,
  avgCost:     number
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = []

  // Flag high-failure nodes
  for (const node of nodes) {
    const stats = nodeStats[node.id]
    if (!stats) continue
    const total    = stats.success + stats.fail
    const nodeRate = total > 0 ? stats.fail / total : 0
    if (nodeRate > 0.2) {
      suggestions.push({
        type:        "reliability",
        priority:    nodeRate > 0.5 ? "critical" : "high",
        title:       `High failure rate on "${node.label}"`,
        description: `This node fails ${(nodeRate * 100).toFixed(0)}% of the time. Enable "continue on failure" or swap for a more reliable agent.`,
        nodeId:      node.id,
        nodeLabel:   node.label,
        estimatedReliabilityGain: Math.round(nodeRate * 50),
      })
    }
  }

  // Suggest parallelization for linear pipelines with 3+ nodes
  if (nodes.length >= 3 && !nodes.some(n => n.node_type === "parallel")) {
    suggestions.push({
      type:        "add_parallel",
      priority:    "medium",
      title:       "Parallelize independent steps",
      description: `Your pipeline runs all ${nodes.length} steps sequentially. If some steps don't depend on each other's output, running them in parallel can cut latency by 40-60%.`,
      estimatedLatencySavingMs: Math.round(avgLatency * 0.4),
    })
  }

  // Suggest cost optimization if avg cost is high
  if (avgCost > 0.05) {
    suggestions.push({
      type:        "cost_optimize",
      priority:    "medium",
      title:       "Switch early steps to faster/cheaper models",
      description: `Average run cost is $${avgCost.toFixed(4)}. Classification and extraction steps often work well with Haiku ($0.00025/1K tokens) instead of Sonnet. Reserve powerful models for final generation steps only.`,
      estimatedCostSavingUsd: avgCost * 0.3,
    })
  }

  return suggestions
}

function buildStarterSuggestions(nodes: any[]): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = []

  if (nodes.length === 1) {
    suggestions.push({
      type:        "reliability",
      priority:    "low",
      title:       "Enable 'continue on failure'",
      description: "For your first node, enable 'continue on failure' so a transient API error doesn't abort the entire pipeline. It will pass null to the next step instead.",
      nodeId:      nodes[0]?.id,
      nodeLabel:   nodes[0]?.label,
    })
  }

  if (nodes.length >= 2) {
    suggestions.push({
      type:        "add_branch",
      priority:    "low",
      title:       "Add conditional routing",
      description: "Once you have execution data, add branch conditions to route different inputs through different paths. For example: high-priority tickets get one treatment, low-priority get another.",
    })
  }

  return suggestions
}
