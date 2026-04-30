export const runtime = "edge"

/**
 * POST /api/execute — Simplified SDK-facing execute endpoint.
 *
 * Fixes applied (April 2026):
 *   ✅ BLOCKER: Atomic credit reservation via reserve_credits() RPC (FOR UPDATE)
 *   ✅ BLOCKER: Global distributed rate limit via checkUserRateLimit() (Supabase-backed)
 *   ✅ BLOCKER: TOCTOU concurrency fix via checkConcurrencyLimit() RPC
 *   ✅ HIGH:    Quota increments awaited — never fire-and-forget
 *   ✅ HIGH:    AbortController with 25s timeout — edge runtime safe
 *   ✅ ATTACK:  Idempotency key scoped to userId — prevents cross-user replay
 */

import { NextRequest, NextResponse }    from "next/server"
import { createClient }                 from "@/lib/supabase/server"
import { apiRateLimit }                 from "@/lib/rate-limit"
import { checkUserRateLimit }           from "@/lib/anti-abuse"
import { checkConcurrencyLimit }        from "@/lib/concurrency"
import { checkInput, processOutput }    from "@/lib/guardrails"
import { PLAN_QUOTAS, PLAN_COMPUTE_CAPS } from "@/lib/constants"
import { reconcileActualCost }          from "@/core/execution/costEstimator"
import Anthropic                        from "@anthropic-ai/sdk"
import type { PlanName }                from "@/lib/anti-abuse"

