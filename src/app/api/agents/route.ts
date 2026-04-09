export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = createClient()
    const { searchParams } = new URL(req.url)

    const q        = searchParams.get("q")
    const category = searchParams.get("category")
    const pricing  = searchParams.get("pricing")
    const sort     = searchParams.get("sort") || "popular"
    const page     = parseInt(searchParams.get("page") || "1")
    const limit    = Math.min(parseInt(searchParams.get("limit") || "24"), 100)

    let query = supabase
      .from("agents")
      .select("id, name, slug, description, category, tags, pricing_model, price_per_call, subscription_price_monthly, free_calls_per_month, average_rating, total_reviews, total_executions, average_latency_ms, icon_url, is_featured, is_verified, version, created_at, profiles!seller_id(full_name, username, avatar_url, is_verified)", { count: "exact" })
      .eq("status", "active")

    if (q)        query = query.textSearch("name", q, { type: "websearch", config: "english" })
    if (category) query = query.eq("category", category)
    if (pricing)  query = query.eq("pricing_model", pricing)

    if (sort === "popular")     query = query.order("total_executions", { ascending: false })
    else if (sort === "rating") query = query.order("average_rating",   { ascending: false })
    else if (sort === "newest") query = query.order("created_at",       { ascending: false })

    query = query.range((page - 1) * limit, page * limit - 1)

    const { data, count, error } = await query
    if (error) throw error

    return NextResponse.json({
      agents: data,
      pagination: { total: count, page, limit, pages: Math.ceil((count || 0) / limit) },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
