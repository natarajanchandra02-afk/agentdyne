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
import type { PlanName } from "@/lib/anti-abuse"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
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
      .select("id, name, model_name, system_prompt, max_tokens, temperature, pricing_model, price_per_call, free_calls_per_month, status, knowledge_base_id, mcp_server_ids, output_schema, timeout_seconds")
      .eq("id", agentId).eq("status", "active").single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })

    if (!agent.system_prompt || (agent.system_prompt as string).trim().length < 10)
      return NextResponse.json({ error: "Agent is misconfigured — missing system prompt" }, { status: 422 })

    // ── Profile + ban check ───────────────────────────────────────────────────
    const { data: profile } = await supabase.from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan, is_banned")
      .eq("id", userId).single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Your account has been suspended. Contact support@inteleion.com" }, { status: 403 })

    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0
    if (quota !== -1 && used >= quota)
      return NextResponse.json({ error: "Monthly quota exceeded. Upgrade your plan.", code: "QUOTA_EXCEEDED" }, { status: 429 })

    // ── Parse + validate body ─────────────────────────────────────────────────
    let body: { input?: unknown; stream?: boolean }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input, stream: wantsStream } = body
    if (input === undefined || input === null)
      return NextResponse.json({ error: "input is required" }, { status: 400 })

    const userMessage = typeof input === "string" ? input : JSON.stringify(input)
    if (new TextEncoder().encode(userMessage).length > MAX_INPUT_BYTES)
      return NextResponse.json({ error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` }, { status: 413 })

    // ── Content guardrails ────────────────────────────────────────────────────
    const guardrailResult = checkInput(userMessage)
    const { filterResult, score, shouldLog } = runInjectionPipeline(userMessage, "user")

    if (!guardrailResult.allowed || !filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: agentId,
        input: userMessage.slice(0, 500),
        pattern: !guardrailResult.allowed ? (guardrailResult.blocked_by ?? "content_policy") : (filterResult as any).pattern,
        action: "blocked", score,
      }).then(() => {})
      return NextResponse.json({ error: "Input rejected.", code: "GUARDRAIL_BLOCKED" }, { status: 400 })
    }

    if (shouldLog || guardrailResult.flagged) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: agentId,
        input: userMessage.slice(0, 500),
        pattern: `flagged_score_${score}`, action: "flagged", score,
      }).then(() => {})
    }

    // ── Credits ───────────────────────────────────────────────────────────────
    const { data: credits } = await supabase.from("credits")
      .select("balance_usd").eq("user_id", userId).single()
    const creditBalance = credits?.balance_usd ?? 0

    // ── Anti-abuse PRE-FLIGHT ─────────────────────────────────────────────────
    const plan = (profile?.subscription_plan ?? "free") as PlanName

    const preflight = await runPreflightChecks(supabase, {
      userId, agentId, plan,
      inputText:       userMessage,
      systemPrompt:    agent.system_prompt as string,
      requestedModel:  agent.model_name as string,
      requestedTokens: agent.max_tokens as number,
      creditBalance,
      requestHeaders: {
        userAgent:    req.headers.get("user-agent"),
        accept:       req.headers.get("accept"),
        origin:       req.headers.get("origin"),
        referer:      req.headers.get("referer"),
        cfThreatScore: req.headers.get("cf-threat-score")
          ? Number(req.headers.get("cf-threat-score")) : null,
      },
    })

    if (!preflight.allowed) {
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
        if (sub?.status !== "active")
          return NextResponse.json({ error: "Subscription required.", code: "SUBSCRIPTION_REQUIRED" }, { status: 403 })
      }
    }

    // ── Credits for paid agents ───────────────────────────────────────────────
    const pricePerCall  = parseFloat(String(agent.price_per_call ?? 0))
    let creditsRequired = 0
    if ((agent.pricing_model === "per_call" || agent.pricing_model === "freemium") && pricePerCall > 0) {
      creditsRequired = pricePerCall
      if (creditBalance < creditsRequired)
        return NextResponse.json({ error: "Insufficient credits.", code: "INSUFFICIENT_CREDITS", balance: creditBalance, required: creditsRequired }, { status: 402 })
    }

    // ── Create execution record ───────────────────────────────────────────────
    const inputJson: Record<string, unknown> =
      typeof input === "string" ? { text: input } : (input as Record<string, unknown> ?? {})

    const { data: execution } = await supabase.from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input: inputJson })
      .select("id").single()

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
      model: resolvedModel, system: compressedSystem, userMessage: compressedUser,
      maxTokens: tg.tokenBudget, temperature: (agent.temperature as number) || 0.7,
    }

    const mcpServerIds: string[] = Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids : []
    const useMCPLoop = mcpServerIds.length > 0 && resolvedModel.startsWith("claude-")

    // ── STREAMING PATH ────────────────────────────────────────────────────────
    if (wantsStream && !useMCPLoop) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          const send = (d: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`))
          let fullText = "", inputTok = 0, outputTok = 0
          try {
            const { inputTokens, outputTokens, costUsd } = await routeStream(modelParams,
              chunk => { send({ type: "delta", delta: chunk }); fullText += chunk })
            inputTok = inputTokens; outputTok = outputTokens
            const latencyMs = Date.now() - startMs
            const { safe: safeText } = processOutput(fullText, (agent as any).output_schema)
            const outputJson: Record<string, unknown> = { text: safeText }
            send({ type: "done", executionId: execution?.id, latencyMs, cost: costUsd })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
            await Promise.all([
              supabase.from("executions").update({
                status: "success", output: outputJson, tokens_input: inputTok, tokens_output: outputTok,
                latency_ms: latencyMs, cost: costUsd, cost_usd: costUsd, completed_at: new Date().toISOString(),
              }).eq("id", execution?.id ?? ""),
              supabase.rpc("increment_executions_used", { user_id_param: userId }),
            ])
            if (creditsRequired > 0) {
              supabase.rpc("deduct_credits", {
                user_id_param: userId, amount_param: creditsRequired,
                description_param: `Agent: ${agent.name}`, reference_id_param: execution?.id ?? null,
              }).then(() => {})
            }
          } catch (err: any) {
            send({ type: "error", error: "Execution failed" })
            controller.close()
            if (execution?.id) {
              await supabase.from("executions").update({
                status: "failed", error_message: err.message, completed_at: new Date().toISOString(),
              }).eq("id", execution.id)
            }
          }
        },
      })
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
      })
    }

    // ── SYNC PATH ─────────────────────────────────────────────────────────────
    let rawText = "", inputTok = 0, outputTok = 0, costUsd = 0, toolCalls = 0

    if (useMCPLoop) {
      const r = await runAnthropicToolLoop({
        model: resolvedModel, system: enrichedSystem, userMessage: resolvedInput,
        maxTokens: modelParams.maxTokens, temperature: modelParams.temperature, mcpServerIds,
      })
      rawText = r.text; inputTok = r.inputTokens; outputTok = r.outputTokens
      costUsd = r.costUsd; toolCalls = r.toolCallCount
    } else {
      const r = await routeCompletion(modelParams)
      rawText = r.text; inputTok = r.inputTokens; outputTok = r.outputTokens; costUsd = r.costUsd
    }

    const latencyMs = Date.now() - startMs
    const { safe: safeText, scrub, parsed: parsedOut } = processOutput(rawText, (agent as any).output_schema)
    const outputStorable: Record<string, unknown> = parsedOut.isJSON
      ? (typeof parsedOut.parsed === "object" && parsedOut.parsed !== null ? parsedOut.parsed as any : { result: parsedOut.parsed })
      : { text: safeText }
    const output = parsedOut.isJSON ? parsedOut.parsed : safeText

    await Promise.all([
      supabase.from("executions").update({
        status: "success", output: outputStorable, tokens_input: inputTok, tokens_output: outputTok,
        latency_ms: latencyMs, cost: costUsd, cost_usd: costUsd, completed_at: new Date().toISOString(),
      }).eq("id", execution?.id ?? ""),
      supabase.rpc("increment_executions_used", { user_id_param: userId }),
      supabase.from("execution_traces").insert({
        execution_id: execution?.id, agent_id: agentId, user_id: userId,
        model: resolvedModel, system_prompt: enrichedSystem,
        user_message: userMessage, assistant_reply: safeText,
        total_ms: latencyMs, tokens_input: inputTok, tokens_output: outputTok,
        cost_usd: costUsd, status: scrub.flagged ? "flagged" : "success",
        error_message: scrub.flagged ? scrub.redacted?.join(",") : null,
        temperature: modelParams.temperature,
      }),
    ])

    if (creditsRequired > 0) {
      await supabase.rpc("deduct_credits", {
        user_id_param: userId, amount_param: creditsRequired,
        description_param: `Agent: ${agent.name}`, reference_id_param: execution?.id ?? null,
      })
    }

    return NextResponse.json({
      executionId:  execution?.id,
      output,
      latencyMs,
      tokens:       { input: inputTok, output: outputTok },
      cost:         costUsd,
      model:        resolvedModel,
      modelChanged: resolvedModel !== agent.model_name,
      toolCalls:    toolCalls > 0 ? toolCalls : undefined,
      ragUsed:      ragUsed     ? true       : undefined,
      flagged:      scrub.flagged ? true     : undefined,
    })

  } catch (err: any) {
    console.error("POST /api/agents/[id]/execute:", err)
    return NextResponse.json({ error: "Execution failed" }, { status: 500 })
  }
}
