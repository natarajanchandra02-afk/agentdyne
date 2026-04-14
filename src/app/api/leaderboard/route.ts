export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/leaderboard
 * Returns ranked agents by composite quality score.
 *
 * Query params:
 *   category  - filter by agent category
 *   limit     - default 20, max 100
 *   page      - pagination
 *   badge     - filter: top_rated | fastest | cheapest | most_reliable
 */
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase       = await createClient()
    const { searchParams } = new URL(req.url)

    const category = searchParams.get("category")
    const badge    = searchParams.get("badge")
    const page     = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit    = Math.min(100, parseInt(searchParams.get("limit") || "20"))

    let query = supabase
      .from("agent_leaderboard")
      .select("*", { count: "exact" })

    if (category) query = query.eq("category", category) as typeof query
    if (badge === "top_rated")    query = query.eq("is_top_rated",     true) as typeof query
    if (badge === "fastest")      query = query.eq("is_fastest",       true) as typeof query
    if (badge === "cheapest")     query = query.eq("is_cheapest",      true) as typeof query
    if (badge === "most_reliable")query = query.eq("is_most_reliable", true) as typeof query

    query = query
      .order("composite_score", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    const { data, count, error } = await query
    if (error) throw error

    const total = count ?? 0
    const pages = Math.ceil(total / limit)

    return NextResponse.json({
      data: data ?? [],
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
      meta: {
        description: "Agent quality rankings based on accuracy, reliability, speed, cost efficiency, and adoption.",
        scoring_weights: {
          accuracy:    "30%",
          reliability: "25%",
          latency:     "20%",
          cost:        "15%",
          popularity:  "10%",
        },
        updated: "Every 24h via automated benchmarking",
      },
    })
  } catch (err: any) {
    console.error("GET /api/leaderboard:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
