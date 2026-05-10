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

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const since1h  = new Date(Date.now() -      60 * 60 * 1000).toISOString()
    const sinceDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()

    const [
      todayExecResult,
      hourExecResult,
      topBurnUsersResult,
      topBurnAgentsResult,
      refundResult,
      creditWalletResult,
      hourlyBurnResult,
    ] = await Promise.all([
      // Today's execution costs
      admin.from("executions")
        .select("cost_usd, status, user_id, agent_id, created_at")
        .gte("created_at", sinceDay),

      // Last 1h executions
      admin.from("executions")
        .select("cost_usd, status, user_id")
        .gte("created_at", since1h),

      // Top burn users (last 24h by cost)
      admin.from("executions")
        .select("user_id, cost_usd, profiles!user_id(email, full_name)")
        .gte("created_at", since24h)
        .not("cost_usd", "is", null)
        .order("cost_usd", { ascending: false })
        .limit(200),

      // Top burn agents (last 24h)
      admin.from("executions")
        .select("agent_id, cost_usd, agents!agent_id(name)")
        .gte("created_at", since24h)
        .not("cost_usd", "is", null)
        .limit(500),

      // Refunds/failed executions
      admin.from("executions")
        .select("cost_usd, status")
        .gte("created_at", since24h)
        .eq("status", "failed"),

      // Credit wallet totals (profiles.credits_balance)
      admin.from("profiles")
        .select("id, email, full_name, total_spent, executions_used_this_month, subscription_plan")
        .order("total_spent", { ascending: false })
        .limit(20),

      // Hourly burn for sparkline (last 24h, grouped by hour)
      admin.from("executions")
        .select("cost_usd, created_at")
        .gte("created_at", since24h)
        .not("cost_usd", "is", null),
    ])

    const todayExecs = todayExecResult.data ?? []
    const hourExecs  = hourExecResult.data  ?? []

    // Aggregate today
    const consumedToday     = todayExecs.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const failedToday       = todayExecs.filter(e => e.status === "failed").length
    const consumedThisHour  = hourExecs.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const refundedToday     = (refundResult.data ?? []).reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)

    // Top burn users (aggregate by user_id)
    const userMap: Record<string, { cost: number; count: number; email: string; name: string }> = {}
    for (const e of (topBurnUsersResult.data ?? [])) {
      const id = e.user_id
      if (!userMap[id]) userMap[id] = { cost: 0, count: 0, email: (e as any).profiles?.email ?? "—", name: (e as any).profiles?.full_name ?? "—" }
      userMap[id].cost += Number(e.cost_usd ?? 0)
      userMap[id].count++
    }
    const topBurnUsers = Object.entries(userMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // Top burn agents
    const agentMap: Record<string, { cost: number; count: number; name: string }> = {}
    for (const e of (topBurnAgentsResult.data ?? [])) {
      const id = e.agent_id
      if (!agentMap[id]) agentMap[id] = { cost: 0, count: 0, name: (e as any).agents?.name ?? "—" }
      agentMap[id].cost += Number(e.cost_usd ?? 0)
      agentMap[id].count++
    }
    const topBurnAgents = Object.entries(agentMap)
      .map(([id, v]) => ({ id, ...v, avgCost: v.count ? v.cost / v.count : 0 }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // Hourly burn sparkline
    const hourlyMap: Record<number, number> = {}
    for (const e of (hourlyBurnResult.data ?? [])) {
      const h = new Date(e.created_at).getHours()
      hourlyMap[h] = (hourlyMap[h] ?? 0) + Number(e.cost_usd ?? 0)
    }
    const hourlyBurn = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      cost: Math.round((hourlyMap[i] ?? 0) * 10000) / 10000,
    }))

    // Alerts
    const alerts: { type: string; message: string; severity: "critical" | "warning" | "info" }[] = []
    if (consumedThisHour > 10) alerts.push({ type: "burn_spike", message: `$${consumedThisHour.toFixed(2)} burned in last hour — spike detected`, severity: "critical" })
    if (topBurnUsers[0]?.cost > 5) alerts.push({ type: "user_burn", message: `${topBurnUsers[0].name || topBurnUsers[0].email} burned $${topBurnUsers[0].cost.toFixed(2)} today`, severity: "warning" })

    return NextResponse.json({
      consumedToday:    Math.round(consumedToday   * 10000) / 10000,
      consumedThisHour: Math.round(consumedThisHour* 10000) / 10000,
      refundedToday:    Math.round(refundedToday   * 10000) / 10000,
      failedToday,
      topBurnUsers,
      topBurnAgents,
      hourlyBurn,
      alerts,
    })
  } catch (err: any) {
    console.error("GET /api/admin/credits:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
