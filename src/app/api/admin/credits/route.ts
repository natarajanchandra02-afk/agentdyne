export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRBAC }           from "@/lib/rbac"

const RANGE_MS: Record<string, number> = {
  "1h":  1  * 60 * 60 * 1000,
  "1d":  24 * 60 * 60 * 1000,
  "7d":  7  * 24 * 60 * 60 * 1000,
  "15d": 15 * 24 * 60 * 60 * 1000,
}

const RANGE_LABEL: Record<string, string> = {
  "1h":  "Last hour",
  "1d":  "Today",
  "7d":  "Last 7 days",
  "15d": "Last 15 days",
}

function bucketBurnChart(
  execs: { cost_usd: string | number | null; created_at: string }[],
  range: string,
): { label: string; cost: number }[] {
  const now = Date.now()

  if (range === "1h") {
    // 12 × 5-minute slots, oldest first
    const slots: Record<number, number> = {}
    for (const e of execs) {
      const slot = Math.floor((now - new Date(e.created_at).getTime()) / (5 * 60 * 1000))
      if (slot >= 0 && slot < 12) slots[slot] = (slots[slot] ?? 0) + Number(e.cost_usd ?? 0)
    }
    return Array.from({ length: 12 }, (_, i) => ({
      label: `-${(11 - i) * 5}m`,
      cost:  Math.round((slots[11 - i] ?? 0) * 10000) / 10000,
    }))
  }

  if (range === "1d") {
    // 24 × 1-hour buckets by UTC hour
    const hours: Record<number, number> = {}
    for (const e of execs) {
      const h = new Date(e.created_at).getUTCHours()
      hours[h] = (hours[h] ?? 0) + Number(e.cost_usd ?? 0)
    }
    return Array.from({ length: 24 }, (_, i) => ({
      label: `${i}:00`,
      cost:  Math.round((hours[i] ?? 0) * 10000) / 10000,
    }))
  }

  // 7d / 15d → daily buckets
  const days = range === "7d" ? 7 : 15
  const dayMap: Record<string, number> = {}
  for (const e of execs) dayMap[e.created_at.slice(0, 10)] = (dayMap[e.created_at.slice(0, 10)] ?? 0) + Number(e.cost_usd ?? 0)

  return Array.from({ length: days }, (_, i) => {
    const d   = new Date(now - (days - 1 - i) * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    const label = days === 7
      ? d.toLocaleDateString("en-US", { weekday: "short" })
      : `${d.getMonth() + 1}/${d.getDate()}`
    return { label, cost: Math.round((dayMap[key] ?? 0) * 10000) / 10000 }
  })
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const range   = req.nextUrl.searchParams.get("range") ?? "1d"
    const rangeMs = RANGE_MS[range] ?? RANGE_MS["1d"]
    const since   = new Date(Date.now() - rangeMs).toISOString()
    // For "1d", use calendar day start instead of rolling 24h so numbers match intuition
    const sinceResolved = range === "1d"
      ? new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()
      : since

    const admin = createAdminClient()

    const [
      execsResult,
      burnUsersResult,
      burnAgentsResult,
      refundResult,
      prevRangeResult,
    ] = await Promise.all([
      // All execs in range (for chart + totals)
      admin.from("executions")
        .select("cost_usd, status, user_id, agent_id, created_at")
        .gte("created_at", sinceResolved),

      // Top burn users in range
      admin.from("executions")
        .select("user_id, cost_usd, profiles!user_id(email, full_name)")
        .gte("created_at", sinceResolved)
        .not("cost_usd", "is", null)
        .order("cost_usd", { ascending: false })
        .limit(300),

      // Top burn agents in range
      admin.from("executions")
        .select("agent_id, cost_usd, agents!agent_id(name)")
        .gte("created_at", sinceResolved)
        .not("cost_usd", "is", null)
        .limit(500),

      // Failed (refunded) in range
      admin.from("executions")
        .select("cost_usd")
        .gte("created_at", sinceResolved)
        .eq("status", "failed"),

      // Previous period for trend delta
      admin.from("executions")
        .select("cost_usd")
        .gte("created_at", new Date(new Date(sinceResolved).getTime() - rangeMs).toISOString())
        .lt("created_at", sinceResolved)
        .not("cost_usd", "is", null),
    ])

    const execs      = execsResult.data     ?? []
    const refunds    = refundResult.data     ?? []
    const prevExecs  = prevRangeResult.data  ?? []

    // Totals
    const consumed     = execs.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const refunded     = refunds.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const failed       = execs.filter(e => e.status === "failed").length
    const prevConsumed = prevExecs.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const trendPct     = prevConsumed > 0 ? ((consumed - prevConsumed) / prevConsumed) * 100 : 0

    // Last 1h rolling (always, for cockpit alert)
    const since1h         = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const consumedThisHour = execs
      .filter(e => e.created_at >= since1h)
      .reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)

    // Top burn users
    const userMap: Record<string, { cost: number; count: number; email: string; name: string }> = {}
    for (const e of (burnUsersResult.data ?? [])) {
      const id = e.user_id
      if (!userMap[id]) userMap[id] = { cost: 0, count: 0, email: (e as any).profiles?.email ?? "—", name: (e as any).profiles?.full_name ?? "—" }
      userMap[id].cost  += Number(e.cost_usd ?? 0)
      userMap[id].count += 1
    }
    const topBurnUsers = Object.entries(userMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // Top burn agents
    const agentMap: Record<string, { cost: number; count: number; name: string }> = {}
    for (const e of (burnAgentsResult.data ?? [])) {
      const id = e.agent_id
      if (!agentMap[id]) agentMap[id] = { cost: 0, count: 0, name: (e as any).agents?.name ?? "—" }
      agentMap[id].cost  += Number(e.cost_usd ?? 0)
      agentMap[id].count += 1
    }
    const topBurnAgents = Object.entries(agentMap)
      .map(([id, v]) => ({ id, ...v, avgCost: v.count ? v.cost / v.count : 0 }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // Chart data bucketed for range
    const chartData = bucketBurnChart(execs, range)

    // Legacy hourlyBurn alias for backward compat (1d = hourly)
    const hourlyBurn = range === "1d"
      ? chartData.map((d, i) => ({ hour: i, cost: d.cost }))
      : Array.from({ length: 24 }, (_, i) => ({ hour: i, cost: 0 }))

    // Alerts (always based on rolling 1h, not range)
    const alerts: { type: string; message: string; severity: "critical" | "warning" | "info" }[] = []
    if (consumedThisHour > 10) alerts.push({ type: "burn_spike", message: `$${consumedThisHour.toFixed(2)} burned in last hour — spike detected`, severity: "critical" })
    if (topBurnUsers[0]?.cost > 5) alerts.push({ type: "user_burn", message: `${topBurnUsers[0].name || topBurnUsers[0].email} burned $${topBurnUsers[0].cost.toFixed(2)} (${RANGE_LABEL[range]?.toLowerCase()})`, severity: "warning" })

    return NextResponse.json({
      // Range-aware totals
      consumed:         Math.round(consumed         * 10000) / 10000,
      refunded:         Math.round(refunded         * 10000) / 10000,
      failed,
      trendPct:         Math.round(trendPct         * 10)    / 10,
      // Always rolling-1h for cockpit
      consumedThisHour: Math.round(consumedThisHour * 10000) / 10000,
      // Legacy fields
      consumedToday:    Math.round(consumed         * 10000) / 10000,
      refundedToday:    Math.round(refunded         * 10000) / 10000,
      failedToday:      failed,
      // Chart
      chartData,
      hourlyBurn,
      // Meta
      range,
      rangeLabel: RANGE_LABEL[range] ?? range,
      // Tables
      topBurnUsers,
      topBurnAgents,
      alerts,
    })
  } catch (err: any) {
    console.error("GET /api/admin/credits:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
