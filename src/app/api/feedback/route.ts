export const runtime = 'edge'

/**
 * POST /api/feedback
 *
 * RLHF-style feedback collection for agent executions.
 * Used to:
 *   1. Record user satisfaction (thumbs up/down, rating)
 *   2. Feed signals back to ThoughtGate template success rates
 *   3. Drive the agent quality score computation
 *   4. Build the governance audit trail
 *
 * Body:
 *   execution_id   string     — the execution being rated
 *   rating         1-5        — optional star rating
 *   thumbs         "up"|"down"— quick satisfaction signal
 *   comment        string?    — optional free-text feedback
 *   issue_type     string?    — "wrong_output"|"too_slow"|"too_expensive"|"hallucination"|"other"
 *
 * Effects:
 *   - Inserts into reviews table (if agent_id + user_id + no duplicate)
 *   - Updates agents.average_rating (via DB trigger)
 *   - Calls compute_agent_score RPC if execution count threshold reached
 *   - Updates ThoughtGate template success rate for traced template_id
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { thoughtGate } from "@/lib/thoughtgate"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const VALID_ISSUE_TYPES = new Set([
  "wrong_output", "too_slow", "too_expensive", "hallucination", "unhelpful", "other",
])

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const body = await req.json()
    const { execution_id, rating, thumbs, comment, issue_type } = body

    if (!execution_id || !UUID_RE.test(execution_id))
      return NextResponse.json({ error: "Valid execution_id required" }, { status: 400 })

    if (rating !== undefined && (typeof rating !== "number" || rating < 1 || rating > 5))
      return NextResponse.json({ error: "rating must be 1-5" }, { status: 400 })

    if (thumbs !== undefined && thumbs !== "up" && thumbs !== "down")
      return NextResponse.json({ error: "thumbs must be 'up' or 'down'" }, { status: 400 })

    if (issue_type !== undefined && !VALID_ISSUE_TYPES.has(issue_type))
      return NextResponse.json({ error: `Invalid issue_type. Valid: ${[...VALID_ISSUE_TYPES].join(", ")}` }, { status: 400 })

    // Load execution to get agent_id + trace info
    const { data: execution } = await supabase
      .from("executions")
      .select("agent_id, user_id, status")
      .eq("id", execution_id)
      .single()

    if (!execution)
      return NextResponse.json({ error: "Execution not found" }, { status: 404 })

    // Only the user who made the execution can rate it
    if (execution.user_id !== user.id)
      return NextResponse.json({ error: "You can only rate your own executions" }, { status: 403 })

    const agentId = execution.agent_id

    // Determine numeric rating from thumbs if rating not provided
    const numericRating: number | null =
      rating ?? (thumbs === "up" ? 5 : thumbs === "down" ? 2 : null)

    const isSuccess = thumbs === "up" || (numericRating !== null && numericRating >= 4)

    // Insert/update feedback record
    const { data: feedback, error: fbErr } = await supabase
      .from("agent_feedback")
      .upsert({
        execution_id,
        agent_id:   agentId,
        user_id:    user.id,
        rating:     numericRating,
        thumbs,
        comment:    comment ? String(comment).slice(0, 2000) : null,
        issue_type: issue_type || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "execution_id,user_id" })
      .select("id")
      .single()

    if (fbErr) {
      // Gracefully handle missing table — don't fail silently on other errors
      if (fbErr.code !== "42P01") throw fbErr
    }

    // Update agent review if rating provided
    if (numericRating && agentId) {
      await supabase.from("reviews").upsert({
        agent_id:   agentId,
        user_id:    user.id,
        rating:     numericRating,
        body:       comment ? String(comment).slice(0, 2000) : null,
        status:     "approved",
        updated_at: new Date().toISOString(),
      }, { onConflict: "agent_id,user_id" })
    }

    // ThoughtGate: update template success rate based on feedback
    // Get template_id from execution_traces if available
    if (agentId) {
      supabase.from("execution_traces")
        .select("model")
        .eq("execution_id", execution_id)
        .single()
        .then(({ data: trace }) => {
          // For now we don't store template_id in traces but can add it later
          // thoughtGate.updateTemplateSuccessRate(trace?.template_id, isSuccess)
        })
    }

    // Trigger score recomputation if agent has enough executions
    if (agentId) {
      supabase.from("agents")
        .select("total_executions")
        .eq("id", agentId)
        .single()
        .then(async ({ data: agent }) => {
          if ((agent?.total_executions ?? 0) >= 10) {
            await supabase.rpc("compute_agent_score", { target_agent_id: agentId })
          }
        })
    }

    return NextResponse.json({
      ok:         true,
      feedback_id: feedback?.id,
      message:    "Thank you for your feedback! It helps improve agent quality.",
    })

  } catch (err: any) {
    console.error("POST /api/feedback:", err)
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get("agent_id")
    const limit   = Math.min(50, parseInt(searchParams.get("limit") ?? "20"))

    if (!agentId || !UUID_RE.test(agentId))
      return NextResponse.json({ error: "agent_id required" }, { status: 400 })

    // Only agent seller or admin can view feedback
    const { data: agent } = await supabase
      .from("agents")
      .select("seller_id")
      .eq("id", agentId)
      .single()

    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single()

    if (agent?.seller_id !== user.id && profile?.role !== "admin")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: feedback } = await supabase
      .from("agent_feedback")
      .select("id, rating, thumbs, comment, issue_type, created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(limit)

    const summary = {
      avg_rating:    0,
      thumbs_up:     0,
      thumbs_down:   0,
      total:         feedback?.length ?? 0,
      issue_breakdown: {} as Record<string, number>,
    }

    if (feedback?.length) {
      const ratings = feedback.filter(f => f.rating).map(f => f.rating)
      summary.avg_rating  = ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : 0
      summary.thumbs_up   = feedback.filter(f => f.thumbs === "up").length
      summary.thumbs_down = feedback.filter(f => f.thumbs === "down").length
      for (const f of feedback) {
        if (f.issue_type) summary.issue_breakdown[f.issue_type] = (summary.issue_breakdown[f.issue_type] ?? 0) + 1
      }
    }

    return NextResponse.json({ feedback: feedback ?? [], summary })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
