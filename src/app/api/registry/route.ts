export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/registry/search
 *
 * Machine-readable agent registry for capability-based discovery.
 * This is the "DNS for agents" — enables agent-to-agent selection,
 * Graph Engine node population, and autonomous task routing.
 *
 * This is distinct from /api/discover which is the OpenAI-style manifest.
 * Registry search is designed for:
 *   - Graph Engine finding agents by capability
 *   - Cost-aware routing (cheapest/fastest for a given capability)
 *   - Version-aware selection (pick a specific agent version)
 *   - Schema validation (does this agent's output match what I need?)
 *
 * Query params:
 *   capability    - capability tag (e.g. "summarize", "translate", "classify")
 *   capabilities  - comma-separated list
 *   category      - agent category
 *   input_type    - e.g. "text", "json", "url"
 *   output_type   - e.g. "text", "json", "markdown"
 *   max_cost      - max price_per_call (USD)
 *   min_score     - min composite_score (0–100)
 *   prefer        - "accuracy" | "speed" | "cost" | "balanced" (default)
 *   limit         - max results (default 10, max 50)
 *   page          - pagination
 *
 * Response is machine-optimised (no UI cruft).
 */
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase       = await createClient()
    const { searchParams } = new URL(req.url)

    const capabilityStr  = searchParams.get("capabilities") || searchParams.get("capability")
    const capabilities   = capabilityStr
      ? capabilityStr.split(",").map(c => c.trim().toLowerCase()).filter(Boolean)
      : []

    const category       = searchParams.get("category")
    const inputType      = searchParams.get("input_type")
    const outputType     = searchParams.get("output_type")
    const maxCost        = parseFloat(searchParams.get("max_cost")  || "999")
    const minScore       = parseFloat(searchParams.get("min_score") || "0")
    const prefer         = searchParams.get("prefer") || "balanced"
    const limit          = Math.min(50, parseInt(searchParams.get("limit") || "10"))
    const page           = Math.max(1,  parseInt(searchParams.get("page")  || "1"))

    // Map preference to ordering
    const orderColumn: Record<string, string> = {
      accuracy: "accuracy_score",
      speed:    "average_latency_ms",    // ascending for speed
      cost:     "price_per_call",        // ascending for cost
      balanced: "composite_score",       // descending
    }

    const col       = orderColumn[prefer] || "composite_score"
    const ascending = prefer === "speed" || prefer === "cost"

    // Build query against agent_capabilities view (agents + scores join)
    let q = supabase
      .from("agent_capabilities")
      .select("*", { count: "exact" })
      .gte("composite_score", minScore)
      .lte("price_per_call",  maxCost)
      .order(col,       { ascending })
      .order("composite_score", { ascending: false }) // secondary sort

    if (category)   q = q.eq("category", category)                    as typeof q
    if (inputType)  q = q.contains("input_types",  [inputType])       as typeof q
    if (outputType) q = q.contains("output_types", [outputType])      as typeof q

    // Filter by ALL capabilities if multiple provided
    for (const cap of capabilities) {
      q = q.contains("capability_tags", [cap]) as typeof q
    }

    const { data, count, error } = await q.range((page - 1) * limit, page * limit - 1)
    if (error) throw error

    const agents   = data ?? []
    const total    = count ?? 0
    const pages    = Math.ceil(total / limit)

    // Build capability graph (which agents share capabilities)
    const capGraph: Record<string, string[]> = {}
    for (const agent of agents) {
      for (const cap of (agent.capability_tags ?? [])) {
        if (!capGraph[cap]) capGraph[cap] = []
        capGraph[cap].push(agent.id)
      }
    }

    return NextResponse.json({
      schema_version:    "1.1",
      api_base:          process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com",
      query: {
        capabilities, category, input_type: inputType, output_type: outputType,
        max_cost: maxCost, min_score: minScore, prefer,
      },
      agents: agents.map(formatRegistryAgent),
      capability_graph:  capGraph,
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
      // Suggest complementary chains (output of A can feed input of B)
      composition_hints: buildCompositionHints(agents),
    })
  } catch (err: any) {
    console.error("GET /api/registry/search:", err)
    return NextResponse.json({ error: "Registry search failed" }, { status: 500 })
  }
}

function formatRegistryAgent(a: any) {
  return {
    id:              a.id,
    name:            a.name,
    slug:            a.slug,
    description:     a.description,
    category:        a.category,
    version:         a.version ?? "1.0.0",
    // Capability schema
    capability_tags: a.capability_tags ?? [],
    input_types:     a.input_types     ?? ["text"],
    output_types:    a.output_types    ?? ["text"],
    languages:       a.languages       ?? ["en"],
    compliance_tags: a.compliance_tags ?? [],
    // Quality signals
    quality: {
      composite_score:  a.composite_score  ?? 0,
      accuracy_score:   a.accuracy_score   ?? null,
      latency_score:    a.latency_score    ?? null,
      cost_score:       a.cost_score       ?? null,
    },
    // Economics
    pricing: {
      model:             a.pricing_model,
      price_per_call:    a.price_per_call,
      monthly_usd:       a.subscription_price_monthly,
      free_calls:        a.free_calls_per_month,
    },
    // Performance
    performance: {
      avg_latency_ms: a.average_latency_ms,
      model:          a.model_name,
    },
    // Machine-consumable endpoints
    endpoint:    `${process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"}/api/agents/${a.id}/execute`,
    schema_url:  `${process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"}/api/registry/${a.id}`,
    docs_url:    `${process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"}/marketplace/${a.id}`,
  }
}

function buildCompositionHints(agents: any[]): Array<{
  chain:     string[]
  labels:    string[]
  compatible_on: string[]
  combined_score: string
}> {
  const hints: ReturnType<typeof buildCompositionHints> = []
  const seen = new Set<string>()

  for (let i = 0; i < agents.length && hints.length < 5; i++) {
    for (let j = 0; j < agents.length && hints.length < 5; j++) {
      if (i === j) continue
      const a      = agents[i]
      const b      = agents[j]
      const aOut   = a.output_types ?? []
      const bIn    = b.input_types  ?? []
      const compat = aOut.filter((t: string) => bIn.includes(t))
      const key    = `${a.id}→${b.id}`

      if (compat.length > 0 && !seen.has(key)) {
        seen.add(key)
        hints.push({
          chain:         [a.id, b.id],
          labels:        [a.name, b.name],
          compatible_on: compat,
          combined_score: (((a.composite_score ?? 0) + (b.composite_score ?? 0)) / 2).toFixed(1),
        })
      }
    }
  }

  return hints
}
