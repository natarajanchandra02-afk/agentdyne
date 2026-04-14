export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/agents/route
 *
 * Cost-aware intelligent agent router.
 * Given a task description and constraints, returns the best-matching agent.
 *
 * Body:
 *   task          - natural language description of what needs to be done
 *   category      - (optional) constrain to category
 *   max_cost_usd  - (optional) max price per call
 *   min_score     - (optional) minimum composite_score
 *   prefer        - "accuracy" | "speed" | "cost" | "balanced" (default)
 *   capability    - (optional) required capability tag
 *
 * Returns: best matched agent with reasoning
 */
export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const body     = await req.json()

    const {
      task,
      category,
      max_cost_usd = 999,
      min_score    = 0,
      prefer       = "balanced",
      capability,
    } = body

    if (!task && !category && !capability) {
      return NextResponse.json(
        { error: "Provide at least one of: task, category, capability" },
        { status: 400 }
      )
    }

    // Determine sort order based on preference
    const sortColumn = {
      accuracy:  "accuracy_score",
      speed:     "latency_score",
      cost:      "cost_score",
      balanced:  "composite_score",
    }[prefer as string] ?? "composite_score"

    // Base query from capability view
    let query = supabase
      .from("agent_capabilities")
      .select("*")
      .gte("composite_score", min_score)
      .lte("price_per_call",  max_cost_usd)
      .order(sortColumn, { ascending: false })
      .limit(5)

    if (category)   query = query.eq("category", category)               as typeof query
    if (capability) query = query.contains("capability_tags", [capability]) as typeof query

    // If task is provided, use full-text search to narrow results
    if (task) {
      const keywords = task.toLowerCase().split(/\s+/).slice(0, 5).join(" | ")
      query = supabase
        .from("agents")
        .select(`
          id, name, slug, description, category,
          capability_tags, input_types, output_types,
          pricing_model, price_per_call, composite_score,
          average_latency_ms, model_name
        `)
        .eq("status", "active")
        .textSearch("description", keywords, { type: "websearch", config: "english" })
        .gte("composite_score", min_score)
        .lte("price_per_call",  max_cost_usd)
        .order("composite_score", { ascending: false })
        .limit(5) as any
    }

    const { data, error } = await query
    if (error) throw error

    const candidates = (data ?? []) as any[]

    if (candidates.length === 0) {
      return NextResponse.json({
        matched: false,
        message: "No agents match your criteria. Try relaxing constraints.",
        suggestion: "Broaden max_cost_usd, lower min_score, or remove the category filter.",
      })
    }

    const best = candidates[0]
    const alternatives = candidates.slice(1)

    return NextResponse.json({
      matched: true,
      recommendation: {
        agent_id:    best.id,
        name:        best.name,
        description: best.description,
        category:    best.category,
        score:       best.composite_score,
        pricing: {
          model:     best.pricing_model,
          per_call:  best.price_per_call,
        },
        performance: {
          avg_latency_ms: best.average_latency_ms,
          model:          best.model_name,
        },
        endpoint: `https://agentdyne.com/api/agents/${best.id}/execute`,
        reasoning: buildReasoning(best, prefer, task),
      },
      alternatives: alternatives.map(a => ({
        agent_id: a.id,
        name:     a.name,
        score:    a.composite_score,
        pricing:  { model: a.pricing_model, per_call: a.price_per_call },
      })),
      routing_preference: prefer,
    })
  } catch (err: any) {
    console.error("POST /api/agents/route:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildReasoning(agent: any, prefer: string, task?: string): string {
  const reasons: string[] = []

  if (prefer === "cost")     reasons.push(`Lowest cost in category ($${agent.price_per_call}/call)`)
  if (prefer === "speed")    reasons.push(`Fastest response (~${agent.average_latency_ms}ms avg)`)
  if (prefer === "accuracy") reasons.push(`Highest success rate in category`)
  if (prefer === "balanced") reasons.push(`Best composite quality score (${agent.composite_score}/100)`)

  if (agent.pricing_model === "free") reasons.push("Free to use — no cost")
  if (agent.composite_score >= 85)   reasons.push("Top-rated agent (S grade)")
  if (task) reasons.push(`Description matched your task: "${task.slice(0, 60)}..."`)

  return reasons.join(". ")
}
