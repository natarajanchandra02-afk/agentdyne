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

    const [feedResult, statsResult, recentResult] = await Promise.all([
      // Live execution feed (last 50)
      admin.from("executions")
        .select(`id, status, cost_usd, latency_ms, selected_model, created_at,
                 agents!agent_id(name), profiles!user_id(email)`)
        .order("created_at", { ascending: false })
        .limit(50),

      // 24h aggregate stats by status
      admin.from("executions")
        .select("status, cost_usd, latency_ms, tokens_input, tokens_output")
        .gte("created_at", since24h),

      // Last 1h for real-time health
      admin.from("executions")
        .select("status")
        .gte("created_at", since1h),
    ])

    const feed       = feedResult.data   ?? []
    const stats24h   = statsResult.data  ?? []
    const stats1h    = recentResult.data ?? []

    // Compute 24h health
    const byStatus24h: Record<string, number> = {}
    let totalLatency = 0, latencyCount = 0
    for (const e of stats24h) {
      byStatus24h[e.status] = (byStatus24h[e.status] ?? 0) + 1
      if (e.latency_ms) { totalLatency += Number(e.latency_ms); latencyCount++ }
    }

    const total24h   = stats24h.length
    const success24h = byStatus24h["success"]  ?? 0
    const failed24h  = byStatus24h["failed"]   ?? 0
    const timeout24h = byStatus24h["timeout"]  ?? 0
    const queued24h  = byStatus24h["queued"]   ?? 0
    const running24h = byStatus24h["running"]  ?? 0

    const successRate24h = total24h > 0 ? Math.round((success24h / total24h) * 1000) / 10 : 0
    const avgLatency24h  = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0
    const totalCost24h   = stats24h.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)

    // 1h health
    const total1h   = stats1h.length
    const success1h = stats1h.filter(e => e.status === "success").length
    const failed1h  = stats1h.filter(e => e.status === "failed").length

    return NextResponse.json({
      // Summary
      total24h, success24h, failed24h, timeout24h, queued24h, running24h,
      successRate24h,
      avgLatency24h,
      totalCost24h: Math.round(totalCost24h * 10000) / 10000,
      // 1h snapshot
      total1h, success1h, failed1h,
      // Live feed
      feed: feed.map(e => ({
        id:         e.id,
        status:     e.status,
        cost:       e.cost_usd,
        latency:    e.latency_ms,
        model:      e.selected_model,
        agent:      (e as any).agents?.name ?? "—",
        user:       (e as any).profiles?.email ?? "—",
        created_at: e.created_at,
      })),
    })
  } catch (err: any) {
    console.error("GET /api/admin/execution-health:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
