export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRBAC }           from "@/lib/rbac"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function requireAdmin(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const rbac = await getRBAC(supabase, user.id)
  if (!rbac.isAdmin) return { user: null, error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) }
  return { user, error: null }
}

/**
 * GET /api/admin/agents
 * Uses service-role client → bypasses RLS → returns agents from ALL users.
 * ?status=all | pending_review | active | suspended | draft
 * ?limit=1-100
 * ?q=search
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireAdmin(req)
  if (error) return error

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") ?? "pending_review"
  const limit  = Math.min(100, parseInt(searchParams.get("limit") ?? "50"))
  const q      = searchParams.get("q") ?? ""

  const admin = createAdminClient()

  let query = admin
    .from("agents")
    .select(`
      id, name, description, category, status, pricing_model,
      price_per_call, subscription_price_monthly, model_name,
      temperature, max_tokens, tags, capability_tags,
      created_at, updated_at, seller_id,
      profiles!seller_id (full_name, email, is_verified)
    `)
    .order("created_at", { ascending: true })
    .limit(limit)

  if (status !== "all") {
    query = query.eq("status", status) as typeof query
  }
  if (q.trim()) {
    query = query.ilike("name", `%${q.trim()}%`) as typeof query
  }

  const { data: agents, error: dbErr } = await query
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ agents: agents ?? [], count: agents?.length ?? 0, status })
}

/**
 * PATCH /api/admin/agents
 * Approve / reject / suspend / restore an agent.
 */
const ACTION_MAP = {
  approve: { status: "active",         log: "agent.approved" },
  reject:  { status: "draft",          log: "agent.rejected" },
  suspend: { status: "suspended",      log: "agent.suspended" },
  restore: { status: "pending_review", log: "agent.restored" },
} as const

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAdmin(req)
  if (error) return error

  const body = await req.json()
  const { agent_id, action, reason } = body

  if (!agent_id || !UUID_RE.test(agent_id))
    return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

  const mapped = ACTION_MAP[action as keyof typeof ACTION_MAP]
  if (!mapped)
    return NextResponse.json({ error: "action must be: approve | reject | suspend | restore" }, { status: 400 })

  if ((action === "reject" || action === "suspend") && !reason?.trim())
    return NextResponse.json({ error: "reason is required for reject/suspend" }, { status: 400 })

  const admin = createAdminClient()

  const { data: agent } = await admin
    .from("agents")
    .select("id, name, status, seller_id")
    .eq("id", agent_id)
    .single()
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  const { error: updateErr } = await admin
    .from("agents")
    .update({ status: mapped.status, updated_at: new Date().toISOString() })
    .eq("id", agent_id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Audit log + seller notification (fire-and-forget)
  admin.from("audit_logs").insert({
    user_id: user!.id, actor_type: "user", actor_id: user!.id,
    action: mapped.log, resource: "agents", resource_id: agent_id,
    payload: { reason: reason ?? null, previous_status: agent.status, new_status: mapped.status, agent_name: agent.name },
  }).then(() => {})

  admin.from("notifications").insert({
    user_id: agent.seller_id,
    type:    action === "approve" ? "agent_approved" : "agent_rejected",
    title:   action === "approve" ? `"${agent.name}" is now live!` : `"${agent.name}" needs changes`,
    body:    action === "approve"
      ? "Your agent is now active on the AgentDyne marketplace."
      : `Reason: ${reason ?? "See admin feedback"}`,
  }).then(() => {})

  return NextResponse.json({ ok: true, agent_id, action, new_status: mapped.status })
}
