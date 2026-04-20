export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit"

// ── Validation constants ─────────────────────────────────────────────────────
// Lowercase alphanumeric, hyphens, underscores — safe for machine consumption
const TAG_RE   = /^[a-z0-9_-]{1,50}$/
const MAX_TAGS = 20

// ── GET /api/agents/[id] ─────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    // Validate UUID format before hitting the DB (prevents injection probing)
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    // Allow: active agents (public) OR the seller viewing their own agent (any status)
    const { data: agent, error } = await supabase
    .from("agents")
    .select(
      `*, profiles!seller_id(id, full_name, username, avatar_url, bio, is_verified, total_earned)`
    )
    .eq("id", id)
    .single()

    if (error || !agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Gate: only active agents are public; non-active only visible to their seller
    const { data: { user } } = await supabase.auth.getUser()
    if (agent.status !== "active" && agent.seller_id !== user?.id) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    return NextResponse.json(agent)
  } catch (err: any) {
    console.error("GET /api/agents/[id]:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ── PATCH /api/agents/[id] ───────────────────────────────────────────────────
// Seller-only: update capability_tags for machine-to-machine discovery.
// Only capability_tags is exposed — all other mutations go through /builder.
// Strict rate-limit (10/min) to prevent tag-stuffing abuse.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Stricter limit for mutations
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const { id } = await params
    const supabase = await createClient()

    // Auth: session cookie only — no API-key mutations (reduces attack surface)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Validate UUID
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    // Ownership check — must be the seller
    const { data: existing } = await supabase
      .from("agents")
      .select("seller_id")
      .eq("id", id)
      .single()

    if (!existing) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }
    if (existing.seller_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Parse body safely
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 })
    }

    const { capability_tags } = body as Record<string, unknown>

    // ── Validate capability_tags ─────────────────────────────────────────────
    if (!Array.isArray(capability_tags)) {
      return NextResponse.json({ error: "capability_tags must be an array of strings" }, { status: 400 })
    }

    if (capability_tags.length > MAX_TAGS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_TAGS} capability tags allowed` },
        { status: 400 }
      )
    }

    for (const tag of capability_tags) {
      if (typeof tag !== "string") {
        return NextResponse.json({ error: "Each tag must be a string" }, { status: 400 })
      }
      if (!TAG_RE.test(tag)) {
        return NextResponse.json(
          { error: `Invalid tag "${tag}". Tags must be lowercase, 1–50 chars, only a-z 0-9 - _` },
          { status: 400 }
        )
      }
    }

    // Deduplicate preserving order
    const seen = new Set<string>()
    const uniqueTags: string[] = []
    for (const t of capability_tags as string[]) {
      if (!seen.has(t)) { seen.add(t); uniqueTags.push(t) }
    }

    // Apply update
    const { data: updated, error } = await supabase
      .from("agents")
      .update({
        capability_tags: uniqueTags,
        updated_at:      new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, capability_tags, updated_at")
      .single()

    if (error) throw error

    return NextResponse.json(updated)

  } catch (err: any) {
    console.error("PATCH /api/agents/[id]:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
