export const runtime = "edge"

/**
 * GET  /api/api-keys — list all active keys for the authenticated user
 * POST /api/api-keys — create a new API key
 *
 * Keys are stored as HMAC-SHA256(rawKey, HMAC_SECRET) — not plain SHA-256.
 * The raw key is shown ONCE on creation and never stored.
 * Only the prefix (first 8 chars) is stored for display.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient }              from "@/lib/supabase/server"
import { strictRateLimit }           from "@/lib/rate-limit"

const HMAC_SECRET = process.env.API_KEY_HMAC_SECRET ?? process.env.NEXTAUTH_SECRET ?? "agentdyne-default-secret"
const KEY_PREFIX  = "agd_"
const KEY_BYTES   = 32   // 256-bit key = 43-char base64url

async function hmacKey(rawKey: string): Promise<string> {
  const enc     = new TextEncoder()
  const keyMat  = await crypto.subtle.importKey("raw", enc.encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig     = await crypto.subtle.sign("HMAC", keyMat, enc.encode(rawKey))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
}

function generateRawKey(): string {
  const buf = new Uint8Array(KEY_BYTES)
  crypto.getRandomValues(buf)
  const b64 = btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
  return KEY_PREFIX + b64
}

// ── GET /api/api-keys ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: keys, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, permissions, is_active, last_used_at, expires_at, total_calls, created_at, rate_limit_per_minute, environment")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) throw error

    return NextResponse.json({ keys: keys ?? [], count: keys?.length ?? 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── POST /api/api-keys ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = await strictRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Starter+ plan required for API access
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan")
      .eq("id", user.id)
      .single()

    if (!profile || profile.subscription_plan === "free") {
      return NextResponse.json({
        error: "API access requires a Starter or Pro plan.",
        code:  "PLAN_RESTRICTION",
        upgrade: "/pricing",
      }, { status: 403 })
    }

    // Max 10 active keys per user
    const { count } = await supabase
      .from("api_keys")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true)

    if ((count ?? 0) >= 10) {
      return NextResponse.json({
        error: "Maximum of 10 active API keys allowed. Revoke an existing key first.",
        code:  "KEY_LIMIT_REACHED",
      }, { status: 422 })
    }

    let body: { name?: string; permissions?: string[]; expires_in_days?: number; environment?: string }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const name         = (body.name || "API Key").trim().slice(0, 80)
    const permissions  = Array.isArray(body.permissions) ? body.permissions.filter(p => ["execute","read","write"].includes(p)) : ["execute", "read"]
    const environment  = body.environment === "test" ? "test" : "production"
    const expiresInDays = typeof body.expires_in_days === "number" ? Math.min(365, Math.max(1, body.expires_in_days)) : 365

    const rawKey   = generateRawKey()
    const keyHash  = await hmacKey(rawKey)
    const prefix   = rawKey.slice(0, 12)   // "agd_" + first 8 chars of key
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString()

    const { data: key, error: insertErr } = await supabase
      .from("api_keys")
      .insert({
        user_id:             user.id,
        name,
        key_hash:            keyHash,
        key_prefix:          prefix,
        permissions,
        environment,
        expires_at:          expiresAt,
        is_active:           true,
        rate_limit_per_minute: 60,
        hash_algo:           "hmac-sha256",
      })
      .select("id, name, key_prefix, permissions, expires_at, created_at, environment")
      .single()

    if (insertErr) {
      console.error("POST /api/api-keys:", insertErr.message)
      return NextResponse.json({ error: "Failed to create API key." }, { status: 500 })
    }

    // Return the raw key ONCE — it is never stored and cannot be recovered
    return NextResponse.json({
      ...key,
      key:     rawKey,   // ← shown once only
      warning: "Copy this key now. It will not be shown again.",
    }, { status: 201 })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── DELETE /api/api-keys?id=<key_id> ──────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const keyId = new URL(req.url).searchParams.get("id")
    if (!keyId) return NextResponse.json({ error: "Key id required" }, { status: 400 })

    // Soft-delete: mark inactive (RLS ensures only own keys can be deleted)
    const { error } = await supabase
      .from("api_keys")
      .update({ is_active: false })
      .eq("id", keyId)
      .eq("user_id", user.id)  // belt-and-suspenders: even if RLS fails, user_id check protects

    if (error) throw error

    return NextResponse.json({ ok: true, revoked: keyId })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── PATCH /api/api-keys — update name / permissions ───────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: { id?: string; name?: string; permissions?: string[] }
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!body.id) return NextResponse.json({ error: "Key id required" }, { status: 400 })

    const updates: Record<string, unknown> = {}
    if (body.name)        updates.name        = body.name.trim().slice(0, 80)
    if (body.permissions) updates.permissions = body.permissions.filter(p => ["execute","read","write"].includes(p))

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const { data: key, error } = await supabase
      .from("api_keys")
      .update(updates)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id, name, key_prefix, permissions, expires_at, created_at")
      .single()

    if (error) throw error
    return NextResponse.json(key)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
