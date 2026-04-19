export const runtime = "edge"
/**
 * GET /api/admin/stats
 * Platform-wide stats for the admin dashboard header.
 * Uses service role (createAdminClient) — bypasses RLS for accurate counts.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildRBAC } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited
  try {
    const anonClient = await createClient()
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const adminDb = await createAdminClient()
    const { data: p } = await adminDb.from("profiles").select("role").eq("id", user.id).single()
    if (!buildRBAC(user.id, p?.role).isAdmin)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const [
      { count: totalUsers },
      { count: totalAgents },
      { count: pendingAgents },
      { count: totalExecutions },
      { data: revenue },
    ] = await Promise.all([
      adminDb.from("profiles")  .select("*", { count: "exact", head: true }),
      adminDb.from("agents")    .select("*", { count: "exact", head: true }),
      adminDb.from("agents")    .select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      adminDb.from("executions").select("*", { count: "exact", head: true }),
      adminDb.from("transactions").select("amount, platform_fee").eq("status", "succeeded"),
    ])

    const totalRevenue   = (revenue ?? []).reduce((s, t: any) => s + Number(t.amount), 0)
    const platformEarned = (revenue ?? []).reduce((s, t: any) => s + Number(t.platform_fee ?? 0), 0)
      || totalRevenue * 0.20

    return NextResponse.json({
      totalUsers:      totalUsers      ?? 0,
      totalAgents:     totalAgents     ?? 0,
      pendingAgents:   pendingAgents   ?? 0,
      totalExecutions: totalExecutions ?? 0,
      totalRevenue,
      platformEarned,
    })
  } catch (err: any) {
    console.error("GET /api/admin/stats:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}
