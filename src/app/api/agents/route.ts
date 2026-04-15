export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { searchParams } = new URL(req.url)

    const q        = searchParams.get("q")
    const category = searchParams.get("category")
    const pricing  = searchParams.get("pricing")
    const sort     = searchParams.get("sort") || "popular"
    const page     = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit    = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "24")))

    let query = supabase
      .from("agents")
      .select(
        `id, seller_id, name, slug, description, long_description,
         category, tags, status, pricing_model, price_per_call,
         subscription_price_monthly, free_calls_per_month,
         model_name, average_rating, total_reviews, total_executions,
         successful_executions, average_latency_ms, total_revenue, composite_score,
         icon_url, version, is_featured, is_verified, created_at, updated_at,
         profiles!seller_id(id, full_name, username, avatar_url, is_verified)`,
        { count: "exact" }
      )
      .eq("status", "active")

    if (q)        query = query.textSearch("name", q, { type: "websearch", config: "english" })
    if (category) query = query.eq("category", category)
    if (pricing)  query = query.eq("pricing_model", pricing)

    switch (sort) {
      case "rating":  query = query.order("average_rating",   { ascending: false }); break
      case "newest":  query = query.order("created_at",       { ascending: false }); break
      case "revenue": query = query.order("total_revenue",    { ascending: false }); break
      default:        query = query.order("total_executions", { ascending: false }); break
    }

    query = query.range((page - 1) * limit, page * limit - 1)

    const { data, count, error } = await query
    if (error) throw error

    const total = count ?? 0
    const pages = Math.ceil(total / limit)

    return NextResponse.json({
      agents: data ?? [],
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
    })
  } catch (err: any) {
    console.error("GET /api/agents:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
