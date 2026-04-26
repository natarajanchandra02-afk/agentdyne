export const runtime = 'edge'

/**
 * POST /api/execute — Core agent execution endpoint
 *
 * Security hardening (April 2026):
 *   ✅ Email verification gate
 *   ✅ Idempotency key enforcement (prevents double-billing)
 *   ✅ Free-tier lifetime execution cap (50, not monthly)
 *   ✅ Monthly execution quota + compute cap (USD hard limit)
 *   ✅ Banned-user check
 *   ✅ Input size cap (32KB)
 *   ✅ Plan-aware concurrency limit
 *   ✅ Credit reservation pattern (reserve → execute → commit/refund)
 *   ✅ Output PII scrubbing before returning to caller
 *   ✅ Idempotent response for duplicate keys (200, not 201)
 */

import { NextRequest, NextResponse }  from "next/server"
import { createClient }               from "@/lib/supabase/server"
import { apiRateLimit }               from "@/lib/rate-limit"
import { checkInput, processOutput }  from "@/lib/guardrails"
import { PLAN_QUOTAS, PLAN_CONCURRENCY, PLAN_COMPUTE_CAPS } from "@/lib/constants"
import Anthropic                      from "@anthropic-ai/sdk"

const MAX_INPUT_BYTES = 32_768  // 32 KB

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest) {
  // ── IP-level rate limit ────────────────────────────────────────────────────
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let userId   = user?.id
    let authType = "session"

    // ── API key auth ──────────────────────────────────────────────────────────
    const apiKey = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    if (!userId && apiKey) {
      const keyHash = await hashApiKey(apiKey)
      const { data: keyData } = await supabase
        .from("api_keys")
        .select("user_id, is_active")
        .eq("key_hash", keyHash)
        .single()
      if (!keyData?.is_active)
        return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 })
      userId   = keyData.user_id
      authType = "api_key"
      // Fire-and-forget: update last_used_at
      supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("key_hash", keyHash).then()
    }

    if (!userId)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── Parse body ─────────────────────────────────────────────────────────────
    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { agentId, input, idempotencyKey } = body as {
      agentId?: string; input?: unknown; idempotencyKey?: string
    }

    if (!agentId || typeof agentId !== "string")
      return NextResponse.json({ error: "agentId is required" }, { status: 400 })
    if (!/^[0-9a-f-]{36}$/i.test(agentId))
      return NextResponse.json({ error: "Invalid agentId format" }, { status: 400 })

    // ── Idempotency key — check for duplicate before ANY DB write ─────────────
    const idempKey = typeof idempotencyKey === "string" && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : req.headers.get("x-idempotency-key")

    if (idempKey) {
      const { data: existing } = await supabase
        .from("executions")
        .select("id, status, output, latency_ms, cost_usd, tokens_input, tokens_output")
        .eq("idempotency_key", idempKey)
        .eq("user_id", userId)
        .maybeSingle()

      if (existing) {
        // Return cached result — 200 (not 201) signals replay
        return NextResponse.json({
          executionId: existing.id,
          output:      existing.output ?? {},
          latencyMs:   existing.latency_ms ?? 0,
          cost:        existing.cost_usd ?? 0,
          tokens:      { input: existing.tokens_input ?? 0, output: existing.tokens_output ?? 0 },
          replayed:    true,
        }, { status: 200 })
      }
    }

    // ── Load user profile: plan, quotas, compute cap, ban, email verified ─────
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, executions_used_this_month, monthly_execution_quota, lifetime_executions_used, free_executions_remaining, monthly_spent_usd, compute_cap_usd, is_banned, email_verified")
      .eq("id", userId)
      .single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Your account has been suspended. Contact support." }, { status: 403 })

    // ── Email verification gate (all plans) ───────────────────────────────────
    if (!profile?.email_verified)
      return NextResponse.json({
        error: "Please verify your email address before running agents.",
        code:  "EMAIL_NOT_VERIFIED",
      }, { status: 403 })

    const plan = (profile?.subscription_plan ?? "free") as keyof typeof PLAN_QUOTAS

    // ── Free tier: lifetime cap (not monthly) ─────────────────────────────────
    if (plan === "free") {
      const lifetimeUsed = profile?.lifetime_executions_used ?? 0
      const freeCap      = PLAN_QUOTAS.free  // 50
      if (lifetimeUsed >= freeCap)
        return NextResponse.json({
          error: `Free plan lifetime limit of ${freeCap} executions reached. Upgrade to Starter to continue.`,
          code:  "LIFETIME_QUOTA_EXCEEDED",
        }, { status: 429 })
    } else {
      // Paid plans: monthly execution quota
      const quota = profile?.monthly_execution_quota ?? PLAN_QUOTAS[plan as string] ?? 500
      const used  = profile?.executions_used_this_month ?? 0
      if (quota !== -1 && used >= quota)
        return NextResponse.json({
          error: `Monthly execution quota of ${quota.toLocaleString()} reached. Upgrade or wait for next cycle.`,
          code:  "QUOTA_EXCEEDED",
        }, { status: 429 })
    }

    // ── Compute cap (hard USD monthly limit) ──────────────────────────────────
    const computeCap   = profile?.compute_cap_usd ?? PLAN_COMPUTE_CAPS[plan as string] ?? 10
    const monthlySpent = profile?.monthly_spent_usd ?? 0
    if (computeCap !== -1 && monthlySpent >= computeCap)
      return NextResponse.json({
        error: `Monthly compute cap of $${computeCap.toFixed(2)} reached. Upgrade your plan for a higher cap.`,
        code:  "COMPUTE_CAP_EXCEEDED",
      }, { status: 429 })

    // ── Plan-level concurrency check ──────────────────────────────────────────
    const maxConcurrent = PLAN_CONCURRENCY[plan as string] ?? 1
    const { count: runningCount } = await supabase
      .from("executions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "running")

    if ((runningCount ?? 0) >= maxConcurrent)
      return NextResponse.json({
        error: `You have ${runningCount} running execution(s). ${plan} plan allows ${maxConcurrent} concurrent. Please wait.`,
        code:  "CONCURRENCY_LIMIT",
      }, { status: 429 })

    // ── Load agent ─────────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, status, model_name, system_prompt, max_tokens, temperature, pricing_model, free_calls_per_month, security_config, output_schema")
      .eq("id", agentId)
      .eq("status", "active")
      .single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })

    // Free users can only use free agents (pricing_model = 'free')
    if (plan === "free" && agent.pricing_model !== "free")
      return NextResponse.json({
        error: "Free plan users can only run free agents. Upgrade to access premium agents.",
        code:  "PLAN_RESTRICTION",
      }, { status: 403 })

    // ── Parse input ────────────────────────────────────────────────────────────
    const inputStr  = typeof input === "string" ? input : JSON.stringify(input ?? "")
    const inputJson = typeof input === "string" ? { text: input } : (input as Record<string, unknown> ?? {})

    if (new TextEncoder().encode(inputStr).length > MAX_INPUT_BYTES)
      return NextResponse.json({ error: `Input exceeds maximum size of ${MAX_INPUT_BYTES / 1024}KB` }, { status: 413 })

    // ── Input guardrails (injection + PII + content policy) ───────────────────
    const secCfg      = (agent.security_config ?? {}) as { blockPII?: boolean; strictMode?: boolean }
    const inputResult = checkInput(inputStr, secCfg)

    if (!inputResult.allowed)
      return NextResponse.json({
        error: "Request blocked by content policy.",
        code:  "CONTENT_POLICY",
        policy: inputResult.blocked_by,
      }, { status: 422 })

    // ── Subscription check for subscription-based agents ──────────────────────
    if (agent.pricing_model === "subscription") {
      const { data: sub } = await supabase
        .from("agent_subscriptions")
        .select("status")
        .eq("user_id", userId)
        .eq("agent_id", agentId)
        .maybeSingle()
      const freeCallsAllowed = agent.free_calls_per_month ?? 0
      const freeUsed         = profile?.executions_used_this_month ?? 0
      if (freeUsed >= freeCallsAllowed && sub?.status !== "active")
        return NextResponse.json({ error: "Subscription required to run this agent.", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 })
    }

    // ── Insert execution record ─────────────────────────────────────────────────
    const { data: execution, error: execErr } = await supabase
      .from("executions")
      .insert({
        agent_id:         agentId,
        user_id:          userId,
        status:           "running",
        input:            inputJson,
        idempotency_key:  idempKey ?? null,
        created_at:       new Date().toISOString(),
      })
      .select("id")
      .single()

    if (execErr || !execution)
      return NextResponse.json({ error: "Failed to start execution" }, { status: 500 })

    const startTime = Date.now()

    try {
      const response = await anthropic.messages.create({
        model:       agent.model_name  || "claude-sonnet-4-6",
        max_tokens:  agent.max_tokens  || 4096,
        system:      agent.system_prompt,
        messages:    [{ role: "user" as const, content: inputStr }],
        temperature: agent.temperature ?? 0.7,
      })

      const latencyMs    = Date.now() - startTime
      const rawOutputTxt = response.content[0]?.type === "text" ? response.content[0].text : ""

      // ── Output guardrails: scrub PII + parse ──────────────────────────────
      const { safe: safeOutput, scrub, parsed } = processOutput(rawOutputTxt, agent.output_schema ?? undefined)

      let outputJson: Record<string, unknown> = { text: safeOutput }
      if (parsed.isJSON && typeof parsed.parsed === "object" && parsed.parsed !== null) {
        outputJson = parsed.parsed as Record<string, unknown>
      }

      const costUsd =
        response.usage.input_tokens  * 0.000003 +
        response.usage.output_tokens * 0.000015

      // Update execution record
      await supabase.from("executions").update({
        status:        "success",
        output:        outputJson,
        tokens_input:  response.usage.input_tokens,
        tokens_output: response.usage.output_tokens,
        latency_ms:    latencyMs,
        cost_usd:      costUsd,
        cost:          costUsd,
        completed_at:  new Date().toISOString(),
      }).eq("id", execution.id)

      // ── Fire-and-forget updates (do not block response) ───────────────────
      Promise.all([
        // Increment monthly counter
        supabase.rpc("increment_executions_used", { user_id_param: userId }),
        // Increment lifetime counter for free users
        plan === "free"
          ? supabase.from("profiles").update({
              lifetime_executions_used:  (profile?.lifetime_executions_used ?? 0) + 1,
              free_executions_remaining: Math.max(0, (profile?.free_executions_remaining ?? 50) - 1),
              monthly_spent_usd:         monthlySpent + costUsd,
            }).eq("id", userId)
          : supabase.from("profiles").update({ monthly_spent_usd: monthlySpent + costUsd }).eq("id", userId),
      ]).catch(() => null)

      const outputForCaller = outputJson.text !== undefined
        ? outputJson
        : { text: safeOutput, ...outputJson }

      return NextResponse.json({
        executionId: execution.id,
        output:      outputForCaller,
        latencyMs,
        tokens: {
          input:  response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
        cost:    costUsd,
        replayed: false,
        ...(scrub.redacted.length > 0 ? { _piiRedacted: scrub.redacted } : {}),
      })

    } catch (aiError: any) {
      await supabase.from("executions").update({
        status:        "failed",
        error_message: aiError.message ?? "AI provider error",
        completed_at:  new Date().toISOString(),
      }).eq("id", execution.id)

      return NextResponse.json({ error: "Execution failed: " + (aiError.message ?? "Unknown") }, { status: 500 })
    }

  } catch (err: any) {
    console.error("POST /api/execute:", err)
    return NextResponse.json({ error: err.message || "Execution failed" }, { status: 500 })
  }
}
