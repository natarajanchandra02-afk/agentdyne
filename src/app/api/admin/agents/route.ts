export const runtime = 'edge'

/**
 * /api/admin/agents
 *
 * PATCH  — Approve / reject / suspend / restore an agent
 * GET    — List agents by status for the admin review queue
 *
 * CRITICAL: Uses createAdminClient() (service role key) for ALL database
 * mutations and privileged reads. The anon-key client (createClient) is
 * subject to RLS, and the agents UPDATE policy only allows sellers to
 * update their own agents. Using the anon key here would silently fail
 * (RLS blocks the update with no error returned by PostgREST).
 *
 * Auth flow:
 *   1. Verify session via createClient() (anon key — safe for auth.getUser())
 *   2. Load role via createAdminClient() (bypasses RLS)
 *   3. All DB writes via createAdminClient()
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildRBAC, requirePermission } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACTION_MAP = {
  approve: { status: "active",    permission: "approve_agent" as const, log: "agent.approved" },
  reject:  { status: "draft",     permission: "reject_agent"  as const, log: "agent.rejected" },
  suspend: { status: "suspended", permission: "suspend_agent" as const, log: "agent.suspended" },
  restore: { status: "active",    permission: "approve_agent" as const, log: "agent.restored" },
} as const

// ── PATCH /api/admin/agents ───────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    // Step 1: verify session (anon client — safe)
    const anonClient  = await createClient()
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // Step 2: load role via admin client (bypasses RLS, always accurate)
    const adminDb = await createAdminClient()
    const { data: profileRow } = await adminDb
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    const rbac = buildRBAC(user.id, profileRow?.role)
    if (!rbac.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    // Parse + validate request body
    let body: Record<string, unknown>
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { agent_id, action, reason } = body as Record<string, unknown>

    if (typeof agent_id !== "string" || !UUID_RE.test(agent_id)) {
      return NextResponse.json({ error: "Valid agent_id (UUID) is required" }, { status: 400 })
    }
    if (typeof action !== "string" || !(action in ACTION_MAP)) {
      return NextResponse.json(
        { error: "action must be one of: approve | reject | suspend | restore" },
        { status: 400 }
      )
    }

    const mapped    = ACTION_MAP[action as keyof typeof ACTION_MAP]
    const deny      = requirePermission(rbac, mapped.permission)
    if (deny) return NextResponse.json({ error: deny.error }, { status: deny.status })

    const reasonStr = typeof reason === "string" ? reason.trim() : ""
    if ((action === "reject" || action === "suspend") && !reasonStr) {
      return NextResponse.json(
        { error: `reason is required for action "${action}"` },
        { status: 400 }
      )
    }

    // Step 3: load agent via admin client (reads all statuses, bypasses RLS)
    const { data: agent, error: fetchErr } = await adminDb
      .from("agents")
      .select("id, name, status, seller_id")
      .eq("id", agent_id)
      .single()

    if (fetchErr || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // Step 4: apply status change via admin client (bypasses seller-only UPDATE policy)
    const { error: updateErr } = await adminDb
      .from("agents")
      .update({ status: mapped.status, updated_at: new Date().toISOString() })
      .eq("id", agent_id)

    if (updateErr) throw updateErr

    // Step 5: audit log (fire-and-forget)
    adminDb.from("audit_logs").insert({
      user_id:     user.id,
      actor_type:  "user",
      actor_id:    user.id,
      action:      mapped.log,
      resource:    "agents",
      resource_id: agent_id,
      payload: {
        reason:          reasonStr || null,
        previous_status: agent.status,
        new_status:      mapped.status,
        agent_name:      agent.name,
      },
    }).then()

    // Step 6: notify seller
    const notifTitle = {
      approve: `"${agent.name}" is now live!`,
      reject:  `"${agent.name}" needs changes`,
      suspend: `"${agent.name}" has been suspended`,
      restore: `"${agent.name}" has been restored`,
    }[action as string] ?? `"${agent.name}" status updated`

    const notifBody = action === "approve"
      ? "Your agent is now active on the AgentDyne marketplace."
      : action === "restore"
        ? "Your agent has been restored and is live again."
        : `Your agent was ${action === "reject" ? "rejected" : "suspended"}. Reason: ${reasonStr || "See admin feedback"}`

    adminDb.from("notifications").insert({
      user_id:  agent.seller_id,
      type:     (action === "approve" || action === "restore") ? "agent_approved" : "agent_rejected",
      title:    notifTitle,
      body:     notifBody,
      metadata: { agent_id, action, reason: reasonStr || null },
    }).then()

    return NextResponse.json({ ok: true, agent_id, action, new_status: mapped.status })

  } catch (err: any) {
    console.error("PATCH /api/admin/agents:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}

// ── GET /api/admin/agents ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    // Verify session
    const anonClient = await createClient()
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // Role check via admin client (bypasses RLS)
    const adminDb = await createAdminClient()
    const { data: profileRow } = await adminDb
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()

    const rbac = buildRBAC(user.id, profileRow?.role)
    if (!rbac.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status") ?? "pending_review"
    const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50")))

    const VALID_STATUSES = new Set(["pending_review", "active", "suspended", "draft", "all"])
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 })
    }

    // Build query via admin client — bypasses all RLS on agents
    let query = adminDb
      .from("agents")
      .select(
        "id, name, description, category, status, " +
        "pricing_model, price_per_call, subscription_price_monthly, " +
        "model_name, temperature, max_tokens, " +
        "tags, capability_tags, created_at, updated_at, " +
        "profiles!seller_id(id, full_name, email, is_verified)"
      )
      .order("created_at", { ascending: true })
      .limit(limit)

    if (status !== "all") {
      query = query.eq("status", status)
    }

    const { data: agents, error } = await query
    if (error) throw error

    return NextResponse.json({ agents: agents ?? [], status, count: agents?.length ?? 0 })

  } catch (err: any) {
    console.error("GET /api/admin/agents:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}
