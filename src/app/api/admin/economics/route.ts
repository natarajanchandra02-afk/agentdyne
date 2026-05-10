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
  "30d": 30 * 24 * 60 * 60 * 1000,
}

function bucketRevenueChart(
  txns: { amount: string | number; created_at: string }[],
  range: string,
): { label: string; revenue: number }[] {
  const now = Date.now()

  if (range === "1h") {
    // 12 × 5-minute buckets, oldest → newest
    const buckets: Record<number, number> = {}
    for (const tx of txns) {
      const slot = Math.floor((now - new Date(tx.created_at).getTime()) / (5 * 60 * 1000))
      if (slot >= 0 && slot < 12) buckets[slot] = (buckets[slot] ?? 0) + Number(tx.amount)
    }
    return Array.from({ length: 12 }, (_, i) => ({
      label:   `-${(11 - i) * 5}m`,
      revenue: Math.round((buckets[11 - i] ?? 0) * 100) / 100,
    }))
  }

  if (range === "1d") {
    // 24 × 1-hour buckets
    const buckets: Record<number, number> = {}
    for (const tx of txns) {
      const h = new Date(tx.created_at).getUTCHours()
      buckets[h] = (buckets[h] ?? 0) + Number(tx.amount)
    }
    return Array.from({ length: 24 }, (_, i) => ({
      label:   `${i}:00`,
      revenue: Math.round((buckets[i] ?? 0) * 100) / 100,
    }))
  }

  // 7d / 15d / 30d → daily buckets
  const days = range === "7d" ? 7 : range === "15d" ? 15 : 30
  const dayMap: Record<string, number> = {}
  for (const tx of txns) dayMap[tx.created_at.slice(0, 10)] = (dayMap[tx.created_at.slice(0, 10)] ?? 0) + Number(tx.amount)

  return Array.from({ length: days }, (_, i) => {
    const d   = new Date(now - (days - 1 - i) * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    const label = days === 7
      ? d.toLocaleDateString("en-US", { weekday: "short" })
      : `${d.getMonth() + 1}/${d.getDate()}`
    return { label, revenue: Math.round((dayMap[key] ?? 0) * 100) / 100 }
  })
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const range   = req.nextUrl.searchParams.get("range") ?? "30d"
    const rangeMs = RANGE_MS[range] ?? RANGE_MS["30d"]
    const since   = new Date(Date.now() - rangeMs).toISOString()

    const admin = createAdminClient()

    const [
      txAllResult,
      execResult,
      topCostResult,
      txRangeResult,
      userSpendResult,
    ] = await Promise.all([
      // All-time KPI aggregates
      admin.from("transactions").select("amount").eq("status", "succeeded"),

      admin.from("executions")
        .select("cost_usd, tokens_input, tokens_output, status, selected_model")
        .not("cost_usd", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000),

      admin.from("executions")
        .select("id, cost_usd, status, selected_model, user_id, created_at, agents!agent_id(name)")
        .not("cost_usd", "is", null)
        .order("cost_usd", { ascending: false })
        .limit(10),

      // Range-aware chart data
      admin.from("transactions")
        .select("amount, created_at")
        .eq("status", "succeeded")
        .gte("created_at", since),

      admin.from("profiles")
        .select("id, full_name, email, total_spent, total_earned, subscription_plan")
        .order("total_spent", { ascending: false })
        .limit(10),
    ])

    const transactions  = txAllResult.data  ?? []
    const executions    = execResult.data   ?? []
    const topExecutions = topCostResult.data ?? []
    const txRange       = txRangeResult.data ?? []
    const topUsers      = userSpendResult.data ?? []

    const grossRevenue    = transactions.reduce((s, t) => s + Number(t.amount), 0)
    const platformFee     = grossRevenue * 0.20
    const totalLLMCost    = executions.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const grossMargin     = grossRevenue > 0 ? ((grossRevenue - totalLLMCost) / grossRevenue) * 100 : 0
    const avgCostPerExec  = executions.length > 0 ? totalLLMCost / executions.length : 0
    const totalTokensIn   = executions.reduce((s, e) => s + Number(e.tokens_input  ?? 0), 0)
    const totalTokensOut  = executions.reduce((s, e) => s + Number(e.tokens_output ?? 0), 0)

    const SONNET_PPT = 0.000003
    const costSaved = executions
      .filter(e => e.selected_model?.includes("haiku"))
      .reduce((s, e) => {
        const tokens = Number(e.tokens_input ?? 0) + Number(e.tokens_output ?? 0)
        return s + Math.max(0, tokens * SONNET_PPT - Number(e.cost_usd ?? 0))
      }, 0)

    // Range revenue for chart (also exposed as rangeRevenue KPI)
    const rangeRevenue = txRange.reduce((s, t) => s + Number(t.amount), 0)
    const chartData    = bucketRevenueChart(txRange, range)

    // Keep legacy dailyRevenue field for backward compat
    const dailyRevenue = range === "30d" || !RANGE_MS[range] ? chartData.map(d => ({ date: d.label, revenue: d.revenue })) : []

    return NextResponse.json({
      grossRevenue:     Math.round(grossRevenue    * 100) / 100,
      platformFee:      Math.round(platformFee     * 100) / 100,
      totalLLMCost:     Math.round(totalLLMCost    * 100) / 100,
      grossMarginPct:   Math.round(grossMargin     * 10)  / 10,
      avgCostPerExec:   Math.round(avgCostPerExec  * 1e6) / 1e6,
      costSavedRouting: Math.round(costSaved       * 100) / 100,
      totalTokensIn,
      totalTokensOut,
      rangeRevenue:     Math.round(rangeRevenue    * 100) / 100,
      range,
      chartData,
      dailyRevenue,
      topExecutions: topExecutions.map(e => ({
        id: e.id, cost: e.cost_usd, model: e.selected_model, status: e.status,
        agent: (e as any).agents?.name ?? "—", created_at: e.created_at,
      })),
      topSpenders: topUsers.map(u => ({
        id: u.id, name: u.full_name, email: u.email,
        spent: u.total_spent, earned: u.total_earned, plan: u.subscription_plan,
      })),
    })
  } catch (err: any) {
    console.error("GET /api/admin/economics:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
