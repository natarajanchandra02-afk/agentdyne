import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// GET /api/user/quota
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("subscription_plan, monthly_execution_quota, executions_used_this_month, quota_reset_date")
      .eq("id", user.id)
      .single()

    if (error || !profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const quota     = profile.monthly_execution_quota  ?? 100
    const used      = profile.executions_used_this_month ?? 0
    const unlimited = quota === -1
    const remaining = unlimited ? -1 : Math.max(0, quota - used)
    const pct       = unlimited ? 0 : parseFloat(Math.min(100, (used / quota) * 100).toFixed(2))
    const now       = new Date()
    const resetsAt  = profile.quota_reset_date
      ?? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    return NextResponse.json({
      plan: profile.subscription_plan ?? "free",
      quota, used, remaining,
      percentUsed: pct,
      resetsAt,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
