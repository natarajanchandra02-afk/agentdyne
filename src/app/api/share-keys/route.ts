export const runtime = "edge"

/**
 * /api/share-keys
 *
 * GET  — list all share keys owned by the user
 * POST — create a new share key for a pipeline
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

// ── GET /api/share-keys ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const pipelineId = searchParams.get("pipeline_id")

    let query = supabase
      .from("pipeline_share_keys")
      .select("*, pipelines(name)")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })

    if (pipelineId) query = query.eq("pipeline_id", pipelineId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ share_keys: data ?? [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST /api/share-keys ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { pipeline_id, share_key, name, description, allow_execute, daily_limit } = body as any

    if (!pipeline_id || !/^[0-9a-f-]{36}$/i.test(pipeline_id))
      return NextResponse.json({ error: "Valid pipeline_id required" }, { status: 400 })

    if (!share_key || typeof share_key !== "string" || share_key.length < 6 || share_key.length > 64)
      return NextResponse.json({ error: "share_key must be 6–64 characters" }, { status: 400 })

    // Verify the user owns this pipeline
    const { data: pipeline } = await supabase
      .from("pipelines").select("id, name").eq("id", pipeline_id).eq("owner_id", user.id).single()

    if (!pipeline)
      return NextResponse.json({ error: "Pipeline not found or you do not own it" }, { status: 404 })

    // Check share key is not taken
    const { data: existing } = await supabase
      .from("pipeline_share_keys").select("id").eq("share_key", share_key).maybeSingle()

    if (existing)
      return NextResponse.json({ error: "This share key is already taken. Try a different one." }, { status: 409 })

    const { data: created, error } = await supabase
      .from("pipeline_share_keys")
      .insert({
        pipeline_id,
        owner_id:      user.id,
        share_key,
        name:          name          ?? `${pipeline.name} API`,
        description:   description   ?? null,
        allow_execute: allow_execute ?? true,
        daily_limit:   daily_limit   ?? 100,
        is_active:     true,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(created, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE /api/share-keys?id=xxx ─────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const id = new URL(req.url).searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const { error } = await supabase
      .from("pipeline_share_keys")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id)

    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
