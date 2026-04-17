export const runtime = 'edge'

/**
 * GET /api/registry/search
 *
 * Machine-readable Agent Registry — capability-based agent discovery.
 *
 * This is the formal system-facing registry that the Agent Graph Engine,
 * Evaluation Engine, and Autonomous Planner use internally. It is built
 * on the agent_capabilities view (already exists in migration 008) and
 * agent_registry_versions (already exists in the live DB schema).
 *
 * The /api/discover endpoint serves external AI tool manifests.
 * This endpoint serves structured routing queries with preference weighting.
 *
 * Query params:
 *   capability    — required capability tag (e.g. "summarize", "classify")
 *   capabilities  — comma-separated list, AND logic (agent must have ALL)
 *   input_type    — required input type ("text", "json", "url", "code")
 *   output_type   — required output type
 *   category      — agent category filter
 *   max_cost      — max price_per_call in USD (default 999)
 *   min_score     — minimum composite_score 0–100 (default 0)
 *   prefer        — "accuracy" | "speed" | "cost" | "balanced" (default)
 *   has_rag       — "true" to require agents with a knowledge base
 *   limit         — max 50, default 10
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase         = await createClient()
    const { searchParams } = new URL(req.url)

    // Single capability shorthand
    const capability      = searchParams.get("capability")
    const capabilitiesCsv = searchParams.get("capabilities")
    const capabilities    = capabilitiesCsv
      ? capabilitiesCsv.split(",").map(s => s.trim()).filter(Boolean)
      : capability
      ? [capability]
      : null

    const inputType  = searchParams.get("input_type")
    const outputType = searchParams.get("output_type")
    const category   = searchParams.get("category")
    const maxCost    = parseFloat(searchParams.get("max_cost")  || "999")
    const minScore   = parseFloat(searchParams.get("min_score") || "0")
    const prefer     = searchParams.get("prefer") || "balanced"
    const hasRag     = searchParams.get("has_rag") === "true"
    const limit      = Math.min(50, parseInt(searchParams.get("limit") || "10"))

    // Map preference to sort column
    const sortCol = (
      prefer === "accuracy" ? "accuracy_score" :
      prefer === "speed"    ? "latency_score"  :
      prefer === "cost"     ? "cost_score"      :
                              "composite_score"
    )

    // Query from agent_capabilities view (created in migration 008)
    let query = supabase
      .from("agent_capabilities")
      .select("*")
      .gte("composite_score", minScore)
      .lte("price_per_call",  maxCost)
      .order(sortCol, { ascending: false })
      .limit(limit)

    if (category)   query = query.eq("category", category)              as typeof query
    if (inputType)  query = query.contains("input_types",    [inputType])  as typeof query
    if (outputType) query = query.contains("output_types",   [outputType]) as typeof query

    // AND-filter all capability tags
    if (capabilities) {
      for (const cap of capabilities) {
        query = query.contains("capability_tags", [cap]) as typeof query
      }
    }

    const { data, error } = await query
    if (error) throw error

    const agents = data ?? []

    // Build capability index: which capabilities are covered by which agents
    const capabilityIndex: Record<string, string[]> = {}
    for (const a of agents) {
      for (const cap of (a.capability_tags ?? [])) {
        if (!capabilityIndex[cap]) capabilityIndex[cap] = []
        capabilityIndex[cap].push(a.id)
      }
    }

    // Suggest natural agent chains based on output→input compatibility
    const chainSuggestions: any[] = []
    outer: for (const a of agents) {
      for (const b of agents) {
        if (a.id === b.id) continue
        const overlap = (a.output_types ?? []).filter((t: string) => (b.input_types ?? []).includes(t))
        if (overlap.length > 0) {
          chainSuggestions.push({
            chain:          [a.id, b.id],
            names:          [a.name, b.name],
            compatible_on:  overlap,
            combined_score: +(((a.composite_score ?? 0) + (b.composite_score ?? 0)) / 2).toFixed(1),
          })
          if (chainSuggestions.length >= 5) break outer
        }
      }
    }

    return NextResponse.json({
      registry_version:  "2.0",
      api_base:          "https://agentdyne.com",
      query: {
        capabilities, input_type: inputType, output_type: outputType,
        category, max_cost: maxCost, min_score: minScore, prefer, has_rag: hasRag,
      },
      count:  agents.length,
      agents: agents.map(a => ({
        id:          a.id,
        name:        a.name,
        slug:        a.slug,
        description: a.description,
        category:    a.category,
        schema: {
          input_types:  a.input_types  ?? ["text"],
          output_types: a.output_types ?? ["text"],
        },
        capabilities:    a.capability_tags  ?? [],
        compliance_tags: a.compliance_tags  ?? [],
        has_rag:         !!a.knowledge_base_id,
        quality: {
          composite: a.composite_score ?? 0,
          accuracy:  a.accuracy_score  ?? 0,
          latency:   a.latency_score   ?? 0,
          cost:      a.cost_score      ?? 0,
          grade:     scoreToGrade(a.composite_score ?? 0),
        },
        economics: {
          model:          a.pricing_model,
          price_per_call: a.price_per_call,
          monthly_usd:    a.subscription_price_monthly,
          free_calls:     a.free_calls_per_month,
        },
        performance: {
          avg_latency_ms: a.average_latency_ms,
          model_name:     a.model_name,
        },
        endpoints: {
          execute:  `/api/agents/${a.id}/execute`,
          registry: `/api/registry/${a.id}`,
          detail:   `/marketplace/${a.id}`,
        },
      })),
      capability_index:  capabilityIndex,
      chain_suggestions: chainSuggestions,
    })
  } catch (err: any) {
    console.error("GET /api/registry/search:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function scoreToGrade(score: number): string {
  if (score >= 90) return "S"
  if (score >= 80) return "A"
  if (score >= 70) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}
