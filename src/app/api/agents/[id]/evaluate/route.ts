export const runtime = "edge"

/**
 * POST /api/agents/[id]/evaluate
 *
 * Triggers the evaluation harness before marketplace submission.
 * Runs user-provided tests + hidden platform tests, scores the agent,
 * persists results, and updates agents.status + evaluation_score.
 *
 * Caller must be the agent's seller (or admin).
 * Free users cannot submit for review (only paid plans can publish).
 *
 * Response:
 *   200 { score, gate, breakdown, stats, recommendation }
 *   403 { error: "plan restriction" }
 *   422 { error: "agent not ready for evaluation" }
 */

import { NextRequest, NextResponse }   from "next/server"
import { createClient }                from "@/lib/supabase/server"
import { getRBAC }                     from "@/lib/rbac"
import { strictRateLimit }             from "@/lib/rate-limit"
import { evaluateAgent, type TestCase, type AgentType } from "@/lib/evaluation-harness"

const FREE_PLANS: Set<string> = new Set(["free"])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await strictRateLimit(req)   // 10/min — eval is expensive
  if (limited) return limited

  try {
    const { id: agentId } = await params
    const supabase        = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // ── RBAC: must be owner or admin ────────────────────────────────────────
    const rbac = await getRBAC(supabase, user.id)

    const { data: agent, error: agentErr } = await supabase
      .from("agents")
      .select("id, seller_id, status, category, agent_type, evaluation_score")
      .eq("id", agentId)
      .single()

    if (agentErr || !agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    if (agent.seller_id !== user.id && !rbac.isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // ── Plan gate: free users cannot publish ────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, email_verified, builder_rank")
      .eq("id", user.id)
      .single()

    if (FREE_PLANS.has(profile?.subscription_plan ?? "free") && !rbac.isAdmin) {
      return NextResponse.json({
        error: "Free plan users cannot publish to the marketplace. Upgrade to Starter or Pro.",
        code:  "PLAN_RESTRICTION",
      }, { status: 403 })
    }

    // ── Email verification gate ─────────────────────────────────────────────
    if (!profile?.email_verified && !rbac.isAdmin) {
      return NextResponse.json({
        error: "Please verify your email address before submitting agents for review.",
        code:  "EMAIL_NOT_VERIFIED",
      }, { status: 403 })
    }

    // ── Agent must be in draft ──────────────────────────────────────────────
    if (!["draft", "rejected"].includes(agent.status)) {
      return NextResponse.json({
        error: `Agent is currently '${agent.status}'. Only draft or rejected agents can be evaluated.`,
        code:  "INVALID_STATUS",
      }, { status: 422 })
    }

    // ── Parse user-provided test cases ──────────────────────────────────────
    let body: { tests?: Array<{ input: string; expectedOutput?: string }> } = {}
    try { body = await req.json() } catch { /* no body = no user tests */ }

    const userTests: TestCase[] = (body.tests ?? [])
      .slice(0, 5)
      .filter(t => t.input && typeof t.input === "string" && t.input.trim().length > 0)
      .map(t => ({
        input:          t.input.slice(0, 2000),
        expectedOutput: t.expectedOutput?.slice(0, 2000),
        isHidden:       false,
        severity:       "normal" as const,
      }))

    if (userTests.length < 1) {
      return NextResponse.json({
        error: "Provide at least 1 test case (input string).",
        code:  "NO_TEST_CASES",
      }, { status: 400 })
    }

    // ── Fetch hidden tests for this category ────────────────────────────────
    const { data: hiddenRaw } = await supabase
      .from("hidden_test_cases")
      .select("test_input, description, severity")
      .eq("is_active", true)
      .or(`category.eq.${agent.category},category.eq.__all__`)
      .limit(5)

    const hiddenTests: TestCase[] = (hiddenRaw ?? []).map(h => ({
      input:    (h.test_input as any)?.text ?? JSON.stringify(h.test_input),
      isHidden: true,
      severity: (h.severity as "normal" | "edge" | "adversarial") ?? "normal",
    }))

    // ── Run evaluation ──────────────────────────────────────────────────────
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || "https://agentdyne.com"
    const executeUrl = `${baseUrl}/api/execute`

    // Use a service-role token for internal evaluation calls
    // (evaluation runs don't charge the user's credits)
    const serviceToken = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

    const evalResult = await evaluateAgent({
      agentId,
      agentType: (agent.agent_type as AgentType) ?? "single",
      userTests,
      hiddenTests,
      executeUrl,
      authToken: serviceToken,
    })

    // ── Persist evaluation results ──────────────────────────────────────────
    const runBatch = crypto.randomUUID()
    const evalRows = evalResult.runs.map(r => ({
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

    await supabase.from("agent_evaluations").insert(evalRows)

    // ── Update agent status + evaluation columns ────────────────────────────
    const newStatus =
      evalResult.gate === "reject"        ? "rejected" :
      evalResult.gate === "fast_track" &&
        (profile?.builder_rank ?? 0) >= 1 ? "pending_review" :
                                             "pending_review"

    await supabase.from("agents").update({
      evaluation_score:    evalResult.totalScore,
      evaluation_passed:   evalResult.gate !== "reject",
      evaluation_runs:     (agent.evaluation_score ? 1 : 0) + evalResult.stats.totalRuns,
      evaluation_metadata: {
        gate:        evalResult.gate,
        breakdown:   evalResult.breakdown,
        stats:       evalResult.stats,
        run_batch:   runBatch,
        evaluated_at: new Date().toISOString(),
      },
      last_evaluated_at:   new Date().toISOString(),
      status:              newStatus,
    }).eq("id", agentId)

    // ── Return result (never expose hidden test inputs/outputs) ─────────────
    const safeRuns = evalResult.runs.map(r => ({
      ...r,
      testInput:    r.isHidden ? "[hidden test]"   : r.testInput,
      actualOutput: r.isHidden ? "[hidden result]"  : r.actualOutput,
    }))

    return NextResponse.json({
      score:          evalResult.totalScore,
      gate:           evalResult.gate,
      status:         newStatus,
      breakdown:      evalResult.breakdown,
      stats:          evalResult.stats,
      recommendation: evalResult.recommendation,
      runs:           safeRuns,
    })

  } catch (err: any) {
    console.error("POST /api/agents/[id]/evaluate:", err)
    return NextResponse.json({ error: err.message || "Evaluation failed" }, { status: 500 })
  }
}
