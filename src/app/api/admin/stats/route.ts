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

    const admin = createAdminClient()

    const [
      { count: totalUsers },
      { count: totalAgents },
      { count: pendingAgents },
      { count: totalExecutions },
      { data: revenue },
      { count: flaggedCount },
    ] = await Promise.all([
      admin.from("profiles")     .select("*", { count: "exact", head: true }),
      admin.from("agents")       .select("*", { count: "exact", head: true }),
      admin.from("agents")       .select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      admin.from("executions")   .select("*", { count: "exact", head: true }),
      admin.from("transactions") .select("amount").eq("status", "succeeded"),
      admin.from("injection_attempts").select("*", { count: "exact", head: true }),
    ])

    const totalRevenue   = (revenue ?? []).reduce((s: number, t: any) => s + Number(t.amount), 0)
    const platformEarned = totalRevenue * 0.20

    return NextResponse.json({
      totalUsers:      totalUsers      ?? 0,
      totalAgents:     totalAgents     ?? 0,
      pendingAgents:   pendingAgents   ?? 0,
      totalExecutions: totalExecutions ?? 0,
      totalRevenue,
      platformEarned,
      flaggedCount:    flaggedCount    ?? 0,
    })
  } catch (err: any) {
    console.error("GET /api/admin/stats:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
