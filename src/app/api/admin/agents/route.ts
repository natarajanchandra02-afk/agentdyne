export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRBAC } from "@/lib/rbac"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function requireAdmin(supabase: any, userId: string) {
  const rbac = await getRBAC(supabase, userId)
  return rbac.isAdmin
}

/**
 * GET /api/admin/agents
 * Returns agents for admin review — filtered by status.
 *
 * Query params:
 *   status   all | pending_review | active | suspended | draft
 *   limit    max 200
 *   q        search by name
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!await requireAdmin(supabase, user.id))
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") || "all"
    const limit  = Math.min(200, parseInt(searchParams.get("limit") ?? "50"))
    const q      = searchParams.get("q")

    let query = supabase
      .from("agents")
      .select(
        `id, name, slug, description, category, status, pricing_model, price_per_call,
         subscription_price_monthly, model_name, temperature, max_tokens,
         tags, capability_tags, created_at, updated_at, is_featured, is_verified,
         profiles!seller_id(id, full_name, email, is_verified)`,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .limit(limit)

    if (status && status !== "all") query = query.eq("status", status) as typeof query
    if (q) query = query.ilike("name", `%${q}%`) as typeof query

    const { data, count, error } = await query
    if (error) throw error

    return NextResponse.json({ agents: data ?? [], total: count ?? 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/agents
 * Approve / reject / suspend an agent and notify the seller.
 *
 * Body:
 *   agent_id   UUID
 *   action     "approve" | "reject" | "suspend"
 *   reason?    string (required for reject)
 *   message?   string (optional message for approve)
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!await requireAdmin(supabase, user.id))
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const body = await req.json()
    const { agent_id, action, reason, message } = body

    if (!agent_id || !UUID_RE.test(agent_id))
      return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

    if (!["approve", "reject", "suspend"].includes(action))
      return NextResponse.json({ error: "action must be approve, reject, or suspend" }, { status: 400 })

    if (action === "reject" && (!reason || String(reason).trim().length < 10))
      return NextResponse.json({ error: "reason is required for rejection (min 10 chars)" }, { status: 400 })

    // Map action → status
    const newStatus = action === "approve" ? "active" : action === "reject" ? "rejected" : "suspended"

    const { error: updateErr } = await supabase
      .from("agents")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", agent_id)

    if (updateErr) throw updateErr

    // Fetch agent to notify seller
    const { data: agent } = await supabase
      .from("agents")
      .select("name, seller_id")
      .eq("id", agent_id)
      .single()

    if (agent?.seller_id) {
      const notifMap = {
        approve: {
          title: "Agent approved! 🎉",
          body:  `"${agent.name}" is now live on the marketplace.${message ? " " + message : ""}`,
          type:  "agent_approved",
          url:   `/marketplace/${agent_id}`,
        },
        reject: {
          title: "Agent submission needs revision",
          body:  `"${agent.name}" was not approved. Reason: ${String(reason).slice(0, 300)}`,
          type:  "agent_rejected",
          url:   `/builder/${agent_id}`,
        },
        suspend: {
          title: "Agent suspended",
          body:  `"${agent.name}" has been suspended. ${reason ? "Reason: " + String(reason).slice(0, 200) : "Contact support for details."}`,
          type:  "agent_rejected",
          url:   `/builder/${agent_id}`,
        },
      }
      const notif = notifMap[action as keyof typeof notifMap]
      await supabase.from("notifications").insert({
        user_id:    agent.seller_id,
        title:      notif.title,
        body:       notif.body,
        type:       notif.type,
        action_url: notif.url,
      })
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id:     user.id,
      actor_type:  "admin",
      actor_id:    user.id,
      action:      `admin_${action}_agent`,
      resource:    "agents",
      resource_id: agent_id,
      payload:     { reason, message },
    })

    return NextResponse.json({ ok: true, agent_id, new_status: newStatus })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
