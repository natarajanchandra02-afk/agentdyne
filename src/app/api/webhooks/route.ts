export const runtime = "edge"

/**
 * GET  /api/webhooks         — list user webhooks
 * POST /api/webhooks         — create webhook (P2)
 *
 * Enables user-configurable outbound HTTP POSTs on execution events.
 * HMAC-SHA256 signed payloads. Stripe webhook pattern.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

async function generateSecret(): Promise<string> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return "whsec_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("webhooks")
    .select("id, url, events, is_active, secret, last_triggered_at, failure_count, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhooks: data ?? [] })
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const { url, events } = body as { url?: string; events?: string[] }

  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "url is required" }, { status: 400 })
  if (!url.startsWith("https://"))
    return NextResponse.json({ error: "url must use HTTPS" }, { status: 400 })
  if (!Array.isArray(events) || events.length === 0)
    return NextResponse.json({ error: "at least one event is required" }, { status: 400 })

  // Enforce limit: max 10 webhooks per user
  const { count } = await supabase
    .from("webhooks").select("id", { count: "exact", head: true }).eq("user_id", user.id)
  if ((count ?? 0) >= 10)
    return NextResponse.json({ error: "Maximum 10 webhooks per account" }, { status: 400 })

  const secret = await generateSecret()

  const { data: webhook, error: insertErr } = await supabase
    .from("webhooks")
    .insert({
      user_id:      user.id,
      url:          url.trim(),
      events,
      is_active:    true,
      secret,
      failure_count: 0,
      created_at:   new Date().toISOString(),
    })
    .select("id, url, events, is_active, secret, last_triggered_at, failure_count, created_at")
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ webhook }, { status: 201 })
}
