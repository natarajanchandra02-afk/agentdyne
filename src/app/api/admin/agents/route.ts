export const runtime = 'edge'

/**
 * PATCH /api/admin/agents
 *
 * Admin-only agent moderation endpoint with full RBAC enforcement.
 * Replaces the client-side direct Supabase update in admin-client.tsx
 * which had no server-side role verification.
 *
 * Body:
 *   agent_id string — UUID of agent to moderate
 *   action   "approve" | "reject" | "suspend" | "restore"
 *   reason   string? — required for reject/suspend
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRBAC, requirePermission } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const ACTION_MAP = {
  approve: { status: "active",         permission: "approve_agent" as const, log: "agent.approved" },
  reject:  { status: "draft",          permission: "reject_agent"  as const, log: "agent.rejected" },
  suspend: { status: "suspended",      permission: "suspend_agent" as const, log: "agent.suspended" },
  restore: { status: "pending_review", permission: "approve_agent" as const, log: "agent.restored" },
}

export async function PATCH(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const body = await req.json()
    const { agent_id, action, reason } = body

    if (!agent_id || !UUID_RE.test(agent_id))
      return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

    const mapped = ACTION_MAP[action as keyof typeof ACTION_MAP]
    if (!mapped)
      return NextResponse.json({ error: "action must be: approve|reject|suspend|restore" }, { status: 400 })

    const deny = requirePermission(rbac, mapped.permission)
    if (deny) return NextResponse.json({ error: deny.error }, { status: deny.status })

    if ((action === "reject" || action === "suspend") && !reason?.trim())
      return NextResponse.json({ error: "reason is required for reject/suspend" }, { status: 400 })

    // Load agent to verify it exists
    const { data: agent } = await supabase.from("agents").select("id, name, status, seller_id").eq("id", agent_id).single()
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    // Apply status change
    const { error: updateErr } = await supabase
      .from("agents")
      .update({ status: mapped.status, updated_at: new Date().toISOString() })
      .eq("id", agent_id)
    if (updateErr) throw updateErr

    // Write audit log
    await supabase.from("audit_logs").insert({
      user_id:     user.id,
      actor_type:  "user",
      actor_id:    user.id,
      action:      mapped.log,
      resource:    "agents",
      resource_id: agent_id,
      payload:     { reason: reason ?? null, previous_status: agent.status, new_status: mapped.status, agent_name: agent.name },
    })

    // Notify agent seller
    await supabase.from("notifications").insert({
      user_id: agent.seller_id,
      type:    action === "approve" ? "agent_approved" : "agent_rejected",
      title:   action === "approve" ? `"${agent.name}" is now live!` : `"${agent.name}" requires changes`,
      body:    action === "approve"
        ? `Your agent is now active on the AgentDyne marketplace.`
        : `Reason: ${reason ?? "See admin feedback"}`,
      data: { agent_id, action, reason: reason ?? null },
    })

    return NextResponse.json({
      ok:      true,
      agent_id,
      action,
      new_status: mapped.status,
    })

  } catch (err: any) {
    console.error("PATCH /api/admin/agents:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** GET /api/admin/agents — list agents pending review */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") ?? "pending_review"
    const limit  = Math.min(100, parseInt(searchParams.get("limit") ?? "50"))

    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, description, category, status, pricing_model, model_name, created_at, profiles!seller_id(id, full_name, email, is_verified)")
      .eq("status", status)
      .order("created_at", { ascending: true })
      .limit(limit)

    return NextResponse.json({ agents: agents ?? [], status, count: agents?.length ?? 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
