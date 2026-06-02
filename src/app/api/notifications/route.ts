export const runtime = "edge"

/**
 * GET   /api/notifications         — list recent notifications (newest first)
 * PATCH /api/notifications         — mark all as read
 * POST  /api/notifications         — create a notification (internal use)
 *
 * Supports: is_read, read_at columns. Returns unread_count for the bell badge.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(req.url)
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20"))
    const unreadOnly = url.searchParams.get("unread") === "1"

    let query = supabase
      .from("notifications")
      .select("id, type, title, body, is_read, read_at, action_url, channel, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (unreadOnly) query = query.eq("is_read", false)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const notifications = data ?? []
    const unread_count  = notifications.filter(n => !n.is_read).length

    return NextResponse.json({ notifications, unread_count })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const now = new Date().toISOString()
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: now })
      .eq("user_id", user.id)
      .eq("is_read", false)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, read_at: now })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // Internal use only — authenticated by service role header
    const serviceKey = req.headers.get("x-service-key")
    const expected   = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!expected || serviceKey !== expected) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body?.user_id || !body?.type || !body?.title) {
      return NextResponse.json({ error: "user_id, type, title required" }, { status: 400 })
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("notifications")
      .insert({
        user_id:    body.user_id,
        type:       body.type,
        title:      body.title,
        body:       body.body   ?? null,
        action_url: body.action_url ?? null,
        channel:    body.channel ?? "in_app",
        is_read:    false,
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ notification_id: data?.id }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
