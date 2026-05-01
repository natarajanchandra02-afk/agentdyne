export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/agents/[id]/score
 * Returns the computed composite quality score for an agent.
 *
 * POST /api/agents/[id]/score
 * Triggers a score recomputation (auth required; rate-limited).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    const { data: score, error } = await supabase
      .from("agent_scores")
      .select("*")
      .eq("agent_id", id)
      .single()

    if (error || !score) {
      // Agent exists but not yet scored — needs ≥10 executions
      const { data: agent } = await supabase
        .from("agents")
        .select("id, total_executions, status")
        .eq("id", id)
        .single()

      if (!agent || agent.status !== "active") {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 })
      }

      return NextResponse.json({
        agent_id: id,
        composite_score: 0,
        scored: false,
        reason: agent.total_executions < 10
          ? `Needs ${10 - agent.total_executions} more executions to generate a score`
          : "Score not yet computed — will be ready within 24h",
        components: null,
      })
    }

    return NextResponse.json({
      agent_id:   id,
      composite_score: score.composite_score,
      scored:     true,
      grade:      scoreToGrade(score.composite_score),
      components: {
        accuracy:    { score: score.accuracy_score,    label: "Success Rate",      weight: "30%" },
        reliability: { score: score.reliability_score, label: "30-day Reliability", weight: "25%" },
        latency:     { score: score.latency_score,     label: "Speed",             weight: "20%" },
        cost:        { score: score.cost_score,        label: "Cost Efficiency",   weight: "15%" },
        popularity:  { score: score.popularity_score,  label: "Adoption",          weight: "10%" },
      },
      badges: {
        top_rated:   score.is_top_rated,
        fastest:     score.is_fastest,
        cheapest:    score.is_cheapest,
        most_reliable: score.is_most_reliable,
      },
      ranks: {
        category: score.category_rank,
        global:   score.global_rank,
      },
      sample_size:  score.sample_size,
      computed_at:  score.computed_at,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id }   = await params
    const supabase = await createClient()

    // Auth required to trigger recomputation
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Trigger via Postgres RPC
    const { data: newScore, error } = await supabase
      .rpc("compute_agent_score", { agent_id_param: id })

    if (error) throw error

    return NextResponse.json({
      agent_id: id,
      composite_score: newScore,
      message: "Score recomputed successfully",
    })
  } catch (err: any) {
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
