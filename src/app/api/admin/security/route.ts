export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRBAC }           from "@/lib/rbac"

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"))

    const admin = createAdminClient()

    const { data: attempts, error: dbErr } = await admin
      .from("injection_attempts")
      .select("id, user_id, agent_id, input, pattern, score, action, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

    return NextResponse.json({ attempts: attempts ?? [], count: attempts?.length ?? 0 })
  } catch (err: any) {
    console.error("GET /api/admin/security:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
