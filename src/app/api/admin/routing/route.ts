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

    const [execResult, reasonResult] = await Promise.all([
      // All executions with model info
      admin.from("executions")
        .select("selected_model, cost_usd, latency_ms, status, routing_reason, cost_saved_pct")
        .not("selected_model", "is", null),

      // Routing reasons breakdown
      admin.from("executions")
        .select("routing_reason, selected_model")
        .not("routing_reason", "is", null)
        .limit(500),
    ])

    const execs   = execResult.data   ?? []
    const reasons = reasonResult.data ?? []

    // Group by model
    const modelMap: Record<string, { count: number; totalCost: number; totalLatency: number; successes: number; failures: number }> = {}

    for (const e of execs) {
      const model = e.selected_model ?? "unknown"
      if (!modelMap[model]) modelMap[model] = { count: 0, totalCost: 0, totalLatency: 0, successes: 0, failures: 0 }
      modelMap[model].count++
      modelMap[model].totalCost    += Number(e.cost_usd    ?? 0)
      modelMap[model].totalLatency += Number(e.latency_ms  ?? 0)
      if (e.status === "success") modelMap[model].successes++
      else                        modelMap[model].failures++
    }

    const totalExecs = execs.length || 1

    const modelBreakdown = Object.entries(modelMap).map(([model, stats]) => ({
      model,
      count:       stats.count,
      pct:         Math.round((stats.count / totalExecs) * 1000) / 10,
      avgCost:     stats.count ? Math.round((stats.totalCost / stats.count) * 1e6) / 1e6 : 0,
      avgLatency:  stats.count ? Math.round(stats.totalLatency / stats.count) : 0,
      successRate: stats.count ? Math.round((stats.successes / stats.count) * 1000) / 10 : 0,
      totalCost:   Math.round(stats.totalCost * 10000) / 10000,
    })).sort((a, b) => b.count - a.count)

    // Routing reasons
    const reasonMap: Record<string, number> = {}
    for (const r of reasons) {
      const key = r.routing_reason ?? "unknown"
      reasonMap[key] = (reasonMap[key] ?? 0) + 1
    }
    const routingReasons = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)

    // Avg cost savings from routing
    const avgSavedPct = execs.length
      ? execs.reduce((s, e) => s + Number(e.cost_saved_pct ?? 0), 0) / execs.length
      : 0

    const totalCostAll = execs.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)

    return NextResponse.json({
      totalRoutedExecutions: execs.length,
      modelBreakdown,
      routingReasons,
      avgSavedPct:  Math.round(avgSavedPct  * 10) / 10,
      totalCostAll: Math.round(totalCostAll * 100) / 100,
    })
  } catch (err: any) {
    console.error("GET /api/admin/routing:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
