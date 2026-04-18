export const runtime = 'edge'

/**
 * GET /api/governance
 *
 * Governance & audit dashboard API (admin-only).
 * Returns:
 *   - Injection attempts log (prompt injection security events)
 *   - Audit log (significant platform events)
 *   - Platform health metrics
 *   - RBAC violation attempts
 *
 * Query params:
 *   type     "injections"|"audit"|"health"  (default: "health")
 *   limit    max 100, default 50
 *   from     ISO date string (filter start)
 *   to       ISO date string (filter end)
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRBAC, requirePermission } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    const deny = requirePermission(rbac, "view_audit_logs")
    if (deny) return NextResponse.json({ error: deny.error }, { status: deny.status })

    const { searchParams } = new URL(req.url)
    const type  = searchParams.get("type") ?? "health"
    const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"))
    const from  = searchParams.get("from")
    const to    = searchParams.get("to")

    if (type === "injections") {
      let query = supabase
        .from("injection_attempts")
        .select("id, user_id, agent_id, input, pattern, action, score, created_at, agents(name), profiles!user_id(email, full_name)")
        .order("created_at", { ascending: false })
        .limit(limit)
      if (from) query = query.gte("created_at", from) as typeof query
      if (to)   query = query.lte("created_at", to)   as typeof query

      const { data, error } = await query
      if (error) throw error

      // Aggregate stats
      const blocked = (data ?? []).filter((r: any) => r.action === "blocked").length
      const flagged = (data ?? []).filter((r: any) => r.action === "flagged").length

      return NextResponse.json({
        type: "injections",
        stats: { total: data?.length ?? 0, blocked, flagged },
        data: data ?? [],
      })
    }

    if (type === "audit") {
      let query = supabase
        .from("audit_logs")
        .select("id, user_id, actor_type, action, resource, resource_id, ip_address, created_at, profiles!user_id(email, full_name)")
        .order("created_at", { ascending: false })
        .limit(limit)
      if (from) query = query.gte("created_at", from) as typeof query
      if (to)   query = query.lte("created_at", to)   as typeof query

      const { data, error } = await query
      if (error) throw error

      return NextResponse.json({ type: "audit", data: data ?? [] })
    }

    // Default: platform health dashboard
    const [
      { count: totalUsers },
      { count: totalAgents },
      { count: pendingAgents },
      { count: totalExecutions24h },
      { count: failedExecutions24h },
      { count: injectionBlocked24h },
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
      supabase.from("executions").select("*", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      supabase.from("executions").select("*", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      supabase.from("injection_attempts").select("*", { count: "exact", head: true }).eq("action", "blocked").gte("created_at", new Date(Date.now() - 86400000).toISOString()),
    ])

    return NextResponse.json({
      type: "health",
      timestamp: new Date().toISOString(),
      platform: {
        total_users:          totalUsers ?? 0,
        active_agents:        totalAgents ?? 0,
        pending_review:       pendingAgents ?? 0,
        executions_24h:       totalExecutions24h ?? 0,
        failed_24h:           failedExecutions24h ?? 0,
        failure_rate_24h:     totalExecutions24h
          ? +((failedExecutions24h ?? 0) / totalExecutions24h * 100).toFixed(1)
          : 0,
        injection_blocked_24h: injectionBlocked24h ?? 0,
      },
    })

  } catch (err: any) {
    console.error("GET /api/governance:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/governance
 *
 * Write audit log entry (admin/system use).
 * All significant admin actions should log here.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 })

    const body = await req.json()
    const { action, resource, resource_id, payload } = body

    if (!action || typeof action !== "string")
      return NextResponse.json({ error: "action is required" }, { status: 400 })

    await supabase.from("audit_logs").insert({
      user_id:     user.id,
      actor_type:  "user",
      actor_id:    user.id,
      action:      String(action).slice(0, 200),
      resource:    resource ? String(resource).slice(0, 100) : null,
      resource_id: resource_id || null,
      payload:     payload ?? {},
      ip_address:  req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
