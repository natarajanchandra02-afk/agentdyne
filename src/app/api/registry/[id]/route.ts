export const runtime = 'edge'

/**
 * GET /api/registry/[id]
 *
 * Returns the full registry entry for a single agent, including:
 *   - Schema (input/output types, capability tags)
 *   - Quality score breakdown
 *   - Version history (from agent_registry_versions table)
 *   - Economics & performance
 *   - MCP dependencies
 *   - Execution endpoint
 *
 * Used by:
 *   - Agent Graph Engine: validate a node before scheduling it
 *   - Planner Agent: inspect schema before composing pipelines
 *   - External developers: programmatic capability discovery
 *
 * Query params:
 *   version — specific version string (e.g. "1.2.0"). Omit for latest.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    const { searchParams }  = new URL(req.url)
    const requestedVersion  = searchParams.get("version")

    // Load agent with seller profile and score
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select(`
        *,
        profiles!seller_id(id, full_name, username, avatar_url, is_verified),
        agent_scores(*)
      `)
      .eq("id",     id)
      .eq("status", "active")
      .single()

    if (agentErr || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Optionally load a specific version snapshot
    let snapshot: any = null
    if (requestedVersion) {
      const { data: versionRow } = await supabase
        .from("agent_registry_versions")
        .select("snapshot, created_at, changelog")
        .eq("agent_id", id)
        .eq("version",  requestedVersion)
        .single()
      snapshot = versionRow
    }

    // Version history (last 10)
    const { data: versions } = await supabase
      .from("agent_registry_versions")
      .select("version, created_at, changelog")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(10)

    const score  = (agent as any).agent_scores?.[0] ?? null
    const seller = (agent as any).profiles ?? {}
    const src    = snapshot?.snapshot ?? agent   // use snapshot if specific version requested

    return NextResponse.json({
      // Identity
      id:          agent.id,
      name:        src.name        ?? agent.name,
      slug:        src.slug        ?? agent.slug,
      description: src.description ?? agent.description,
      category:    src.category    ?? agent.category,

      // Version
      version:           agent.version ?? "1.0.0",
      requested_version: requestedVersion ?? "latest",
      snapshot_date:     snapshot?.created_at ?? null,

      // Schema — critical for Graph Engine composition
      schema: {
        input:        agent.input_schema   ?? { type: "object" },
        output:       agent.output_schema  ?? { type: "object" },
        input_types:  agent.input_types    ?? ["text"],
        output_types: agent.output_types   ?? ["text"],
        languages:    agent.languages      ?? ["en"],
      },

      // Capabilities
      capabilities:    agent.capability_tags  ?? [],
      compliance_tags: agent.compliance_tags  ?? [],
      mcp_tools:       agent.mcp_server_ids   ?? [],
      has_rag:         !!agent.knowledge_base_id,

      // Quality
      quality: score ? {
        composite:    +Number(score.composite_score).toFixed(1),
        accuracy:     +Number(score.accuracy_score).toFixed(1),
        reliability:  +Number(score.reliability_score).toFixed(1),
        latency:      +Number(score.latency_score).toFixed(1),
        cost:         +Number(score.cost_score).toFixed(1),
        popularity:   +Number(score.popularity_score).toFixed(1),
        grade:        scoreToGrade(Number(score.composite_score)),
        badges: {
          top_rated:    score.is_top_rated,
          fastest:      score.is_fastest,
          cheapest:     score.is_cheapest,
          most_reliable:score.is_most_reliable,
        },
        ranks:       { category: score.category_rank, global: score.global_rank },
        sample_size: score.sample_size,
        computed_at: score.computed_at,
      } : {
        composite: 0, grade: "F",
        note: `Needs ${Math.max(0, 10 - (agent.total_executions ?? 0))} more executions to generate a score`,
      },

      // Economics
      economics: {
        pricing_model:        agent.pricing_model,
        price_per_call_usd:   agent.price_per_call,
        subscription_monthly: agent.subscription_price_monthly,
        free_calls_per_month: agent.free_calls_per_month,
      },

      // Performance
      performance: {
        avg_latency_ms:        agent.average_latency_ms,
        model_name:            agent.model_name,
        max_tokens:            agent.max_tokens,
        timeout_seconds:       agent.timeout_seconds,
        total_executions:      agent.total_executions,
        successful_executions: agent.successful_executions,
        success_rate: (agent.total_executions ?? 0) > 0
          ? +(((agent.successful_executions ?? 0) / (agent.total_executions ?? 1)) * 100).toFixed(1)
          : null,
      },

      // Seller
      seller: {
        id:          seller.id,
        name:        seller.full_name,
        username:    seller.username,
        avatar_url:  seller.avatar_url,
        is_verified: seller.is_verified,
      },

      // Version history
      version_history: (versions ?? []).map((v: any) => ({
        version:    v.version,
        published:  v.created_at,
        changelog:  v.changelog,
      })),

      // Execution endpoints
      endpoints: {
        execute:    `/api/agents/${id}/execute`,
        score:      `/api/agents/${id}/score`,
        reviews:    `/api/agents/${id}/reviews`,
        registry:   `/api/registry/${id}`,
        marketplace:`/marketplace/${id}`,
      },
    })
  } catch (err: any) {
    console.error("GET /api/registry/[id]:", err)
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
