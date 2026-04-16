export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/registry/[id]
 *
 * Full machine-readable schema for a specific agent.
 * Intended for:
 *   - Graph Engine node validation (does this agent accept my output?)
 *   - SDK client auto-configuration
 *   - Developer tooling / type generation
 *
 * Returns full input_schema + output_schema + capability metadata.
 * Different from /api/agents/[id] which is the marketplace-facing endpoint.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    const supabase = await createClient()

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    const { data: agent, error } = await supabase
      .from("agents")
      .select(`
        id, name, slug, description, long_description,
        category, tags, status, version,
        capability_tags, input_types, output_types, languages, compliance_tags,
        input_schema, output_schema,
        pricing_model, price_per_call, subscription_price_monthly, free_calls_per_month,
        model_name, average_latency_ms, average_rating, total_executions,
        composite_score, is_verified, created_at, updated_at,
        profiles!seller_id(id, full_name, username, is_verified)
      `)
      .eq("id",     id)
      .eq("status", "active")
      .single()

    if (error || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Fetch score details if available
    const { data: scores } = await supabase
      .from("agent_scores")
      .select("accuracy_score, latency_score, cost_score, reliability_score, popularity_score, global_rank, is_top_rated, is_fastest")
      .eq("agent_id", id)
      .single()

    // Fetch recent version snapshots from registry_versions table (if exists)
    const { data: versions } = await supabase
      .from("agent_registry_versions")
      .select("version, changelog, created_at")
      .eq("agent_id", id)
      .order("created_at", { ascending: false })
      .limit(5)

    const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"
    const seller  = (agent as any).profiles

    return NextResponse.json({
      schema_version: "1.1",
      id:             agent.id,
      name:           agent.name,
      slug:           agent.slug,
      description:    agent.description,
      long_description: agent.long_description,
      version:        agent.version ?? "1.0.0",
      status:         agent.status,
      is_verified:    agent.is_verified,

      // Capability metadata (machine-readable)
      capabilities: {
        tags:            (agent as any).capability_tags ?? [],
        input_types:     (agent as any).input_types     ?? ["text"],
        output_types:    (agent as any).output_types    ?? ["text"],
        languages:       (agent as any).languages       ?? ["en"],
        compliance_tags: (agent as any).compliance_tags ?? [],
        category:        agent.category,
      },

      // Schema (JSON Schema format for automatic validation)
      input_schema:  (agent as any).input_schema  ?? { type: "object", properties: { input: { type: "string" } } },
      output_schema: (agent as any).output_schema ?? { type: "object", properties: { output: { type: "string" } } },

      // Quality signals
      quality: {
        composite_score:   (agent as any).composite_score   ?? 0,
        accuracy_score:    scores?.accuracy_score   ?? null,
        latency_score:     scores?.latency_score    ?? null,
        cost_score:        scores?.cost_score       ?? null,
        reliability_score: scores?.reliability_score ?? null,
        global_rank:       scores?.global_rank      ?? null,
        is_top_rated:      scores?.is_top_rated     ?? false,
        is_fastest:        scores?.is_fastest        ?? false,
        total_executions:  agent.total_executions,
        average_rating:    agent.average_rating,
      },

      // Economics
      pricing: {
        model:             agent.pricing_model,
        price_per_call:    agent.price_per_call,
        monthly_usd:       agent.subscription_price_monthly,
        free_calls_per_month: agent.free_calls_per_month,
      },

      // Performance
      performance: {
        avg_latency_ms: agent.average_latency_ms,
        model:          agent.model_name,
      },

      // Seller
      seller: seller ? {
        id:          seller.id,
        name:        seller.full_name,
        username:    seller.username,
        is_verified: seller.is_verified,
      } : null,

      // Integration endpoints
      endpoints: {
        execute:    `${appBase}/api/agents/${agent.id}/execute`,
        marketplace:`${appBase}/marketplace/${agent.id}`,
        registry:   `${appBase}/api/registry/${agent.id}`,
      },

      // Version history
      versions: versions ?? [],

      // Timestamps
      created_at: agent.created_at,
      updated_at: agent.updated_at,
    })
  } catch (err: any) {
    console.error("GET /api/registry/[id]:", err)
    return NextResponse.json({ error: "Registry lookup failed" }, { status: 500 })
  }
}
