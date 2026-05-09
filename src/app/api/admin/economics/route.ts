export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRBAC }           from "@/lib/rbac"

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const rbac = await getRBAC(supabase, user.id)
    if (!rbac.isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

    const admin = createAdminClient()

    const [
      txResult,
      execResult,
      topCostResult,
      dailyResult,
      userSpendResult,
    ] = await Promise.all([
      // Total revenue from succeeded transactions
      admin.from("transactions").select("amount, created_at").eq("status", "succeeded"),

      // Execution cost & token aggregates
      admin.from("executions")
        .select("cost_usd, tokens_input, tokens_output, status, selected_model, user_id, created_at")
        .not("cost_usd", "is", null)
        .order("created_at", { ascending: false })
        .limit(1000),

      // Top 10 most expensive executions
      admin.from("executions")
        .select("id, cost_usd, tokens_input, tokens_output, status, selected_model, user_id, created_at, agents!agent_id(name)")
        .not("cost_usd", "is", null)
        .order("cost_usd", { ascending: false })
        .limit(10),

      // Daily revenue last 30 days (for chart)
      admin.from("transactions")
        .select("amount, created_at")
        .eq("status", "succeeded")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // Top spending users
      admin.from("profiles")
        .select("id, full_name, email, total_spent, total_earned, subscription_plan")
        .order("total_spent", { ascending: false })
        .limit(10),
    ])

    const transactions  = txResult.data ?? []
    const executions    = execResult.data ?? []
    const topExecutions = topCostResult.data ?? []
    const dailyTxns     = dailyResult.data ?? []
    const topUsers      = userSpendResult.data ?? []

    // Compute aggregates
    const grossRevenue   = transactions.reduce((s, t) => s + Number(t.amount), 0)
    const platformFee    = grossRevenue * 0.20
    const totalLLMCost   = executions.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0)
    const grossMargin    = grossRevenue > 0 ? ((grossRevenue - totalLLMCost) / grossRevenue) * 100 : 0
    const avgCostPerExec = executions.length > 0 ? totalLLMCost / executions.length : 0
    const totalTokensIn  = executions.reduce((s, e) => s + Number(e.tokens_input ?? 0), 0)
    const totalTokensOut = executions.reduce((s, e) => s + Number(e.tokens_output ?? 0), 0)

    // Cost savings from routing (haiku vs sonnet baseline)
    const SONNET_COST_PER_TOKEN = 0.000003 // $3/M tokens (approximate)
    const haikuExecs  = executions.filter(e => e.selected_model?.includes("haiku"))
    const costSaved   = haikuExecs.reduce((s, e) => {
      const actual  = Number(e.cost_usd ?? 0)
      const tokens  = Number(e.tokens_input ?? 0) + Number(e.tokens_output ?? 0)
      const baseline = tokens * SONNET_COST_PER_TOKEN
      return s + Math.max(0, baseline - actual)
    }, 0)

    // Daily chart data (last 30 days)
    const dailyMap: Record<string, number> = {}
    for (const tx of dailyTxns) {
      const day = tx.created_at.slice(0, 10)
      dailyMap[day] = (dailyMap[day] ?? 0) + Number(tx.amount)
    }
    const dailyRevenue = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }))

    return NextResponse.json({
      grossRevenue:    Math.round(grossRevenue   * 100) / 100,
      platformFee:     Math.round(platformFee    * 100) / 100,
      totalLLMCost:    Math.round(totalLLMCost   * 100) / 100,
      grossMarginPct:  Math.round(grossMargin    * 10)  / 10,
      avgCostPerExec:  Math.round(avgCostPerExec * 1e6) / 1e6,
      costSavedRouting:Math.round(costSaved      * 100) / 100,
      totalTokensIn,
      totalTokensOut,
      topExecutions: topExecutions.map(e => ({
        id:        e.id,
        cost:      e.cost_usd,
        model:     e.selected_model,
        status:    e.status,
        user_id:   e.user_id,
        agent:     (e as any).agents?.name ?? "—",
        created_at:e.created_at,
      })),
      topSpenders: topUsers.map(u => ({
        id:    u.id,
        name:  u.full_name,
        email: u.email,
        spent: u.total_spent,
        earned:u.total_earned,
        plan:  u.subscription_plan,
      })),
      dailyRevenue,
    })
  } catch (err: any) {
    console.error("GET /api/admin/economics:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
