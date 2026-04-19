export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRBAC }           from "@/lib/rbac"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const limit  = Math.min(200, parseInt(searchParams.get("limit") ?? "50"))
    const q      = searchParams.get("q") ?? ""

    const admin = createAdminClient()

    let query = admin
      .from("profiles")
      .select("id, full_name, email, created_at, subscription_plan, role, is_banned, total_earned, total_spent")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (q.trim()) {
      query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`) as typeof query
    }

    const { data: users, error: dbErr } = await query
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

    return NextResponse.json({ users: users ?? [], count: users?.length ?? 0 })
  } catch (err: any) {
    console.error("GET /api/admin/users:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH — ban / unban / change role
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const body = await req.json()
    const { user_id, action } = body

    if (!user_id || !UUID_RE.test(user_id))
      return NextResponse.json({ error: "Valid user_id required" }, { status: 400 })

    // Prevent self-modification
    if (user_id === user.id)
      return NextResponse.json({ error: "Cannot modify your own account" }, { status: 400 })

    const admin = createAdminClient()

    if (action === "ban" || action === "unban") {
      const { error } = await admin.from("profiles")
        .update({ is_banned: action === "ban", updated_at: new Date().toISOString() })
        .eq("id", user_id)
      if (error) throw error
      return NextResponse.json({ ok: true, action })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
