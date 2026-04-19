export const runtime = 'edge'

/**
 * POST /api/thoughtgate/feedback
 *
 * Reports execution outcome back to ThoughtGate's EMA (Exponential Moving Average)
 * template success rate updater.
 *
 * Called after an agent execution completes to update:
 *   1. The in-memory ThoughtGate template success rate (EMA, alpha=0.05)
 *   2. The `thoughtgate_template_stats` table for cross-process persistence
 *
 * Body:
 *   execution_id   string   — UUID of the execution
 *   template_id    string?  — ThoughtGate template ID that was used (from execute response)
 *   intent_type    string?  — detected intent type
 *   success        boolean  — was the execution satisfactory?
 *   latency_ms     number?  — actual latency
 *   tokens_used    number?  — actual tokens consumed
 *
 * GET /api/thoughtgate/feedback — returns template statistics (admin only)
 * GET /api/thoughtgate/feedback?templates=true — returns all template definitions
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { thoughtGate } from "@/lib/thoughtgate"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: any
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { execution_id, template_id, intent_type, success, latency_ms, tokens_used } = body

    if (typeof success !== "boolean")
      return NextResponse.json({ error: "success (boolean) is required" }, { status: 400 })

    if (execution_id && !UUID_RE.test(execution_id))
      return NextResponse.json({ error: "Invalid execution_id format" }, { status: 400 })

    // Verify the execution belongs to this user
    if (execution_id) {
      const { data: exec } = await supabase
        .from("executions")
        .select("user_id")
        .eq("id", execution_id)
        .single()

      if (exec && exec.user_id !== user.id)
        return NextResponse.json({ error: "Execution belongs to a different user" }, { status: 403 })
    }

    // 1. Update in-process EMA for the template
    if (template_id && typeof template_id === "string") {
      thoughtGate.updateTemplateSuccessRate(template_id, success)
    }

    // 2. Persist to DB for cross-process/cross-restart aggregation
    // Uses upsert so the first feedback creates the row
    if (template_id) {
      await supabase
        .from("thoughtgate_template_stats")
        .upsert({
          template_id:    String(template_id).slice(0, 100),
          intent_type:    intent_type ? String(intent_type).slice(0, 50) : null,
          total_calls:    1,
          success_calls:  success ? 1 : 0,
          failure_calls:  success ? 0 : 1,
          last_updated:   new Date().toISOString(),
        }, { onConflict: "template_id" })
        .then(() => {})
        // Gracefully handle missing table (migration 012 needed)
    }

    // 3. Tag the execution with the feedback outcome
    if (execution_id) {
      await supabase
        .from("execution_traces")
        .update({ status: success ? "success" : "failed" })
        .eq("execution_id", execution_id)
        .eq("user_id", user.id)
        .then(() => {})
    }

    return NextResponse.json({
      ok:                  true,
      template_id:         template_id ?? null,
      ema_updated:         !!template_id,
      message:             `ThoughtGate EMA ${template_id ? `updated for template '${template_id}'` : "not updated (no template_id)"}`,
    })

  } catch (err: any) {
    console.error("POST /api/thoughtgate/feedback:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const showTemplates = searchParams.get("templates") === "true"

    // Anyone can see template definitions
    if (showTemplates) {
      return NextResponse.json({
        templates: thoughtGate.getTemplates().map(t => ({
          id:           t.id,
          pattern:      t.pattern,
          intentType:   t.intentType,
          steps:        t.steps,
          keywords:     t.keywords,
          successRate:  t.successRate,
        })),
      })
    }

    // Stats require admin
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single()
    if (profile?.role !== "admin")
      return NextResponse.json({ error: "Admin access required for stats" }, { status: 403 })

    // Return template stats from DB + current in-process EMA rates
    const { data: stats } = await supabase
      .from("thoughtgate_template_stats")
      .select("*")
      .order("total_calls", { ascending: false })

    // Merge with current in-memory EMA rates
    const templates = thoughtGate.getTemplates()
    const merged = templates.map(t => {
      const dbStat = (stats ?? []).find((s: any) => s.template_id === t.id)
      return {
        id:            t.id,
        pattern:       t.pattern,
        intentType:    t.intentType,
        ema_rate:      t.successRate,
        db_total:      dbStat?.total_calls ?? 0,
        db_success:    dbStat?.success_calls ?? 0,
        db_failure:    dbStat?.failure_calls ?? 0,
        db_rate:       dbStat?.total_calls
          ? +(dbStat.success_calls / dbStat.total_calls).toFixed(3)
          : null,
        last_updated:  dbStat?.last_updated ?? null,
      }
    })

    return NextResponse.json({ template_stats: merged })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
