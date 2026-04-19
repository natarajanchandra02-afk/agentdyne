export const runtime = 'edge'

/**
 * POST /api/thoughtgate/feedback
 *
 * RLHF-style signal to update ThoughtGate template success rates.
 * Called after executions are rated by users (via /api/feedback).
 *
 * This is a lightweight endpoint — the actual template EMA update
 * is done in-memory (per-isolate). For production-scale persistence,
 * template success rates should be stored in Supabase and loaded
 * at isolate boot.
 *
 * Body:
 *   template_id  string   — which thought template was applied
 *   success      boolean  — was the output good (thumbs up / rating >= 4)?
 *   execution_id string?  — for audit trail
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

    const { template_id, success, execution_id } = body

    if (!template_id || typeof template_id !== "string" || template_id.trim().length === 0)
      return NextResponse.json({ error: "template_id is required" }, { status: 400 })

    if (typeof success !== "boolean")
      return NextResponse.json({ error: "success must be a boolean" }, { status: 400 })

    if (execution_id && !UUID_RE.test(execution_id))
      return NextResponse.json({ error: "execution_id must be a valid UUID" }, { status: 400 })

    // Verify execution belongs to this user (prevents poisoning other users' feedback)
    if (execution_id) {
      const { data: exec } = await supabase
        .from("executions")
        .select("user_id")
        .eq("id", execution_id)
        .single()

      if (exec && exec.user_id !== user.id)
        return NextResponse.json({ error: "You can only provide feedback for your own executions" }, { status: 403 })
    }

    // Update the in-memory EMA for this template
    // In a multi-isolate deployment, this only affects the current isolate.
    // For persistence at scale: store in a `thoughtgate_template_stats` table
    // and load in a middleware or on-demand.
    thoughtGate.updateTemplateSuccessRate(template_id.trim(), success)

    return NextResponse.json({
      ok:          true,
      template_id: template_id.trim(),
      success,
      message:     "Template feedback recorded. Thank you for improving AI quality.",
    })

  } catch (err: any) {
    console.error("POST /api/thoughtgate/feedback:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/thoughtgate/templates
 * Returns built-in reasoning templates (for documentation/transparency).
 */
export async function GET(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const templates = thoughtGate.getTemplates().map(t => ({
    id:          t.id,
    name:        t.id.replace(/_/g, " "),
    intentType:  t.intentType,
    stepCount:   t.steps.length,
    successRate: t.successRate,
    keywords:    t.keywords.slice(0, 5),  // partial — don't expose full matching logic
  }))

  return NextResponse.json({ templates, count: templates.length })
}
