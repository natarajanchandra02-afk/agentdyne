export const runtime = "edge"

/**
 * POST /api/share-keys
 *
 * Creates a pipeline share key — a unique token that lets anyone
 * execute a specific pipeline via /api/run/[key] without needing an account.
 *
 * Rate: 10 keys per user per day (prevent abuse / key farming).
 * All executions via share key are billed to the pipeline owner.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { strictRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: {
      pipeline_id:   string
      share_key?:    string
      name?:         string
      description?:  string
      allow_execute?: boolean
      daily_limit?:  number
    }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { pipeline_id, share_key, name, description, allow_execute = true, daily_limit = 100 } = body

    // Validate pipeline_id
    if (!pipeline_id || !UUID_RE.test(pipeline_id))
      return NextResponse.json({ error: "Invalid pipeline_id" }, { status: 400 })

    // Verify pipeline ownership
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("id, owner_id, name")
      .eq("id", pipeline_id)
      .single()

    if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (pipeline.owner_id !== user.id)
      return NextResponse.json({ error: "You don't own this pipeline" }, { status: 403 })

    // Check user hasn't created too many keys today
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: keyCount } = await supabase
      .from("pipeline_share_keys")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .gte("created_at", dayAgo)

    if ((keyCount ?? 0) >= 10)
      return NextResponse.json({ error: "Rate limit: max 10 share keys per day" }, { status: 429 })

    // Generate or use provided share key
    const finalKey = share_key && /^[a-zA-Z0-9_-]{6,32}$/.test(share_key)
      ? share_key
      : (() => {
          const buf = new Uint8Array(8)
          crypto.getRandomValues(buf)
          return Array.from(buf).map(b => b.toString(36)).join("").slice(0, 12)
        })()

    const { data: created, error } = await supabase
      .from("pipeline_share_keys")
      .insert({
        pipeline_id,
        owner_id:    user.id,
        share_key:   finalKey,
        name:        name ?? `${pipeline.name} (shared)`,
        description: description ?? null,
        allow_execute,
        daily_limit: Math.min(Math.max(1, daily_limit), 10_000),
        is_active:   true,
      })
      .select()
      .single()

    if (error) {
      // Handle duplicate key (rare but possible)
      if (error.code === "23505")
        return NextResponse.json({ error: "Share key already exists — try again" }, { status: 409 })
      throw error
    }

    return NextResponse.json({
      id:          created.id,
      share_key:   created.share_key,
      pipeline_id: created.pipeline_id,
      endpoint:    `${req.nextUrl.origin}/api/run/${created.share_key}`,
      daily_limit: created.daily_limit,
    }, { status: 201 })

  } catch (err: any) {
    console.error("POST /api/share-keys:", err)
    return NextResponse.json({ error: "Failed to create share key" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { data: keys, error } = await supabase
      .from("pipeline_share_keys")
      .select("id, pipeline_id, share_key, name, description, is_active, allow_execute, daily_limit, total_uses, executions_today, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })

    if (error) throw error

    return NextResponse.json({ data: keys ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
