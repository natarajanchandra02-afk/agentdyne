export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id }   = await params
    const supabase = await createClient()

    const { data: agent, error } = await supabase
      .from("agents")
      .select(
        `*, profiles!seller_id(id, full_name, username, avatar_url, bio, is_verified, total_earned)`
      )
      .eq("id", id)
      .eq("status", "active")
      .single()

    if (error || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    return NextResponse.json(agent)
  } catch (err: any) {
    console.error("GET /api/agents/[id]:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
