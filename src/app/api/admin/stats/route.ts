export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRBAC } from "@/lib/rbac"

async function requireAdmin(supabase: any, userId: string) {
  const rbac = await getRBAC(supabase, userId)
  return rbac.isAdmin
}

/**
 * GET /api/admin/stats
 * Returns platform-wide statistics for the admin dashboard.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!await requireAdmin(supabase, user.id))
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const [
      { count: totalUsers },
      { count: totalAgents },
      { count: pendingAgents },
      { count: totalExecutions },
      { data: revenueData },
      { data: platformData },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      supabase.from("executions").select("*", { count: "exact", head: true }),
      supabase.from("transactions").select("amount, platform_fee").eq("status", "succeeded"),
      supabase.from("profiles").select("total_earned").order("total_earned", { ascending: false }).limit(1),
    ])

    const totalRevenue  = (revenueData ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)
    const platformEarned= (revenueData ?? []).reduce((s: number, r: any) => s + (r.platform_fee ?? 0), 0)

    return NextResponse.json({
      totalUsers:      totalUsers   ?? 0,
      totalAgents:     totalAgents  ?? 0,
      pendingAgents:   pendingAgents ?? 0,
      totalExecutions: totalExecutions ?? 0,
      totalRevenue,
      platformEarned,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
