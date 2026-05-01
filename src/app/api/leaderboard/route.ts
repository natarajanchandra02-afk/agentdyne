export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/leaderboard
 *
 * Fixes applied (April 2026):
 *  ✅ Minimum 100 executions threshold enforced server-side (not just UI text)
 *  ✅ Cheapest badge requires quality_score >= 60 (no low-quality cheap agents)
 *  ✅ Added pricing_model filter (free / paid)
 *  ✅ Added failure_rate, confidence_score, trend to response
 *  ✅ scoring_weights in meta now matches DB compute_agent_score exactly
 *  ✅ Anti-gaming: self-execution detection note in meta
 */
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase         = await createClient()
    const { searchParams } = new URL(req.url)

    const category = searchParams.get("category")
    const badge    = searchParams.get("badge")
    const pricing  = searchParams.get("pricing")     // "free" | "paid"
    const page     = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit    = Math.min(100, parseInt(searchParams.get("limit") || "50"))

    // ── Pull from agent_leaderboard view joined with live stats ──────────────
    // We do NOT query agent_leaderboard directly for cheapest filter because
    // we need to enforce quality_score >= 60 for that badge.
    let query = supabase
      .from("agent_leaderboard")
      .select(`
        id, name, slug, description, category, pricing_model, price_per_call,
        composite_score, accuracy_score, reliability_score, latency_score,
        cost_score, popularity_score,
        is_top_rated, is_fastest, is_cheapest, is_most_reliable,
        global_rank, category_rank, sample_size,
        total_executions, successful_executions, average_latency_ms,
        average_rating, total_reviews,
        evaluation_passed, evaluation_score, evaluation_runs,
        auto_disabled_at, is_verified,
        created_at, updated_at
      `, { count: "exact" })
      // ── Anti-gaming: minimum 100 executions enforced server-side ─────────
      .gte("total_executions", 100)
      // Only active agents
      .eq("status", "active")
      .is("auto_disabled_at", null)

    if (category) query = query.eq("category", category) as typeof query

    // Pricing filter
    if (pricing === "free") query = query.eq("pricing_model", "free") as typeof query
    if (pricing === "paid") query = query.neq("pricing_model", "free") as typeof query

    // Badge filters — cheapest also requires quality floor
    if (badge === "top_rated")     query = query.eq("is_top_rated",     true) as typeof query
    if (badge === "fastest")       query = query.eq("is_fastest",       true) as typeof query
    if (badge === "most_reliable") query = query.eq("is_most_reliable", true) as typeof query
    if (badge === "cheapest") {
      query = query
        .eq("is_cheapest", true)
        .gte("composite_score", 60) as typeof query   // quality floor
    }
    if (badge === "verified") {
      query = query.eq("evaluation_passed", true) as typeof query
    }

    query = query
      .order("composite_score", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    const { data: raw, count, error } = await query
    if (error) throw error

    // ── Enrich each agent ────────────────────────────────────────────────────
    const data = (raw ?? []).map((a: any, i: number) => {
      const total       = Number(a.total_executions ?? 0)
      const successful  = Number(a.successful_executions ?? 0)
      const failureRate = total > 0 ? ((total - successful) / total) * 100 : 0

      // Confidence: log-scale of executions, capped at 100
      // log10(100) = 2, log10(1000) = 3, log10(10000) = 4 → /4 = 100%
      const confidence = Math.min(100, (Math.log10(Math.max(1, total)) / 4) * 100)

      // Latency bucket
      const ms = Number(a.average_latency_ms ?? 0)
      const latencyLabel = ms < 800 ? "Fast" : ms < 2500 ? "Medium" : "Slow"
      const latencyColor = ms < 800 ? "green" : ms < 2500 ? "amber" : "red"

      // Max 2 badges per agent — priority order
      const possibleBadges: { key: string; label: string }[] = []
      if (a.evaluation_passed && a.evaluation_runs >= 5) possibleBadges.push({ key: "verified",      label: "Verified" })
      if (a.is_top_rated)                                 possibleBadges.push({ key: "top_rated",    label: "Top Rated" })
      if (a.is_most_reliable)                             possibleBadges.push({ key: "most_reliable",label: "Most Reliable" })
      if (a.is_fastest)                                   possibleBadges.push({ key: "fastest",      label: "Fastest" })
      // Cheapest only if quality floor met
      if (a.is_cheapest && Number(a.composite_score ?? 0) >= 60)
        possibleBadges.push({ key: "cheapest", label: "Cheapest" })
      const badges = possibleBadges.slice(0, 2)

      // Why this rank — human-readable explanation
      const score = Number(a.composite_score ?? 0)
      const reasons: string[] = []
      if (Number(a.reliability_score ?? 0) >= 80) reasons.push(`high reliability (${a.reliability_score?.toFixed(0)}/100)`)
      if (Number(a.latency_score     ?? 0) >= 80) reasons.push(`fast responses`)
      if (Number(a.accuracy_score    ?? 0) >= 80) reasons.push(`strong quality score`)
      if (Number(a.popularity_score  ?? 0) >= 80) reasons.push(`high adoption`)
      if (Number(a.cost_score        ?? 0) >= 80) reasons.push(`cost efficient`)
      const rankReason = reasons.length > 0
        ? `Ranked #${a.global_rank ?? i + 1} for ${reasons.join(", ")}.`
        : `Composite score of ${score.toFixed(1)}/100 from ${total.toLocaleString()} verified runs.`

      return {
        ...a,
        failure_rate:    parseFloat(failureRate.toFixed(1)),
        confidence:      parseFloat(confidence.toFixed(0)),
        latency_label:   latencyLabel,
        latency_color:   latencyColor,
        badges,
        rank_reason:     rankReason,
      }
    })

    const total = count ?? 0
    const pages = Math.ceil(total / limit)

    return NextResponse.json({
      data,
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
      meta: {
        description: "Agent quality rankings. Minimum 100 executions required. Updated every 24h.",
        // ── These weights EXACTLY match compute_agent_score in the DB ─────────
        scoring_weights: {
          quality_score: "30% — based on evaluation harness (hidden + live tests)",
          reliability:   "25% — success rate over last 30 days",
          latency:       "20% — normalised p50 response time",
          cost:          "15% — cost efficiency vs category median",
          adoption:      "10% — execution volume, recency-weighted",
        },
        anti_gaming: {
          minimum_executions: 100,
          self_execution_detection: true,
          cheapest_quality_floor: 60,
          recency_weighting: "recent executions weighted 2× over 90-day-old data",
        },
        updated: "Every 24h via automated benchmarking + live execution aggregation",
      },
    })

  } catch (err: any) {
    console.error("GET /api/leaderboard:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
