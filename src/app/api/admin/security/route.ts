export const runtime = "edge"
/**
 * GET /api/admin/security
 * Returns injection_attempts log for the Security tab.
 * Uses service role — bypasses RLS.
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
    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")))
    const action = searchParams.get("action") // "blocked" | "flagged" | null (all)

    let query = adminDb
      .from("injection_attempts")
      .select("id, user_id, agent_id, input, pattern, score, action, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (action === "blocked" || action === "flagged") {
      query = query.eq("action", action)
    }

    const { data: attempts, error } = await query
    if (error) throw error

    return NextResponse.json({ attempts: attempts ?? [], count: attempts?.length ?? 0 })
  } catch (err: any) {
    console.error("GET /api/admin/security:", err)
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 })
  }
}
