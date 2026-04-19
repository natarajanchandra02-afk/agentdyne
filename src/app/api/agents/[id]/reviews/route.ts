export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit"

// Review field limits
const MAX_REVIEW_TITLE_LENGTH = 120
const MAX_REVIEW_BODY_LENGTH  = 2000

function sanitize(s: unknown): string {
  if (typeof s !== "string") return ""
  return s.replace(/\x00/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim()
}

// ── GET /api/agents/[id]/reviews ─────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 })
    }

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
    console.error("GET /api/agents/[id]/reviews:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── POST /api/agents/[id]/reviews ────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    // Auth required
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // Validate agent ID format
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 })
    }

    // Parse body
    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { rating, title, body: reviewBody } = body

    // Validate rating
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 || rating > 5
    ) {
      return NextResponse.json(
        { error: "rating must be an integer between 1 and 5" },
        { status: 400 }
      )
    }

    // Sanitize + validate optional text fields
    const cleanTitle = sanitize(title)
    const cleanBody  = sanitize(reviewBody)

    if (cleanTitle.length > MAX_REVIEW_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Review title must be ${MAX_REVIEW_TITLE_LENGTH} characters or fewer` },
        { status: 400 }
      )
    }

    if (cleanBody.length > MAX_REVIEW_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Review body must be ${MAX_REVIEW_BODY_LENGTH} characters or fewer` },
        { status: 400 }
      )
    }

    // Verify agent is active
    const { data: agent } = await supabase
      .from("agents")
      .select("id, status")
      .eq("id", id)
      .single()

    if (!agent || agent.status !== "active") {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Users may not review their own agents
    const { data: ownedAgent } = await supabase
      .from("agents")
      .select("id")
      .eq("id", id)
      .eq("seller_id", user.id)
      .maybeSingle()

    if (ownedAgent) {
      return NextResponse.json({ error: "You cannot review your own agent" }, { status: 403 })
    }

    // Require at least one successful execution before reviewing
    const { count: execCount } = await supabase
      .from("executions")
      .select("*", { count: "exact", head: true })
      .eq("agent_id", id)
      .eq("user_id",  user.id)
      .eq("status",   "success")

    if (!execCount || execCount === 0) {
      return NextResponse.json(
        { error: "You must successfully run this agent before posting a review" },
        { status: 403 }
      )
    }

    // One review per user per agent
    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("agent_id", id)
      .eq("user_id",  user.id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: "You have already reviewed this agent" },
        { status: 409 }
      )
    }

    // Insert review — starts as "pending" (requires admin approval)
    const { data: review, error: insertErr } = await supabase
      .from("reviews")
      .insert({
        agent_id: id,
        user_id:  user.id,
        rating,
        title:    cleanTitle || null,
        body:     cleanBody  || null,
        status:   "pending",
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    return NextResponse.json(review, { status: 201 })
  } catch (err: any) {
    console.error("POST /api/agents/[id]/reviews:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