const MAX_INPUT_BYTES   = 32_768   // 32 KB
const AI_TIMEOUT_MS     = 25_000   // 25s — safely under CF 30s wall clock

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(req: NextRequest) {
  // ── 1. IP-level burst guard (in-memory, first line of defence) ─────────────
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const supabase = await createClient()

    // ── 2. Auth ───────────────────────────────────────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("x-api-key") ??
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      if (rawKey && rawKey.length <= 200) {
        const keyHash = await hashApiKey(rawKey)
        const { data: keyRow } = await supabase
          .from("api_keys")
          .select("user_id, is_active, expires_at")
          .eq("key_hash", keyHash)
          .single()
        if (keyRow?.is_active && !(keyRow.expires_at && new Date(keyRow.expires_at) < new Date())) {
          userId = keyRow.user_id
          supabase.from("api_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("key_hash", keyHash).then(() => {})
        } else {
          return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 })
        }
      }
    }
    if (!userId)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── 3. Parse + validate body ──────────────────────────────────────────────
    let body: Record<string, unknown>
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { agentId, input, idempotencyKey } = body as {
      agentId?: string; input?: unknown; idempotencyKey?: string
    }

    if (!agentId || typeof agentId !== "string")
      return NextResponse.json({ error: "agentId is required" }, { status: 400 })
    if (!/^[0-9a-f-]{36}$/i.test(agentId))
      return NextResponse.json({ error: "Invalid agentId format" }, { status: 400 })

    // ── 4. Idempotency — scoped to userId to prevent cross-user replay ────────
    const idempKey =
      (typeof idempotencyKey === "string" && idempotencyKey.trim())
        ? idempotencyKey.trim()
        : req.headers.get("x-idempotency-key") ?? null

    if (idempKey) {
      const { data: existing } = await supabase
        .from("executions")
        .select("id, status, output, latency_ms, cost_usd, tokens_input, tokens_output")
        .eq("idempotency_key", idempKey)
        .eq("user_id", userId)          // ← scoped to userId (attack fix)
        .maybeSingle()

      if (existing?.status === "success") {
        return NextResponse.json({
          executionId: existing.id,
          output:      existing.output ?? {},
          latencyMs:   existing.latency_ms ?? 0,
          cost:        existing.cost_usd ?? 0,
          tokens:      { input: existing.tokens_input ?? 0, output: existing.tokens_output ?? 0 },
          replayed:    true,
        })
      }
    }

    // ── 5. Load profile ───────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_plan, executions_used_this_month, monthly_execution_quota, lifetime_executions_used, free_executions_remaining, monthly_spent_usd, compute_cap_usd, is_banned, email_verified")
      .eq("id", userId)
      .single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Account suspended. Contact support@agentdyne.com" }, { status: 403 })
    if (!profile?.email_verified)
      return NextResponse.json({ error: "Verify your email before running agents.", code: "EMAIL_NOT_VERIFIED" }, { status: 403 })

    const plan = (profile?.subscription_plan ?? "free") as PlanName

    // ── 6. Global distributed rate limit (Supabase-backed, not in-memory) ────
    const rateResult = await checkUserRateLimit(supabase, userId, plan)
    if (!rateResult.allowed) {
      const res = NextResponse.json({
        error:      `Rate limit reached (${rateResult.limitHit} per ${rateResult.window}). Upgrade for higher limits.`,
        code:       "RATE_LIMIT_EXCEEDED",
        retryAfter: rateResult.retryAfter,
      }, { status: 429 })
      res.headers.set("Retry-After", String(rateResult.retryAfter))
      return res
    }

    // ── 7. Quota checks ───────────────────────────────────────────────────────
    if (plan === "free") {
      const lifetimeUsed = profile?.lifetime_executions_used ?? 0
      const freeCap      = PLAN_QUOTAS.free
      if (lifetimeUsed >= freeCap)
        return NextResponse.json({
          error: `Free plan limit of ${freeCap} lifetime executions reached. Upgrade to Starter.`,
          code:  "LIFETIME_QUOTA_EXCEEDED",
        }, { status: 429 })
    } else {
      const quota = profile?.monthly_execution_quota ?? 500
      const used  = profile?.executions_used_this_month ?? 0
      if (quota !== -1 && used >= quota)
        return NextResponse.json({ error: "Monthly quota exceeded.", code: "QUOTA_EXCEEDED" }, { status: 429 })
    }

    const computeCap   = Number(profile?.compute_cap_usd ?? PLAN_COMPUTE_CAPS[plan] ?? 10)
    const monthlySpent = Number(profile?.monthly_spent_usd ?? 0)
    if (computeCap !== -1 && monthlySpent >= computeCap)
      return NextResponse.json({ error: `Monthly compute cap of $${computeCap.toFixed(2)} reached.`, code: "COMPUTE_CAP_EXCEEDED" }, { status: 429 })

    // ── 8. Concurrency check via RPC (atomic, no TOCTOU) ─────────────────────
    const concurrency = await checkConcurrencyLimit(supabase, userId, plan)
    if (!concurrency.allowed) {
      const res = NextResponse.json({
        error: concurrency.message, code: concurrency.code,
        current: concurrency.current, limit: concurrency.limit,
      }, { status: 429 })
      if (concurrency.retryAfter) res.headers.set("Retry-After", String(concurrency.retryAfter))
      return res
    }

    // ── 9. Load agent ─────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, status, model_name, system_prompt, max_tokens, temperature, pricing_model, price_per_call, free_calls_per_month, output_schema")
      .eq("id", agentId)
      .eq("status", "active")
      .single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    if (plan === "free" && agent.pricing_model !== "free")
      return NextResponse.json({ error: "Free plan can only run free agents.", code: "PLAN_RESTRICTION" }, { status: 403 })

    // ── 10. Parse + validate input ────────────────────────────────────────────
    const inputStr  = typeof input === "string" ? input : JSON.stringify(input ?? "")
    const inputJson = typeof input === "string" ? { text: input } : (input as Record<string, unknown> ?? {})

    if (new TextEncoder().encode(inputStr).length > MAX_INPUT_BYTES)
      return NextResponse.json({ error: `Input exceeds ${MAX_INPUT_BYTES / 1024}KB maximum.` }, { status: 413 })

    const guardrailResult = checkInput(inputStr)
    if (!guardrailResult.allowed)
      return NextResponse.json({ error: "Input rejected by content policy.", code: "CONTENT_POLICY" }, { status: 422 })

    // ── 11. Subscription gate ─────────────────────────────────────────────────
    if (agent.pricing_model === "subscription") {
      const freeLeft = (Number(agent.free_calls_per_month) || 0) - (profile?.executions_used_this_month ?? 0)
      if (freeLeft <= 0) {
        const { data: sub } = await supabase.from("agent_subscriptions")
          .select("status").eq("user_id", userId).eq("agent_id", agentId).maybeSingle()
        if (sub?.status !== "active")
          return NextResponse.json({ error: "Subscription required.", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 })
      }
    }

    // ── 12. Atomic credit reservation (BLOCKER FIX) ───────────────────────────
    // Uses reserve_credits() RPC which holds a FOR UPDATE row lock on credits,
    // preventing two concurrent requests from both passing the balance check.
    const pricePerCall = Number(agent.price_per_call ?? 0)
    let creditReservationId: string | null = null

    if ((agent.pricing_model === "per_call" || agent.pricing_model === "freemium") && pricePerCall > 0) {
      const { data: credits } = await supabase
        .from("credits").select("balance_usd").eq("user_id", userId).single()
      const balance = Number(credits?.balance_usd ?? 0)

      if (balance < pricePerCall)
        return NextResponse.json({
          error: "Insufficient credits.", code: "INSUFFICIENT_CREDITS",
          balance, required: pricePerCall,
        }, { status: 402 })

      const { data: reservation } = await supabase.rpc("reserve_credits", {
        user_id_param:      userId,
        amount_param:       pricePerCall,
        execution_id_param: null,
      })

      if (!reservation?.success)
        return NextResponse.json({ error: reservation?.error ?? "Credit reservation failed.", code: "CREDIT_RESERVATION_FAILED" }, { status: 402 })

      creditReservationId = reservation.reservation_id ?? null
    }

    // ── 13. Create execution record ───────────────────────────────────────────
    const { data: execution, error: execErr } = await supabase
      .from("executions")
      .insert({
        agent_id:        agentId,
        user_id:         userId,
        status:          "running",
        input:           inputJson,
        idempotency_key: idempKey ?? null,
        created_at:      new Date().toISOString(),
      })
      .select("id").single()

    if (execErr || !execution) {
      // Roll back reservation if insert failed
      if (creditReservationId)
        await supabase.rpc("release_credit_reservation", { reservation_id_param: creditReservationId }).catch(() => {})
      return NextResponse.json({ error: "Failed to create execution record." }, { status: 500 })
    }

    const startMs = Date.now()

    // ── 14. AI call with 25s AbortController (edge runtime safe) ─────────────
    const controller = new AbortController()
    const timeoutId  = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)

    try {
      const response = await anthropic.messages.create({
        model:       (agent.model_name as string) || "claude-sonnet-4-6",
        max_tokens:  (agent.max_tokens  as number) || 4096,
        system:      agent.system_prompt as string,
        messages:    [{ role: "user" as const, content: inputStr }],
        temperature: (agent.temperature as number) ?? 0.7,
      }, { signal: controller.signal })

      clearTimeout(timeoutId)

      const latencyMs = Date.now() - startMs
      const rawText   = response.content[0]?.type === "text" ? response.content[0].text : ""

      const { safe: safeOutput, scrub, parsed } = processOutput(rawText, agent.output_schema ?? undefined)
      const outputJson: Record<string, unknown> =
        parsed.isJSON && typeof parsed.parsed === "object" && parsed.parsed !== null
          ? parsed.parsed as Record<string, unknown>
          : { text: safeOutput }

      const actual  = reconcileActualCost(agent.model_name as string, response.usage.input_tokens, response.usage.output_tokens)
      const costUsd = actual.userCostUsd

      // ── Commit credit reservation with actual cost ─────────────────────────
      if (creditReservationId) {
        await supabase.rpc("commit_credit_reservation", {
          reservation_id_param: creditReservationId,
          actual_cost_param:    costUsd,
        }).catch(() => {})
      }

      // ── Persist execution + increment quota (awaited, never fire-and-forget) ─
      await Promise.all([
        supabase.from("executions").update({
          status:        "success",
          output:        outputJson,
          tokens_input:  response.usage.input_tokens,
          tokens_output: response.usage.output_tokens,
          latency_ms:    latencyMs,
          cost_usd:      costUsd,
          cost:          costUsd,
          completed_at:  new Date().toISOString(),
        }).eq("id", execution.id),
        supabase.rpc("increment_executions_used", { user_id_param: userId }),
      ])

      return NextResponse.json({
        executionId: execution.id,
        output:      outputJson.text !== undefined ? outputJson : { text: safeOutput, ...outputJson },
        latencyMs,
        tokens:      { input: response.usage.input_tokens, output: response.usage.output_tokens },
        cost:        costUsd,
        replayed:    false,
        ...(scrub.redacted?.length > 0 ? { _piiRedacted: scrub.redacted } : {}),
      })

    } catch (aiError: any) {
      clearTimeout(timeoutId)

      // Release reservation on AI failure
      if (creditReservationId)
        await supabase.rpc("release_credit_reservation", { reservation_id_param: creditReservationId }).catch(() => {})

      const isTimeout = aiError.name === "AbortError"
      await supabase.from("executions").update({
        status:        "failed",
        error_message: isTimeout ? "Execution timed out (25s limit)" : (aiError.message?.slice(0, 500) ?? "AI provider error"),
        completed_at:  new Date().toISOString(),
      }).eq("id", execution.id)

      return NextResponse.json({
        error: isTimeout ? "Execution timed out. Use streaming for long-running agents." : `Execution failed: ${aiError.message?.slice(0, 200) ?? "Unknown"}`,
        code:  isTimeout ? "TIMEOUT" : "AI_ERROR",
      }, { status: isTimeout ? 504 : 502 })
    }

  } catch (err: any) {
    console.error("POST /api/execute:", err)
    return NextResponse.json({ error: "Internal server error." }, { status: 500 })
  }
}
