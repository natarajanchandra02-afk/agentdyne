export const runtime = 'edge'

/**
 * /api/admin — Admin management API
 *
 * All endpoints require admin role (checked via RBAC + DB role column).
 * Rate-limited to 30/min to prevent abuse of elevated-privilege endpoints.
 *
 * GET  /api/admin?type=agents&status=pending_review  — pending review queue
 * GET  /api/admin?type=users&q=<email>               — user search
 * GET  /api/admin?type=stats                         — platform metrics
 * POST /api/admin                                    — admin actions
 *   { action: "approve_agent",  agent_id, message? }
 *   { action: "reject_agent",   agent_id, reason }
 *   { action: "suspend_agent",  agent_id, reason }
 *   { action: "ban_user",       user_id,  reason }
 *   { action: "unban_user",     user_id }
 *   { action: "set_featured",   agent_id, featured: bool }
 *   { action: "approve_review", review_id }
 *   { action: "reject_review",  review_id }
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRBAC, requirePermission } from "@/lib/rbac"
import { rateLimit } from "@/lib/rate-limit"

const adminRateLimit = rateLimit({ limit: 30, window: 60 })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── Auth helper ────────────────────────────────────────────────────────────────

async function requireAdmin(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized", status: 401, supabase: null, userId: null }
  const rbac = await getRBAC(supabase, user.id)
  if (!rbac.isAdmin) return { error: "Admin access required", status: 403, supabase: null, userId: null }
  return { error: null, status: 200, supabase, userId: user.id }
}

// ── Audit log helper ───────────────────────────────────────────────────────────

async function logAdminAction(supabase: any, userId: string, action: string, resource: string, resourceId: string, payload: object = {}, req?: NextRequest) {
  await supabase.from("audit_logs").insert({
    user_id:     userId,
    actor_type:  "admin",
    actor_id:    userId,
    action,
    resource,
    resource_id: resourceId,
    payload,
    ip_address:  req?.headers.get("cf-connecting-ip") ?? req?.headers.get("x-forwarded-for") ?? null,
    user_agent:  req?.headers.get("user-agent")?.slice(0, 200) ?? null,
  })
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const limited = await adminRateLimit(req)
  if (limited) return limited

  const auth = await requireAdmin(req)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { supabase } = auth

  const { searchParams } = new URL(req.url)
  const type   = searchParams.get("type")   ?? "stats"
  const limit  = Math.min(100, parseInt(searchParams.get("limit") ?? "50"))
  const page   = Math.max(1, parseInt(searchParams.get("page") ?? "1"))
  const status = searchParams.get("status")
  const q      = searchParams.get("q")

  // ── Agents pending review ────────────────────────────────────────────────────
  if (type === "agents") {
    let query = supabase!
      .from("agents")
      .select(`
        id, name, slug, category, status, pricing_model, price_per_call,
        created_at, updated_at, is_featured, is_verified,
        profiles!seller_id(id, full_name, email, is_verified, stripe_connect_onboarded)
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status) query = query.eq("status", status) as typeof query
    if (q)      query = query.ilike("name", `%${q}%`) as typeof query

    const { data, count, error } = await query
    if (error) throw error
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit })
  }

  // ── Users ─────────────────────────────────────────────────────────────────────
  if (type === "users") {
    let query = supabase!
      .from("profiles")
      .select(`
        id, full_name, email, role, subscription_plan, is_verified, is_banned,
        total_earned, executions_used_this_month, monthly_execution_quota, created_at
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`) as typeof query

    const { data, count, error } = await query
    if (error) throw error
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit })
  }

  // ── Reviews pending moderation ─────────────────────────────────────────────
  if (type === "reviews") {
    const { data, count, error } = await supabase!
      .from("reviews")
      .select(`
        id, agent_id, rating, title, body, status, created_at,
        agents(name), profiles!user_id(full_name, email)
      `, { count: "exact" })
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .range((page - 1) * limit, page * limit - 1)

    if (error) throw error
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit })
  }

  // ── Platform stats (default) ───────────────────────────────────────────────
  const ago24h = new Date(Date.now() - 86_400_000).toISOString()
  const ago7d  = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [
    { count: totalUsers },
    { count: newUsers7d },
    { count: activeAgents },
    { count: pendingAgents },
    { count: executions24h },
    { count: failedExec24h },
    { count: injBlocked24h },
    { data: revenueData },
  ] = await Promise.all([
    supabase!.from("profiles").select("*", { count: "exact", head: true }),
    supabase!.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", ago7d),
    supabase!.from("agents").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase!.from("agents").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase!.from("executions").select("*", { count: "exact", head: true }).gte("created_at", ago24h),
    supabase!.from("executions").select("*", { count: "exact", head: true }).eq("status", "failed").gte("created_at", ago24h),
    supabase!.from("injection_attempts").select("*", { count: "exact", head: true }).eq("action", "blocked").gte("created_at", ago24h),
    supabase!.from("transactions").select("amount").eq("status", "succeeded").gte("created_at", ago7d),
  ])

  const revenue7d = (revenueData ?? []).reduce((s: number, r: any) => s + (r.amount ?? 0), 0)

  return NextResponse.json({
    platform: {
      total_users:      totalUsers  ?? 0,
      new_users_7d:     newUsers7d  ?? 0,
      active_agents:    activeAgents ?? 0,
      pending_review:   pendingAgents ?? 0,
      executions_24h:   executions24h ?? 0,
      failed_24h:       failedExec24h ?? 0,
      failure_rate_24h: executions24h
        ? +((failedExec24h ?? 0) / (executions24h as number) * 100).toFixed(1)
        : 0,
      injection_blocked_24h: injBlocked24h ?? 0,
      revenue_7d_usd:   +revenue7d.toFixed(2),
    },
    generated_at: new Date().toISOString(),
  })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const limited = await adminRateLimit(req)
  if (limited) return limited

  const auth = await requireAdmin(req)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { supabase, userId } = auth

  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

  const { action } = body

  switch (action) {

    // ── Approve agent ────────────────────────────────────────────────────────
    case "approve_agent": {
      const { agent_id, message } = body
      if (!agent_id || !UUID_RE.test(agent_id))
        return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

      const { error } = await supabase!.from("agents")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", agent_id)

      if (error) throw error

      // Notify seller
      const { data: agent } = await supabase!
        .from("agents").select("seller_id, name").eq("id", agent_id).single()
      if (agent) {
        await supabase!.from("notifications").insert({
          user_id:    agent.seller_id,
          title:      "Agent approved! 🎉",
          body:       `"${agent.name}" is now live on the marketplace.${message ? " " + message : ""}`,
          type:       "agent_approved",
          action_url: `/marketplace/${agent_id}`,
        })
      }

      await logAdminAction(supabase!, userId!, "approve_agent", "agents", agent_id, { message }, req)
      return NextResponse.json({ ok: true, agent_id, new_status: "active" })
    }

    // ── Reject agent ─────────────────────────────────────────────────────────
    case "reject_agent": {
      const { agent_id, reason } = body
      if (!agent_id || !UUID_RE.test(agent_id))
        return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })
      if (!reason || String(reason).trim().length < 10)
        return NextResponse.json({ error: "reason is required (min 10 chars)" }, { status: 400 })

      const { error } = await supabase!.from("agents")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", agent_id)

      if (error) throw error

      const { data: agent } = await supabase!
        .from("agents").select("seller_id, name").eq("id", agent_id).single()
      if (agent) {
        await supabase!.from("notifications").insert({
          user_id:    agent.seller_id,
          title:      "Agent needs revision",
          body:       `"${agent.name}" was not approved. Reason: ${String(reason).slice(0, 300)}`,
          type:       "agent_rejected",
          action_url: `/builder/${agent_id}`,
        })
      }

      await logAdminAction(supabase!, userId!, "reject_agent", "agents", agent_id, { reason }, req)
      return NextResponse.json({ ok: true, agent_id, new_status: "rejected" })
    }

    // ── Suspend agent ─────────────────────────────────────────────────────────
    case "suspend_agent": {
      const { agent_id, reason } = body
      if (!agent_id || !UUID_RE.test(agent_id))
        return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

      await supabase!.from("agents")
        .update({ status: "suspended", updated_at: new Date().toISOString() })
        .eq("id", agent_id)

      await logAdminAction(supabase!, userId!, "suspend_agent", "agents", agent_id, { reason }, req)
      return NextResponse.json({ ok: true, agent_id, new_status: "suspended" })
    }

    // ── Ban user ──────────────────────────────────────────────────────────────
    case "ban_user": {
      const { user_id: targetId, reason } = body
      if (!targetId || !UUID_RE.test(targetId))
        return NextResponse.json({ error: "Valid user_id required" }, { status: 400 })
      if (!reason)
        return NextResponse.json({ error: "reason is required" }, { status: 400 })

      // Prevent self-ban
      if (targetId === userId)
        return NextResponse.json({ error: "Cannot ban yourself" }, { status: 400 })

      await supabase!.from("profiles")
        .update({ is_banned: true, updated_at: new Date().toISOString() })
        .eq("id", targetId)

      await logAdminAction(supabase!, userId!, "ban_user", "profiles", targetId, { reason }, req)
      return NextResponse.json({ ok: true, user_id: targetId, banned: true })
    }

    // ── Unban user ────────────────────────────────────────────────────────────
    case "unban_user": {
      const { user_id: targetId } = body
      if (!targetId || !UUID_RE.test(targetId))
        return NextResponse.json({ error: "Valid user_id required" }, { status: 400 })

      await supabase!.from("profiles")
        .update({ is_banned: false, updated_at: new Date().toISOString() })
        .eq("id", targetId)

      await logAdminAction(supabase!, userId!, "unban_user", "profiles", targetId, {}, req)
      return NextResponse.json({ ok: true, user_id: targetId, banned: false })
    }

    // ── Set featured ──────────────────────────────────────────────────────────
    case "set_featured": {
      const { agent_id, featured } = body
      if (!agent_id || !UUID_RE.test(agent_id))
        return NextResponse.json({ error: "Valid agent_id required" }, { status: 400 })

      await supabase!.from("agents")
        .update({ is_featured: !!featured, updated_at: new Date().toISOString() })
        .eq("id", agent_id)

      await logAdminAction(supabase!, userId!, "set_featured", "agents", agent_id, { featured }, req)
      return NextResponse.json({ ok: true, agent_id, is_featured: !!featured })
    }

    // ── Approve review ────────────────────────────────────────────────────────
    case "approve_review": {
      const { review_id } = body
      if (!review_id || !UUID_RE.test(review_id))
        return NextResponse.json({ error: "Valid review_id required" }, { status: 400 })

      await supabase!.from("reviews")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", review_id)

      await logAdminAction(supabase!, userId!, "approve_review", "reviews", review_id, {}, req)
      return NextResponse.json({ ok: true, review_id, status: "approved" })
    }

    // ── Reject review ─────────────────────────────────────────────────────────
    case "reject_review": {
      const { review_id } = body
      if (!review_id || !UUID_RE.test(review_id))
        return NextResponse.json({ error: "Valid review_id required" }, { status: 400 })

      await supabase!.from("reviews")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", review_id)

      await logAdminAction(supabase!, userId!, "reject_review", "reviews", review_id, {}, req)
      return NextResponse.json({ ok: true, review_id, status: "rejected" })
    }

    default:
      return NextResponse.json({
        error: `Unknown action: "${action}". Valid: approve_agent, reject_agent, suspend_agent, ban_user, unban_user, set_featured, approve_review, reject_review`,
      }, { status: 400 })
  }
}
