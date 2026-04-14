export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/discover
 *
 * Machine-readable agent capability graph for agent-to-agent discovery.
 * Designed to be consumed by AI agents selecting tools automatically.
 *
 * Query params:
 *   capability    - e.g. "summarize", "classify", "extract", "generate", "analyze"
 *   input_type    - e.g. "text", "json", "url", "code", "image"
 *   output_type   - e.g. "text", "json", "markdown", "code"
 *   category      - agent category
 *   max_cost      - max price_per_call in USD
 *   min_score     - minimum composite_score (0–100)
 *   compliance    - e.g. "gdpr", "hipaa", "soc2"
 *   limit         - default 10, max 50
 *
 * Returns a machine-optimised payload with capability graphs.
 */
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase       = await createClient()
    const { searchParams } = new URL(req.url)

    const capability  = searchParams.get("capability")
    const inputType   = searchParams.get("input_type")
    const outputType  = searchParams.get("output_type")
    const category    = searchParams.get("category")
    const maxCost     = parseFloat(searchParams.get("max_cost")  || "999")
    const minScore    = parseFloat(searchParams.get("min_score") || "0")
    const compliance  = searchParams.get("compliance")
    const limit       = Math.min(50, parseInt(searchParams.get("limit") || "10"))

    let query = supabase
      .from("agent_capabilities")
      .select("*")
      .gte("composite_score", minScore)
      .lte("price_per_call",  maxCost)
      .order("composite_score", { ascending: false })
      .limit(limit)

    if (category)   query = query.eq("category", category)          as typeof query
    if (inputType)  query = query.contains("input_types",  [inputType])  as typeof query
    if (outputType) query = query.contains("output_types", [outputType]) as typeof query
    if (capability) query = query.contains("capability_tags", [capability]) as typeof query
    if (compliance) query = query.contains("compliance_tags",  [compliance]) as typeof query

    const { data, error } = await query
    if (error) throw error

    // Build capability graph edges: which agents can feed into which
    const agents = data ?? []
    const capabilityGraph: Record<string, string[]> = {}
    for (const agent of agents) {
      for (const cap of (agent.capability_tags ?? [])) {
        if (!capabilityGraph[cap]) capabilityGraph[cap] = []
        capabilityGraph[cap].push(agent.id)
      }
    }

    return NextResponse.json({
      // OpenAI-style manifest
      schema_version: "1.0",
      api_base: "https://agentdyne.com/api",
      agents: agents.map(a => ({
        id:              a.id,
        name:            a.name,
        slug:            a.slug,
        description:     a.description,
        category:        a.category,
        capability_tags: a.capability_tags ?? [],
        input_types:     a.input_types    ?? ["text"],
        output_types:    a.output_types   ?? ["text"],
        languages:       a.languages      ?? ["en"],
        compliance_tags: a.compliance_tags ?? [],
        quality: {
          composite_score: a.composite_score ?? 0,
          accuracy_score:  a.accuracy_score  ?? 0,
          latency_score:   a.latency_score   ?? 0,
          cost_score:      a.cost_score      ?? 0,
        },
        pricing: {
          model:              a.pricing_model,
          price_per_call_usd: a.price_per_call,
          monthly_usd:        a.subscription_price_monthly,
          free_calls:         a.free_calls_per_month,
        },
        performance: {
          avg_latency_ms: a.average_latency_ms,
          model:          a.model_name,
        },
        endpoint: `https://agentdyne.com/api/agents/${a.id}/execute`,
        docs:     `https://agentdyne.com/marketplace/${a.id}`,
      })),
      capability_graph: capabilityGraph,
      // Suggested pipeline compositions
      pipeline_suggestions: buildPipelineSuggestions(agents),
      total_agents_in_marketplace: await getMarketplaceSize(supabase),
    })
  } catch (err: any) {
    console.error("GET /api/discover:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildPipelineSuggestions(agents: any[]): any[] {
  // Suggest natural chains based on output→input compatibility
  const suggestions: any[] = []
  for (let i = 0; i < agents.length; i++) {
    for (let j = 0; j < agents.length; j++) {
      if (i === j) continue
      const a = agents[i]
      const b = agents[j]
      const aOut = a.output_types ?? []
      const bIn  = b.input_types  ?? []
      const overlap = aOut.filter((t: string) => bIn.includes(t))
      if (overlap.length > 0) {
        suggestions.push({
          chain:        [a.id, b.id],
          labels:       [a.name, b.name],
          compatible_on: overlap,
          combined_score: ((a.composite_score + b.composite_score) / 2).toFixed(1),
        })
      }
      if (suggestions.length >= 5) break
    }
    if (suggestions.length >= 5) break
  }
  return suggestions
}

async function getMarketplaceSize(supabase: any): Promise<number> {
  const { count } = await supabase
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("status", "active")
  return count ?? 0
}
