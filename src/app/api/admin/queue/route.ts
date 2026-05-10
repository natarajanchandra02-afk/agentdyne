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

    const [queuedResult, runningResult, failedRecentResult, allRecentResult] = await Promise.all([
      admin.from("executions").select("id, created_at, agent_id, agents!agent_id(name)")
        .eq("status", "queued").order("created_at", { ascending: true }).limit(50),

      admin.from("executions").select("id, created_at, agent_id, agents!agent_id(name), latency_ms")
        .eq("status", "running").order("created_at", { ascending: true }).limit(50),

      admin.from("executions").select("id, status, created_at, error_message, agent_id, agents!agent_id(name)")
        .in("status", ["failed", "timeout"])
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false }).limit(20),

      admin.from("executions")
        .select("status, created_at, latency_ms")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()),
    ])

    const queued      = queuedResult.data   ?? []
    const running     = runningResult.data  ?? []
    const failedRecent= failedRecentResult.data ?? []
    const allRecent   = allRecentResult.data ?? []

    const now = Date.now()

    // Avg queue wait time (time since created_at for queued items)
    const avgQueueWaitMs = queued.length
      ? queued.reduce((s, e) => s + (now - new Date(e.created_at).getTime()), 0) / queued.length
      : 0

    // Avg latency from completed executions in last 1h
    const completed = allRecent.filter(e => e.status === "success" && e.latency_ms)
    const avgLatency = completed.length
      ? completed.reduce((s, e) => s + Number(e.latency_ms), 0) / completed.length
      : 0

    // Throughput: executions per minute in last 1h
    const throughput = allRecent.length / 60

    return NextResponse.json({
      queuedCount:     queued.length,
      runningCount:    running.length,
      failedCount:     failedRecent.length,
      avgQueueWaitMs:  Math.round(avgQueueWaitMs),
      avgLatencyMs:    Math.round(avgLatency),
      throughputPerMin:Math.round(throughput * 10) / 10,
      queuedJobs:  queued.slice(0, 10).map(e => ({
        id:        e.id,
        agent:     (e as any).agents?.name ?? "—",
        waitMs:    now - new Date(e.created_at).getTime(),
        created_at:e.created_at,
      })),
      runningJobs: running.slice(0, 10).map(e => ({
        id:        e.id,
        agent:     (e as any).agents?.name ?? "—",
        runningMs: now - new Date(e.created_at).getTime(),
        created_at:e.created_at,
      })),
      deadLetter: failedRecent.slice(0, 8).map(e => ({
        id:       e.id,
        status:   e.status,
        agent:    (e as any).agents?.name ?? "—",
        error:    e.error_message,
        created_at:e.created_at,
      })),
    })
  } catch (err: any) {
    console.error("GET /api/admin/queue:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
