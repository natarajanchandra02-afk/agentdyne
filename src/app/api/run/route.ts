export const runtime = "edge"

/**
 * POST /api/run — Async execution queue entry point
 *
 * Decouples the edge API from long-running AI calls.
 * Returns immediately with { executionId, status: "queued" }.
 * The worker (Edge Function or pg_cron + webhook) processes jobs.
 *
 * Flow:
 *   Client → POST /api/run → enqueue → 202 { jobId, executionId }
 *   Worker → claim_queue_jobs() → execute → update execution → POST callback_url
 *
 * Auth: session or Bearer API key.
 * Rate: same plan-aware limits as /api/execute (same pre-flight).
 */

import { NextRequest, NextResponse }   from "next/server"
import { createClient }                from "@/lib/supabase/server"
import { apiRateLimit }               from "@/lib/rate-limit"
import { checkInput }                  from "@/lib/guardrails"
import { PLAN_QUOTAS, PLAN_COMPUTE_CAPS, PLAN_CONCURRENCY, FEATURE_FLAGS } from "@/lib/constants"
import { estimateExecutionCost }       from "@/lib/anti-abuse"

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let userId = user?.id
    // API key auth
    const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!userId && apiKey) {
      const { data: keyData } = await supabase.from("api_keys")
        .select("user_id, is_active").eq("key_hash", await hashApiKey(apiKey)).single()
      if (!keyData?.is_active) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })
      userId = keyData.user_id
      supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", await hashApiKey(apiKey)).then()
    }
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    let body: any
    try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

    const { agentId, input, idempotencyKey, callbackUrl } = body

    if (!agentId || typeof agentId !== "string" || !/^[0-9a-f-]{36}$/i.test(agentId))
      return NextResponse.json({ error: "Valid agentId required" }, { status: 400 })

    // ── Idempotency check ─────────────────────────────────────────────────────
    const idempKey = idempotencyKey ?? req.headers.get("x-idempotency-key")
    if (idempKey) {
      const { data: existing } = await supabase
        .from("execution_queue")
        .select("id, status, execution_id")
        .eq("idempotency_key", idempKey)
        .eq("user_id", userId)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ jobId: existing.id, executionId: existing.execution_id, status: existing.status, replayed: true }, { status: 200 })
      }
    }

    // ── Profile checks ────────────────────────────────────────────────────────
    const { data: profile } = await supabase.from("profiles")
      .select("subscription_plan, executions_used_this_month, monthly_execution_quota, lifetime_executions_used, monthly_spent_usd, compute_cap_usd, is_banned, email_verified")
      .eq("id", userId).single()

    if (profile?.is_banned) return NextResponse.json({ error: "Account suspended" }, { status: 403 })
    if (!profile?.email_verified) return NextResponse.json({ error: "Email verification required", code: "EMAIL_NOT_VERIFIED" }, { status: 403 })

    const plan = (profile?.subscription_plan ?? "free") as string

    // Free lifetime cap
    if (plan === "free" && (profile?.lifetime_executions_used ?? 0) >= PLAN_QUOTAS.free)
      return NextResponse.json({ error: `Free plan: ${PLAN_QUOTAS.free} lifetime execution limit reached. Upgrade to continue.`, code: "LIFETIME_QUOTA_EXCEEDED" }, { status: 429 })

    // Paid quota
    if (plan !== "free") {
      const quota = profile?.monthly_execution_quota ?? (PLAN_QUOTAS[plan] ?? 500)
      if (quota !== -1 && (profile?.executions_used_this_month ?? 0) >= quota)
        return NextResponse.json({ error: "Monthly quota exceeded", code: "QUOTA_EXCEEDED" }, { status: 429 })
    }

    // Compute cap
    const cap   = profile?.compute_cap_usd ?? (PLAN_COMPUTE_CAPS[plan] ?? 10)
    const spent = profile?.monthly_spent_usd ?? 0
    if (cap !== -1 && spent >= cap)
      return NextResponse.json({ error: `Compute cap $${cap} reached`, code: "COMPUTE_CAP_EXCEEDED" }, { status: 429 })

    // ── Load agent ─────────────────────────────────────────────────────────────
    const { data: agent } = await supabase.from("agents")
      .select("id, status, model_name, system_prompt, max_tokens, temperature, pricing_model, security_config")
      .eq("id", agentId).eq("status", "active").single()
    if (!agent) return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    if (plan === "free" && agent.pricing_model !== "free") return NextResponse.json({ error: "Free plan: only free agents available", code: "PLAN_RESTRICTION" }, { status: 403 })

    // ── Input guard ────────────────────────────────────────────────────────────
    const inputStr = typeof input === "string" ? input : JSON.stringify(input ?? "")
    const inputCheck = checkInput(inputStr, (agent.security_config ?? {}) as any)
    if (!inputCheck.allowed) return NextResponse.json({ error: "Input blocked by content policy", code: "CONTENT_POLICY", blocked_by: inputCheck.blocked_by }, { status: 422 })

    // ── Cost estimate ──────────────────────────────────────────────────────────
    const estimate = estimateExecutionCost({
      inputText:     inputStr,
      systemPrompt:  agent.system_prompt ?? "",
      modelName:     agent.model_name    ?? "claude-haiku-4-5-20251001",
      maxTokens:     agent.max_tokens    ?? 2000,
      plan:          plan as any,
      creditBalance: 999,  // queue: credit check happens at worker time
    })

    // ── Enqueue job ────────────────────────────────────────────────────────────
    const { data: job, error: qErr } = await supabase
      .from("execution_queue")
      .insert({
        user_id:         userId,
        agent_id:        agentId,
        input:           typeof input === "string" ? { text: input } : (input ?? {}),
        status:          "queued",
        priority:        plan === "pro" ? 2 : plan === "starter" ? 4 : 7,
        idempotency_key: idempKey ?? null,
        callback_url:    callbackUrl ?? null,
        plan,
        estimated_cost:  estimate.estimated_credits_needed,
      })
      .select("id").single()

    if (qErr || !job)
      return NextResponse.json({ error: "Failed to enqueue execution" }, { status: 500 })

    // If queue execution is disabled (Phase 1), fall back to inline
    if (!FEATURE_FLAGS.QUEUE_EXECUTION) {
      // Trigger inline execution via internal fetch (fire and don't await)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://agentdyne.com"
      fetch(`${baseUrl}/api/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body:    JSON.stringify({ agentId, input, idempotencyKey: idempKey, _queueJobId: job.id }),
      }).catch(() => null)
    }

    return NextResponse.json({
      jobId:    job.id,
      status:   "queued",
      message:  "Execution queued. Poll /api/executions/{jobId}/status or provide a callback_url.",
      priority: plan === "pro" ? "high" : plan === "starter" ? "normal" : "standard",
      estimatedCostUsd: estimate.estimated_credits_needed,
    }, { status: 202 })

  } catch (err: any) {
    console.error("POST /api/run:", err)
    return NextResponse.json({ error: err.message || "Queue error" }, { status: 500 })
  }
}
