export const runtime = "edge"

/**
 * POST /api/agents/[id]/evaluate
 *
 * Runs the evaluation harness before marketplace submission.
 * Gates: reject (<70), pending_review (70-85), fast_track (>85).
 *
 * Auth: must be agent owner or admin.
 * Plan: free users blocked (cannot publish).
 * State: agent must be in draft | rejected.
 */

import { NextRequest, NextResponse }  from "next/server"
import { createClient }               from "@/lib/supabase/server"
import { apiRateLimit }               from "@/lib/rate-limit"
import { evaluateAgent, type TestCase, type AgentType } from "@/lib/evaluation-harness"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Strict rate-limit: 6 evals/min (each eval calls LLM 10× internally)
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id: agentId } = await params
    const supabase        = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // ── Fetch agent ──────────────────────────────────────────────────────────
    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, seller_id, status, category, model_name")
      .eq("id", agentId)
      .single()

    if (agentErr || !agent)
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    // ── Fetch profile (plan + email_verified + builder_rank) ─────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, email_verified, builder_rank, role")
      .eq("id", user.id)
      .single()

    const isAdmin = profile?.role === "admin"

    if (agent.seller_id !== user.id && !isAdmin)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // ── Plan gate: free users cannot publish ─────────────────────────────────
    if ((profile?.subscription_plan ?? "free") === "free" && !isAdmin)
      return NextResponse.json({
        error: "Upgrade to Starter or Pro to publish agents.",
        code:  "PLAN_RESTRICTION",
      }, { status: 403 })

    // ── Email verification gate ──────────────────────────────────────────────
    if (!profile?.email_verified && !isAdmin)
      return NextResponse.json({
        error: "Verify your email before submitting agents for review.",
        code:  "EMAIL_NOT_VERIFIED",
      }, { status: 403 })

    // ── Status gate ──────────────────────────────────────────────────────────
    if (!["draft", "rejected"].includes(agent.status))
      return NextResponse.json({
        error: `Agent is '${agent.status}'. Only draft/rejected agents can be evaluated.`,
        code:  "INVALID_STATUS",
      }, { status: 422 })

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: { tests?: { input: string; expectedOutput?: string }[] } = {}
    try { body = await req.json() } catch { /* empty body */ }

    const userTests: TestCase[] = (body.tests ?? [])
      .slice(0, 5)
      .filter(t => typeof t.input === "string" && t.input.trim().length > 0)
      .map(t => ({
        input:          t.input.slice(0, 2000),
        expectedOutput: t.expectedOutput?.slice(0, 2000),
        isHidden:       false,
        severity:       "normal" as const,
      }))

    if (userTests.length < 1)
      return NextResponse.json({ error: "Provide at least 1 test case." }, { status: 400 })

    // ── Fetch hidden tests for this category ─────────────────────────────────
    const { data: hiddenRaw } = await supabase
      .from("hidden_test_cases")
      .select("test_input, severity")
      .eq("is_active", true)
      .or(`category.eq.${agent.category},category.eq.__all__`)
      .limit(5)

    const hiddenTests: TestCase[] = (hiddenRaw ?? []).map(h => ({
      input:    typeof (h.test_input as any)?.text === "string"
        ? (h.test_input as any).text
        : JSON.stringify(h.test_input),
      isHidden: true,
      severity: (h.severity as TestCase["severity"]) ?? "normal",
    }))

    // ── Run evaluation ───────────────────────────────────────────────────────
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

    // Determine agent type from model/config (default single if unknown)
    const agentType: AgentType = "single"

    const result = await evaluateAgent({
      agentId,
      agentType,
      userTests,
      hiddenTests,
      executeUrl: `${baseUrl}/api/execute`,
      authToken:  serviceKey,
    })

    // ── Persist evaluation rows ──────────────────────────────────────────────
    const runBatch = crypto.randomUUID()
    await supabase.from("agent_evaluations").insert(
      result.runs.map(r => ({
        agent_id:          agentId,
        evaluator_id:      user.id,
        run_batch:         runBatch,
        test_input:        { text: r.testInput },
        actual_output:     r.actualOutput ? { text: r.actualOutput } : null,
        passed:            r.passed,
        latency_ms:        r.latencyMs,
        cost_usd:          r.costUsd,
        correctness_score: r.correctnessScore,
        is_hidden_test:    r.isHidden,
        error_message:     r.errorMessage ?? null,
      }))
    )

    // ── Update agent ─────────────────────────────────────────────────────────
    const newStatus = result.gate === "reject" ? "rejected" : "pending_review"

    await supabase.from("agents").update({
      evaluation_score:    result.totalScore,
      evaluation_passed:   result.gate !== "reject",
      evaluation_runs:     result.stats.totalRuns,
      evaluation_metadata: {
        gate:         result.gate,
        breakdown:    result.breakdown,
        stats:        result.stats,
        run_batch:    runBatch,
        evaluated_at: new Date().toISOString(),
      },
      last_evaluated_at: new Date().toISOString(),
      status:            newStatus,
    }).eq("id", agentId)

    // ── Builder rank boost on fast_track ─────────────────────────────────────
    if (result.gate === "fast_track") {
      await supabase.from("profiles").update({
        builder_score: supabase.rpc("least", { a: 100, b: (profile?.builder_rank ?? 0) + 2 }),
      }).eq("id", user.id).select()
      // Simple increment without RPC:
      await supabase.rpc("increment_rate_limit", {
        key_param:        `builder_score:${user.id}`,
        window_end_param: new Date(Date.now() + 86_400_000).toISOString(),
        limit_param:      999,
      }).throwOnError().catch(() => null)
    }

    // ── Return (never expose hidden test inputs) ──────────────────────────────
    return NextResponse.json({
      score:          result.totalScore,
      gate:           result.gate,
      status:         newStatus,
      breakdown:      result.breakdown,
      stats:          result.stats,
      recommendation: result.recommendation,
      runs: result.runs.map(r => ({
        ...r,
        testInput:    r.isHidden ? "[hidden]" : r.testInput,
        actualOutput: r.isHidden ? "[hidden]" : r.actualOutput,
      })),
    })

  } catch (err: any) {
    console.error("[evaluate]", err)
    return NextResponse.json({ error: err.message || "Evaluation failed" }, { status: 500 })
  }
}
