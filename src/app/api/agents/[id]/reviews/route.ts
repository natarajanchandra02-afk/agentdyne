export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    const { searchParams } = new URL(req.url)
    const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"))
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20"))

    const { data, count, error } = await supabase
      .from("reviews")
      .select(
        `id, agent_id, user_id, rating, title, body, status, created_at,
         profiles!user_id(id, full_name, avatar_url)`,
        { count: "exact" }
      )
      .eq("agent_id", id)
      .eq("status",   "approved")
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (error) throw error

    const total = count ?? 0
    const pages = Math.ceil(total / limit)

    return NextResponse.json({
      data: data ?? [],
      pagination: { total, page, limit, pages, hasNext: page < pages, hasPrev: page > 1 },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const { rating, title, body: reviewBody } = body

    if (!rating || typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating must be an integer between 1 and 5" }, { status: 400 })
    }

    const { data: agent } = await supabase
      .from("agents").select("id, status").eq("id", id).single()
    if (!agent || agent.status !== "active") {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    const { count: execCount } = await supabase
      .from("executions")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", id)
      .eq("user_id",  user.id)
      .eq("status",   "success")

    if (!execCount || execCount === 0) {
      return NextResponse.json(
        { error: "You must successfully execute this agent before posting a review." },
        { status: 403 }
      )
    }

    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("agent_id", id)
      .eq("user_id",  user.id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: "You have already reviewed this agent." }, { status: 409 })
    }

    const { data: review, error: insertErr } = await supabase
      .from("reviews")
      .insert({
        agent_id: id,
        user_id:  user.id,
        rating,
        title:    title      ?? null,
        body:     reviewBody ?? null,
        status:   "pending",
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json(review, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
