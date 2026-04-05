import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/agents/[id] — single agent details
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("agents")
      .select("*, profiles!seller_id(full_name, username, avatar_url, is_verified, bio)")
      .eq("id", params.id)
      .eq("status", "active")
      .single()

    if (error || !data) return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    return NextResponse.json({ agent: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
