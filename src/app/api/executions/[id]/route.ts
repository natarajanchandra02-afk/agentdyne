export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user?.id) return user.id

  const rawKey =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-api-key")
  if (!rawKey) return null

  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
  const hash = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0")).join("")

  const { data: keyRow } = await supabase
    .from("api_keys").select("user_id, is_active").eq("key_hash", hash).single()

  if (!keyRow?.is_active) return null
  return keyRow.user_id
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }  = await params
    const userId  = await resolveUserId(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = await createClient()

    const { data: execution, error } = await supabase
      .from("executions")
      .select(
        `id, agent_id, user_id, status, input, output, error_message,
         tokens_input, tokens_output, latency_ms, cost, created_at, completed_at,
         agents!agent_id(id, name, icon_url)`
      )
      .eq("id",      id)
      .eq("user_id", userId)
      .single()

    if (error || !execution) {
      return NextResponse.json({ error: "Execution not found" }, { status: 404 })
    }

    return NextResponse.json(execution)
  } catch (err: any) {
    console.error("GET /api/executions/[id]:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
