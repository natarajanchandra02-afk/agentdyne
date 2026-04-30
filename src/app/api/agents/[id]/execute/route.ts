export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { runPreflightChecks } from "@/lib/anti-abuse"
import { routeCompletion, routeStream } from "@/lib/model-router"
import { checkInput, processOutput } from "@/lib/guardrails"
import { runInjectionPipeline } from "@/lib/injection-filter"
import { compressToTokenBudget } from "@/lib/context-compression"
import { runAnthropicToolLoop } from "@/lib/mcp-tool-executor"
import { retrieveRAGContext, buildRAGSystemPrompt } from "@/lib/rag-retriever"
import { thoughtGate } from "@/lib/thoughtgate"
import { checkIdempotency, commitIdempotency, failIdempotency } from "@/lib/idempotency"
import { checkExecutionCache, writeExecutionCache } from "@/lib/execution-cache"
import { checkConcurrencyLimit } from "@/lib/concurrency"
import type { PlanName } from "@/lib/anti-abuse"

const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INPUT_BYTES = 32_000

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const startMs = Date.now()

  try {
    const { id: agentId } = await params
    if (!UUID_RE.test(agentId))
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })

    const supabase = await createClient()

    // ── Auth ──────────────────────────────────────────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")
      if (rawKey && rawKey.length <= 200) {
        const keyHash = await hashApiKey(rawKey)
        const { data: keyRow } = await supabase
          .from("api_keys").select("user_id, is_active, expires_at")
          .eq("key_hash", keyHash).single()
        if (keyRow?.is_active && !(keyRow.expires_at && new Date(keyRow.expires_at) < new Date())) {
          userId = keyRow.user_id
          supabase.from("api_keys").update({ last_used_at: new Date().toISOString() })
            .eq("key_hash", keyHash).then(() => {})
        }
      }
    }

    if (!userId)
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── Load agent ────────────────────────────────────────────────────────────
    const { data: agent } = await supabase.from("agents")
      .select("id, name, model_name, system_prompt, max_tokens, temperature, pricing_model, price_per_call, free_calls_per_month, status, knowledge_base_id, mcp_server_ids, output_schema, timeout_seconds, cache_ttl_seconds")
      .eq("id", agentId).eq("status", "active").single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })

    if (!agent.system_prompt || (agent.system_prompt as string).trim().length < 10)
      return NextResponse.json({ error: "Agent is misconfigured — missing system prompt" }, { status: 422 })

    // ── Profile + ban check ───────────────────────────────────────────────────
    const { data: profile } = await supabase.from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan, is_banned, lifetime_executions_used, free_executions_remaining")
      .eq("id", userId).single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Account suspended. Contact support@agentdyne.com" }, { status: 403 })

    const plan         = (profile?.subscription_plan ?? "free") as PlanName
    const isFreePlan   = plan === "free"

    // ── Email verification gate ───────────────────────────────────────────────
    if (isFreePlan) {
      const { data: authUser } = await supabase
        .from("profiles")
        .select("email_confirmed_at, email_verified")
        .eq("id", userId)
        .single()
      const isVerified = authUser?.email_confirmed_at || authUser?.email_verified
      if (!isVerified) {
        return NextResponse.json({
          error:  "Please verify your email address before using agents. Check your inbox for a verification link.",
          code:   "EMAIL_NOT_VERIFIED",
          action: "resend_verification",
        }, { status: 403 })
      }
    }

    // ── Quota check ───────────────────────────────────────────────────────────
    // FREE plan: 50 LIFETIME executions (not monthly) — single source of truth in constants.ts
    // PAID plans: monthly quota from profile.monthly_execution_quota
    const FREE_LIFETIME_LIMIT = 50  // mirrors PLAN_QUOTAS.free in constants.ts
    const lifetimeUsed = Number(profile?.lifetime_executions_used ?? 0)

    if (isFreePlan) {
      // For free users, enforce the lifetime cap
      if (lifetimeUsed >= FREE_LIFETIME_LIMIT) {
        return NextResponse.json({
          error:   `Free plan limit reached (${FREE_LIFETIME_LIMIT} lifetime executions). Upgrade to Starter for 500/month.`,
          code:    "LIFETIME_QUOTA_EXCEEDED",
          used:    lifetimeUsed,
          limit:   FREE_LIFETIME_LIMIT,
          upgrade: "/pricing",
        }, { status: 429 })
      }
    } else {
      // Paid plans: monthly quota
      const quota = profile?.monthly_execution_quota ?? 500
      const used  = profile?.executions_used_this_month ?? 0
      if (quota !== -1 && used >= quota)
        return NextResponse.json({ error: "Monthly quota exceeded.", code: "QUOTA_EXCEEDED" }, { status: 429 })
    }

    const used = profile?.executions_used_this_month ?? 0

    // ── Concurrency limit ────────────────────────────────────────────────────
    const concurrency = await checkConcurrencyLimit(supabase, userId, plan)
    if (!concurrency.allowed) {
      const res = NextResponse.json({
        error:   concurrency.message,
        code:    concurrency.code,
        current: concurrency.current,
        limit:   concurrency.limit,
      }, { status: 429 })
      if (concurrency.retryAfter) res.headers.set("Retry-After", String(concurrency.retryAfter))
      return res
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { input?: unknown; stream?: boolean; no_cache?: boolean }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input, stream: wantsStream, no_cache } = body
    if (input === undefined || input === null)
      return NextResponse.json({ error: "input is required" }, { status: 400 })

    const userMessage = typeof input === "string" ? input : JSON.stringify(input)
    if (new TextEncoder().encode(userMessage).length > MAX_INPUT_BYTES)
      return NextResponse.json({ error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` }, { status: 413 })

    // ── Idempotency check ─────────────────────────────────────────────────────
    // Prevents duplicate execution when client retries (network errors, timeouts).
    const idempotencyKey = req.headers.get("x-idempotency-key") ?? ""
    const bypassCache    = no_cache || req.headers.get("cache-control") === "no-cache"

    const idempotency = await checkIdempotency(supabase, userId, agentId, idempotencyKey)
    if (!idempotency.isFirstRequest && idempotency.cachedResponse) {
      // Return cached response — don't re-execute
      return NextResponse.json({
        ...idempotency.cachedResponse,
        cached:     true,
        idempotent: true,
      })
    }

    // ── Response cache check (semantic cache) ─────────────────────────────────
    // Skip for streaming, high-temperature, or explicitly bypassed requests.
    const temperature = (agent.temperature as number) || 0.7
    if (!wantsStream && !bypassCache) {
      const cacheHit = await checkExecutionCache(supabase, agentId, userMessage, {
        bypass:      bypassCache,
        temperature,
      })
      if (cacheHit.hit) {
        const cachedResponse = {
          executionId: null,
          output:      cacheHit.output,
          latencyMs:   Date.now() - startMs,
          tokens:      { input: cacheHit.tokensInput ?? 0, output: cacheHit.tokensOutput ?? 0 },
          cost:        0,
          cached:      true,
          cachedAt:    cacheHit.cachedAt,
        }
        // Also commit as idempotency response if key was provided
        if (idempotencyKey && idempotency.reservationId) {
          commitIdempotency(supabase, idempotency.reservationId, null, cachedResponse).catch(() => {})
        }
        return NextResponse.json(cachedResponse)
      }
    }

    // ── Content guardrails ────────────────────────────────────────────────────
    const guardrailResult = checkInput(userMessage)
    const { filterResult, score, shouldLog } = runInjectionPipeline(userMessage, "user")

    if (!guardrailResult.allowed || !filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: agentId,
        input:   userMessage.slice(0, 500),
        pattern: !guardrailResult.allowed ? (guardrailResult.blocked_by ?? "content_policy") : (filterResult as any).pattern,
        action:  "blocked", score,
      }).then(() => {})
      await failIdempotency(supabase, idempotency.reservationId)
      return NextResponse.json({ error: "Input rejected.", code: "GUARDRAIL_BLOCKED" }, { status: 400 })
    }

    if (shouldLog || guardrailResult.flagged) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: agentId,
        input:   userMessage.slice(0, 500),
        pattern: `flagged_score_${score}`, action: "flagged", score,
      }).then(() => {})
    }

    // ── Credits load ──────────────────────────────────────────────────────────
    const { data: credits } = await supabase.from("credits")
      .select("balance_usd").eq("user_id", userId).single()
    const creditBalance = credits?.balance_usd ?? 0

    // ── Anti-abuse PRE-FLIGHT ─────────────────────────────────────────────────
    const preflight = await runPreflightChecks(supabase, {
      userId, agentId, plan,
      inputText:       userMessage,
      systemPrompt:    agent.system_prompt as string,
      requestedModel:  agent.model_name as string,
      requestedTokens: agent.max_tokens as number,
      creditBalance,
      requestHeaders: {
        userAgent:     req.headers.get("user-agent"),
        accept:        req.headers.get("accept"),
        origin:        req.headers.get("origin"),
        referer:       req.headers.get("referer"),
        cfThreatScore: req.headers.get("cf-threat-score")
          ? Number(req.headers.get("cf-threat-score")) : null,
      },
    })

    if (!preflight.allowed) {
      await failIdempotency(supabase, idempotency.reservationId)
      const res = NextResponse.json({ error: preflight.message, code: preflight.code }, { status: preflight.httpStatus })
      if (preflight.retryAfter) res.headers.set("Retry-After", String(preflight.retryAfter))
      return res
    }

    const guardrails    = preflight.guardrails!
    const resolvedModel = guardrails.modelAllowed
      ? (agent.model_name as string)
      : (guardrails.fallbackModel ?? "claude-haiku-4-5-20251001")
    const resolvedTokens = guardrails.clampedTokens
    const resolvedInput  = guardrails.clampedInput

    // ── Subscription gate ─────────────────────────────────────────────────────
    if (agent.pricing_model === "subscription") {
      const freeLeft = ((agent.free_calls_per_month as number) ?? 0) - used
      if (freeLeft <= 0) {
        const { data: sub } = await supabase.from("agent_subscriptions")
          .select("status").eq("user_id", userId).eq("agent_id", agentId).single()
        if (sub?.status !== "active") {
          await failIdempotency(supabase, idempotency.reservationId)
          return NextResponse.json({ error: "Subscription required.", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 })
        }
      }
    }

    // ── Credit reservation (reserve → execute → commit/release) ──────────────
    // Reserves credits BEFORE execution to prevent "execute then crash = free call".
    const pricePerCall  = parseFloat(String(agent.price_per_call ?? 0))
    let creditReservationId: string | null = null
    let creditsRequired = 0

    if ((agent.pricing_model === "per_call" || agent.pricing_model === "freemium") && pricePerCall > 0) {
      creditsRequired = pricePerCall
      if (creditBalance < creditsRequired) {
        await failIdempotency(supabase, idempotency.reservationId)
        return NextResponse.json({
          error:    "Insufficient credits.",
          code:     "INSUFFICIENT_CREDITS",
          balance:  creditBalance,
          required: creditsRequired,
        }, { status: 402 })
      }

      // Reserve credits atomically before executing
      const { data: reservation } = await supabase.rpc("reserve_credits", {
        user_id_param:      userId,
        amount_param:       creditsRequired,
        execution_id_param: null,  // filled after execution record is created
      })

      if (reservation?.success === false) {
        await failIdempotency(supabase, idempotency.reservationId)
        return NextResponse.json({ error: "Failed to reserve credits.", code: "CREDIT_RESERVATION_FAILED" }, { status: 402 })
      }

      creditReservationId = reservation?.reservation_id ?? null
    }

    // ── Create execution record ───────────────────────────────────────────────
    const inputJson: Record<string, unknown> =
      typeof input === "string" ? { text: input } : (input as Record<string, unknown> ?? {})

    const { data: execution, error: execInsertErr } = await supabase.from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input: inputJson })
      .select("id").single()

    if (execInsertErr) console.error("[execute] Execution record error:", execInsertErr?.message)
    const executionId = execution?.id ?? null

    // ── RAG ───────────────────────────────────────────────────────────────────
    let enrichedSystem = agent.system_prompt as string
    let ragUsed = false
    if (agent.knowledge_base_id) {
      const ragResult = await retrieveRAGContext(supabase, agent.knowledge_base_id as string, resolvedInput, { topK: 5, threshold: 0.65 })
      enrichedSystem = buildRAGSystemPrompt(enrichedSystem, ragResult)
      ragUsed = !ragResult.skipped && ragResult.chunks.length > 0
    }

    // ── ThoughtGate ───────────────────────────────────────────────────────────
    const tg = thoughtGate.process({ query: resolvedInput, configuredTokens: resolvedTokens })
    if (tg.systemAddendum) enrichedSystem += tg.systemAddendum

    // ── Context compression ───────────────────────────────────────────────────
    const { systemPrompt: compressedSystem, userMessage: compressedUser } =
      compressToTokenBudget(enrichedSystem, resolvedInput, 14_000)

    const modelParams = {
      model:       resolvedModel,
      system:      compressedSystem,
      userMessage: compressedUser,
      maxTokens:   tg.tokenBudget,
      temperature,
    }

    const mcpServerIds: string[] = Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids : []
    const useMCPLoop = mcpServerIds.length > 0 && resolvedModel.startsWith("claude-")

    // ── Helper to release reservation + mark idempotency failed ──────────────
    const cleanupOnFailure = async (execErr: Error | null) => {
      if (creditReservationId) {
        await supabase.rpc("release_credit_reservation", { reservation_id_param: creditReservationId }).catch(() => {})
      }
      await failIdempotency(supabase, idempotency.reservationId)
      if (executionId && execErr) {
        await supabase.from("executions").update({
          status: "failed", error_message: execErr.message?.slice(0, 500), completed_at: new Date().toISOString(),
        }).eq("id", executionId).catch(() => {})
      }
    }

    // ── STREAMING PATH ────────────────────────────────────────────────────────
    if (wantsStream && !useMCPLoop) {
      const encoder = new TextEncoder()
      const stream  = new ReadableStream({
        async start(controller) {
          const send = (d: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`))
          let fullText = "", inputTok = 0, outputTok = 0

          try {
            const { inputTokens, outputTokens, costUsd } = await routeStream(modelParams,
              chunk => { send({ type: "delta", delta: chunk }); fullText += chunk })
            inputTok  = inputTokens
            outputTok = outputTokens
            const latencyMs = Date.now() - startMs

            const { safe: safeText, scrub, parsed: parsedOut } = processOutput(fullText, (agent as any).output_schema)
            const outputJson: Record<string, unknown> = parsedOut?.isJSON
              ? (typeof parsedOut.parsed === "object" && parsedOut.parsed !== null ? parsedOut.parsed as any : { result: parsedOut.parsed })
              : { text: safeText }

            send({ type: "done", executionId, latencyMs, cost: costUsd })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()

            // Commit credit reservation with actual cost
            if (creditReservationId) {
              supabase.rpc("commit_credit_reservation", {
                reservation_id_param: creditReservationId,
                actual_cost_param:    costUsd,
              }).then(() => {})
            }

            if (executionId) {
              await Promise.all([
                supabase.from("executions").update({
                  status: "success", output: outputJson, tokens_input: inputTok, tokens_output: outputTok,
                  latency_ms: latencyMs, cost: costUsd, cost_usd: costUsd, completed_at: new Date().toISOString(),
                }).eq("id", executionId),
                supabase.rpc("increment_executions_used", { user_id_param: userId }),
              ])

              supabase.from("execution_traces").insert({
                execution_id: executionId, agent_id: agentId, user_id: userId,
                model: resolvedModel, system_prompt: enrichedSystem, user_message: userMessage, assistant_reply: safeText,
                total_ms: latencyMs, tokens_input: inputTok, tokens_output: outputTok, cost_usd: costUsd,
                status: scrub?.flagged ? "flagged" : "success", temperature: modelParams.temperature,
              }).then(() => {}).catch(() => {})
            }

          } catch (err: any) {
            send({ type: "error", error: "Execution failed" })
            controller.close()
            await cleanupOnFailure(err)
          }
        },
      })
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
      })
    }

    // ── SYNC PATH ─────────────────────────────────────────────────────────────
    let rawText = "", inputTok = 0, outputTok = 0, costUsd = 0, toolCalls = 0

    try {
      if (useMCPLoop) {
        const r = await runAnthropicToolLoop({
          model:       resolvedModel, system: enrichedSystem, userMessage: resolvedInput,
          maxTokens:   modelParams.maxTokens, temperature: modelParams.temperature, mcpServerIds,
        })
        rawText = r.text; inputTok = r.inputTokens; outputTok = r.outputTokens; costUsd = r.costUsd; toolCalls = r.toolCallCount
      } else {
        const r = await routeCompletion(modelParams)
        rawText = r.text; inputTok = r.inputTokens; outputTok = r.outputTokens; costUsd = r.costUsd
      }
    } catch (llmErr: any) {
      await cleanupOnFailure(llmErr)
      const isConfigErr = llmErr.code === "PROVIDER_NOT_CONFIGURED"
      return NextResponse.json({
        error:  isConfigErr ? `AI provider not configured: ${llmErr.message}` : `AI provider error: ${llmErr.message?.slice(0, 200)}`,
        code:   isConfigErr ? "PROVIDER_NOT_CONFIGURED" : "LLM_ERROR",
        model:  resolvedModel,
      }, { status: isConfigErr ? 503 : 502 })
    }

    const latencyMs = Date.now() - startMs
    const { safe: safeText, scrub, parsed: parsedOut } = processOutput(rawText, (agent as any).output_schema)
    const outputStorable: Record<string, unknown> = parsedOut.isJSON
      ? (typeof parsedOut.parsed === "object" && parsedOut.parsed !== null ? parsedOut.parsed as any : { result: parsedOut.parsed })
      : { text: safeText }
    const output = parsedOut.isJSON ? parsedOut.parsed : safeText

    // ── Commit credit reservation with actual cost ────────────────────────────
    if (creditReservationId) {
      await supabase.rpc("commit_credit_reservation", {
        reservation_id_param: creditReservationId,
        actual_cost_param:    costUsd,
      }).catch(() => {})
    }

    // ── Persist execution record ──────────────────────────────────────────────
    if (executionId) {
      await Promise.all([
        supabase.from("executions").update({
          status: "success", output: outputStorable,
          tokens_input: inputTok, tokens_output: outputTok,
          latency_ms: latencyMs, cost: costUsd, cost_usd: costUsd,
          completed_at: new Date().toISOString(),
        }).eq("id", executionId),
        supabase.rpc("increment_executions_used",    { user_id_param: userId }),
        supabase.rpc("increment_lifetime_executions", { user_id_param: userId }),
      ])

      supabase.from("execution_traces").insert({
        execution_id: executionId, agent_id: agentId, user_id: userId,
        model: resolvedModel, system_prompt: enrichedSystem, user_message: userMessage, assistant_reply: safeText,
        total_ms: latencyMs, tokens_input: inputTok, tokens_output: outputTok, cost_usd: costUsd,
        status: scrub.flagged ? "flagged" : "success",
        error_message: scrub.flagged ? scrub.redacted?.join(",") : null,
        temperature: modelParams.temperature,
      }).then(() => {}).catch(() => {})
    } else {
      supabase.rpc("increment_executions_used", { user_id_param: userId }).then(() => {})
    }

    // ── Write to response cache (non-streaming, deterministic queries) ────────
    if (!bypassCache && !scrub.flagged) {
      const cacheTtl = (agent as any).cache_ttl_seconds ?? 3600
      writeExecutionCache(supabase, agentId, userMessage, output, inputTok, outputTok, costUsd, {
        ttlSeconds:  cacheTtl,
        temperature,
      }).catch(() => {})
    }

    const responseBody = {
      executionId,
      output,
      latencyMs,
      tokens:      { input: inputTok, output: outputTok },
      cost:        costUsd,
      model:       resolvedModel,
      modelChanged: resolvedModel !== agent.model_name,
      toolCalls:   toolCalls > 0 ? toolCalls : undefined,
      ragUsed:     ragUsed ? true : undefined,
      flagged:     scrub.flagged ? true : undefined,
    }

    // ── Commit idempotency key ────────────────────────────────────────────────
    if (idempotencyKey && idempotency.reservationId) {
      commitIdempotency(supabase, idempotency.reservationId, executionId, responseBody).catch(() => {})
    }

    return NextResponse.json(responseBody)

  } catch (err: any) {
    console.error("POST /api/agents/[id]/execute:", err)
    const isDev = process.env.NODE_ENV !== "production"
    // Alert on critical execution failures
    const { trackError } = await import("@/lib/monitoring")
    trackError(err, { route: "/api/agents/[id]/execute", userId: "unknown" })
    return NextResponse.json({
      error: isDev ? `Execution failed: ${err.message}` : "Execution failed. Please try again.",
      code:  "INTERNAL_ERROR",
    }, { status: 500 })
  }
}
