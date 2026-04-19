export const runtime = "edge"
/**
 * GET /api/admin/users
 * Returns paginated user list for admin user-management tab.
 * Uses service role — bypasses RLS, returns all users including admins.
 */
import { NextRequest, NextResponse } from "next/server"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { buildRBAC } from "@/lib/rbac"
import { apiRateLimit } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited
  try {
    const anonClient = await createClient()
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const adminDb = await createAdminClient()
    const { data: p } = await adminDb.from("profiles").select("role").eq("id", user.id).single()
    if (!buildRBAC(user.id, p?.role).isAdmin)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get("limit")  ?? "50")))
    const offset = Math.max(0,               parseInt(searchParams.get("offset") ?? "0"))
    const search = searchParams.get("q")?.trim() ?? ""

    let query = adminDb
      .from("profiles")
      .select(
        "id, full_name, email, created_at, updated_at, " +
        "subscription_plan, role, is_banned, is_verified, " +
        "total_earned, total_spent, executions_used_this_month, " +
        "monthly_execution_quota, stripe_connect_onboarded",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      // PostgREST OR filter for email or full_name search
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    }

    const { data: users, count, error } = await query
    if (error) throw error

    return NextResponse.json({
      users: users ?? [],
      total: count ?? 0,
      limit,
      offset,
    })
  } catch (err: any) {
    console.error("GET /api/admin/users:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users
 * Ban / unban a user. Uses service role to bypass RLS.
 */
export async function PATCH(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited
  try {
    const anonClient = await createClient()
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const adminDb = await createAdminClient()
    const { data: p } = await adminDb.from("profiles").select("role").eq("id", user.id).single()
    if (!buildRBAC(user.id, p?.role).isAdmin)
      return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { user_id, action } = body
    if (typeof user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(user_id))
      return NextResponse.json({ error: "Valid user_id is required" }, { status: 400 })
    if (action !== "ban" && action !== "unban")
      return NextResponse.json({ error: "action must be 'ban' or 'unban'" }, { status: 400 })

    // Prevent self-ban
    if (user_id === user.id)
      return NextResponse.json({ error: "Cannot ban your own account" }, { status: 400 })

    const { error: updateErr } = await adminDb
      .from("profiles")
      .update({ is_banned: action === "ban", updated_at: new Date().toISOString() })
      .eq("id", user_id)

    if (updateErr) throw updateErr

    // Audit log
    adminDb.from("audit_logs").insert({
      user_id:     user.id,
      actor_type:  "user",
      actor_id:    user.id,
      action:      `user.${action}ned`,
      resource:    "profiles",
      resource_id: user_id,
      payload:     { action, target_user_id: user_id },
    }).then()

    return NextResponse.json({ ok: true, user_id, action })
  } catch (err: any) {
    console.error("PATCH /api/admin/users:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}
