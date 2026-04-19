export const runtime = 'edge'

/**
 * /api/memory — Agent persistent memory CRUD
 *
 * Agents can read/write per-user KV memory that persists across sessions.
 * Maps to the `agent_memory` table (user_id, agent_id, key, value, ttl_at).
 *
 * Used by agents with long-term context (preferences, conversation history,
 * task state, learned facts about a user).
 *
 * Auth: session cookie OR API key header.
 * Scoped: each entry is (user_id, agent_id, key) — fully isolated per user per agent.
 *
 * GET    /api/memory?agent_id=<id>&key=<k>   → get one key or all keys for agent
 * POST   /api/memory                          → set / upsert a key
 * DELETE /api/memory?agent_id=<id>&key=<k>   → delete one key
 * DELETE /api/memory?agent_id=<id>            → clear all memory for an agent
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_KEY_LEN   = 128
const MAX_VALUE_LEN = 10_000  // 10KB per memory value

async function resolveUserId(req: NextRequest, supabase: any): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.id) return user.id

  const rawKey =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-api-key")
  if (!rawKey || rawKey.length > 200) return null

  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
  const { data: keyRow } = await supabase.from("api_keys").select("user_id, is_active").eq("key_hash", hash).single()
  return keyRow?.is_active ? keyRow.user_id : null
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const userId   = await resolveUserId(req, supabase)
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get("agent_id")
    const key     = searchParams.get("key")

    if (!agentId || !UUID_RE.test(agentId))
      return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

    // Purge expired entries for this user + agent first (fire-and-forget)
    supabase.from("agent_memory")
      .delete()
      .eq("user_id", userId)
      .eq("agent_id", agentId)
      .lt("ttl_at", new Date().toISOString())
      .not("ttl_at", "is", null)
      .then(() => {})

    if (key) {
      // Get specific key
      if (key.length > MAX_KEY_LEN)
        return NextResponse.json({ error: `key too long (max ${MAX_KEY_LEN} chars)` }, { status: 400 })

      const { data, error } = await supabase
        .from("agent_memory")
        .select("key, value, ttl_at, updated_at")
        .eq("user_id",  userId)
        .eq("agent_id", agentId)
        .eq("key",      key)
        .gt("ttl_at", new Date().toISOString())  // exclude expired (OR no TTL)
        .or("ttl_at.is.null")
        .single()

      if (error && error.code !== "PGRST116")  // PGRST116 = no rows
        throw error

      return NextResponse.json({ key, value: data?.value ?? null, found: !!data, updated_at: data?.updated_at })
    }

    // Get all keys for this agent (no key specified)
    const { data, error } = await supabase
      .from("agent_memory")
      .select("key, value, ttl_at, updated_at")
      .eq("user_id",  userId)
      .eq("agent_id", agentId)
      .or(`ttl_at.is.null,ttl_at.gt.${new Date().toISOString()}`)
      .order("updated_at", { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({
      agent_id: agentId,
      entries:  data ?? [],
      count:    data?.length ?? 0,
    })

  } catch (err: any) {
    console.error("GET /api/memory:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const userId   = await resolveUserId(req, supabase)
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { agent_id, key, value, ttl_seconds } = body

    if (!agent_id || !UUID_RE.test(agent_id))
      return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

    if (!key || typeof key !== "string" || key.length === 0)
      return NextResponse.json({ error: "key is required (string)" }, { status: 400 })

    if (key.length > MAX_KEY_LEN)
      return NextResponse.json({ error: `key too long (max ${MAX_KEY_LEN} chars)` }, { status: 400 })

    if (value === undefined)
      return NextResponse.json({ error: "value is required" }, { status: 400 })

    const valueStr = typeof value === "string" ? value : JSON.stringify(value)
    if (valueStr.length > MAX_VALUE_LEN)
      return NextResponse.json({ error: `value too large (max ${MAX_VALUE_LEN} chars)` }, { status: 413 })

    // Validate TTL
    let ttlAt: string | null = null
    if (ttl_seconds !== undefined) {
      const secs = parseInt(String(ttl_seconds))
      if (isNaN(secs) || secs < 1 || secs > 86400 * 365)
        return NextResponse.json({ error: "ttl_seconds must be 1–31536000" }, { status: 400 })
      ttlAt = new Date(Date.now() + secs * 1000).toISOString()
    }

    // Verify agent exists (basic ownership / existence check)
    const { data: agent } = await supabase
      .from("agents")
      .select("id, status")
      .eq("id", agent_id)
      .single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    // Upsert memory entry
    const { data: entry, error } = await supabase
      .from("agent_memory")
      .upsert({
        user_id:    userId,
        agent_id,
        key,
        value:      typeof value === "string" ? { raw: value } : value,
        ttl_at:     ttlAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,agent_id,key" })
      .select("key, value, ttl_at, updated_at")
      .single()

    if (error) throw error

    return NextResponse.json({
      ok:         true,
      key:        entry.key,
      ttl_at:     entry.ttl_at,
      updated_at: entry.updated_at,
    }, { status: 200 })

  } catch (err: any) {
    console.error("POST /api/memory:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const userId   = await resolveUserId(req, supabase)
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get("agent_id")
    const key     = searchParams.get("key")

    if (!agentId || !UUID_RE.test(agentId))
      return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

    let query = supabase
      .from("agent_memory")
      .delete()
      .eq("user_id",  userId)
      .eq("agent_id", agentId)

    if (key) query = query.eq("key", key) as typeof query

    const { error, count } = await query.select()
    if (error) throw error

    return NextResponse.json({
      ok:      true,
      deleted: count ?? 0,
      scope:   key ? "key" : "all",
    })

  } catch (err: any) {
    console.error("DELETE /api/memory:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
