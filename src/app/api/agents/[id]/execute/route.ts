export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion, routeStream } from "@/lib/model-router"
import { checkInput, processOutput } from "@/lib/guardrails"
import { runInjectionPipeline } from "@/lib/injection-filter"

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

const MAX_INPUT_BYTES = 32_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * POST /api/agents/[id]/execute
 *
 * Full security posture for public marketplace:
 * ✅ Per-IP rate limit (100/min)
 * ✅ UUID format validation before DB hit
 * ✅ Session cookie + API key auth
 * ✅ Prompt injection filter — blocks injection attempts, logs suspicious inputs
 * ✅ Input size cap (32KB) — prevents token-stuffing
 * ✅ Monthly quota enforcement
 * ✅ System prompt existence gate
 * ✅ Multi-provider model routing (Anthropic, OpenAI, Gemini, vLLM)
 * ✅ Credit deduction for per-call agents (atomic, row-locked)
 * ✅ Execution trace persisted for observability
 * ✅ Output sanitization (redact accidental API key leaks)
 * ✅ Error messages never expose internal details
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const startMs = Date.now()

  try {
    const { id: agentId } = await params

    if (!UUID_RE.test(agentId)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    const supabase = await createClient()

    // ── Auth ─────────────────────────────────────────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")

      if (rawKey) {
        if (rawKey.length > 200) {
          return NextResponse.json({ error: "Invalid API key format" }, { status: 401 })
        }
        const keyHash = await hashApiKey(rawKey)
        const { data: keyRow } = await supabase
          .from("api_keys")
          .select("user_id, is_active")
          .eq("key_hash", keyHash)
          .single()

        if (!keyRow?.is_active) {
          return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 })
        }
        userId = keyRow.user_id

        // Fire-and-forget
        supabase.from("api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("key_hash", keyHash)
          .then(() => {})
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // ── Load agent ────────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, model_name, system_prompt, max_tokens, temperature, pricing_model, price_per_call, free_calls_per_month, status")
      .eq("id",     agentId)
      .eq("status", "active")
      .single()

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    }

    if (!agent.system_prompt || agent.system_prompt.trim().length < 10) {
      return NextResponse.json(
        { error: "Agent is not configured correctly. Please contact the agent creator." },
        { status: 422 }
      )
    }

    // ── Quota check ───────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan")
      .eq("id", userId)
      .single()

    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0

    if (quota !== -1 && used >= quota) {
      return NextResponse.json(
        { error: "Monthly quota exceeded. Upgrade your plan to continue.", code: "QUOTA_EXCEEDED" },
        { status: 429 }
      )
    }

    // ── Subscription gate ─────────────────────────────────────────────────────
    if (agent.pricing_model === "subscription") {
      const freeLeft = (agent.free_calls_per_month ?? 0) - used
      if (freeLeft <= 0) {
        const { data: sub } = await supabase
          .from("agent_subscriptions")
          .select("status")
          .eq("user_id",  userId)
          .eq("agent_id", agentId)
          .single()
        if (sub?.status !== "active") {
          return NextResponse.json(
            { error: "Subscription required to use this agent.", code: "SUBSCRIPTION_REQUIRED" },
            { status: 403 }
          )
        }
      }
    }

    // ── Credits pre-check for per-call agents ─────────────────────────────────
    // Check balance before execution — don't want to run the LLM then find insufficient credits
    const pricePerCall = parseFloat(String(agent.price_per_call ?? 0))
    let creditsRequired = 0

    if (agent.pricing_model === "per_call" || agent.pricing_model === "freemium") {
      if (pricePerCall > 0) {
        creditsRequired = pricePerCall
        const { data: credits } = await supabase
          .from("credits")
          .select("balance_usd, hard_limit_usd")
          .eq("user_id", userId)
          .single()

        const balance = credits?.balance_usd ?? 0
        if (balance < creditsRequired) {
          return NextResponse.json({
            error:    "Insufficient credits. Top up your balance to use this agent.",
            code:     "INSUFFICIENT_CREDITS",
            balance:  balance,
            required: creditsRequired,
          }, { status: 402 })
        }
      }
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const contentLength = req.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB allowed.` },
        { status: 413 }
      )
    }

    let body: { input?: unknown; stream?: boolean }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { input, stream: wantsStream } = body

    if (input === undefined || input === null) {
      return NextResponse.json({ error: "input is required" }, { status: 400 })
    }

    const userMessage = typeof input === "string" ? input : JSON.stringify(input)

    if (new TextEncoder().encode(userMessage).length > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` },
        { status: 413 }
      )
    }

    // ── Combined guardrails: injection filter + PII + content policy ────────
    const guardrailResult = checkInput(userMessage)
    const { filterResult, score, shouldLog } = runInjectionPipeline(userMessage, "user")

    if (!guardrailResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id:  userId,
        agent_id: agentId,
        input:    userMessage.slice(0, 500),
        pattern:  guardrailResult.blocked_by ?? "content_policy",
        action:   "blocked",
      }).then(() => {})
      return NextResponse.json(
        { error: "Input rejected. Please revise your request.", code: "GUARDRAIL_BLOCKED" },
        { status: 400 }
      )
    }

    if (!filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id:  userId,
        agent_id: agentId,
        input:    userMessage.slice(0, 500),
        pattern:  filterResult.pattern,
        action:   "blocked",
      }).then(() => {})
      return NextResponse.json(
        { error: "Input rejected. Please revise your request.", code: "INJECTION_BLOCKED" },
        { status: 400 }
      )
    }

    if (shouldLog && score > 0 || guardrailResult.flagged) {
      supabase.from("injection_attempts").insert({
        user_id:  userId,
        agent_id: agentId,
        input:    userMessage.slice(0, 500),
        pattern:  guardrailResult.pii_found.length > 0 ? `pii:${guardrailResult.pii_found.join(",")}` : `score_${score}`,
        action:   "flagged",
      }).then(() => {})
    }

    // ── Create execution record ───────────────────────────────────────────────
    const { data: execution } = await supabase
      .from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input })
      .select("id")
      .single()

    const modelParams = {
      model:       (agent.model_name as string) || "claude-sonnet-4-20250514",
      system:      agent.system_prompt as string,
      userMessage,
      maxTokens:   (agent.max_tokens  as number) || 4096,
      temperature: (agent.temperature as number) || 0.7,
    }

    // ── Streaming path ────────────────────────────────────────────────────────
    if (wantsStream) {
      const encoder = new TextEncoder()
      const stream  = new ReadableStream({
        async start(controller) {
          const send = (data: object) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

          let fullText   = ""
          let inputTok   = 0
          let outputTok  = 0
          let costUsd    = 0
          const ttftMs: number[] = []

          try {
            const { inputTokens, outputTokens, costUsd: c } = await routeStream(
              modelParams,
              (chunk) => {
                if (ttftMs.length === 0) ttftMs.push(Date.now() - startMs)
                send({ type: "delta", delta: chunk })
                fullText += chunk
              }
            )
            inputTok  = inputTokens
            outputTok = outputTokens
            costUsd   = c

            const latencyMs = Date.now() - startMs
            const { safe: safeText, scrub } = processOutput(fullText, (agent as any).output_schema)
            const flagged = scrub.flagged

            send({ type: "done", executionId: execution?.id, latencyMs, cost: costUsd })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()

            // Persist results
            await Promise.all([
              supabase.from("executions").update({
                status:        "success",
                output:        safeText,
                tokens_input:  inputTok,
                tokens_output: outputTok,
                latency_ms:    latencyMs,
                cost:          costUsd,
                cost_usd:      costUsd,
                completed_at:  new Date().toISOString(),
              }).eq("id", execution?.id ?? ""),
              supabase.rpc("increment_executions_used", { user_id_param: userId }),
              // Write trace
              supabase.from("execution_traces").insert({
                execution_id:    execution?.id,
                agent_id:        agentId,
                user_id:         userId,
                model:           modelParams.model,
                system_prompt:   modelParams.system,
                user_message:    userMessage,
                assistant_reply: safeText,
                ttft_ms:         ttftMs[0] ?? null,
                total_ms:        latencyMs,
                tokens_input:    inputTok,
                tokens_output:   outputTok,
                cost_usd:        costUsd,
                status:          flagged ? "flagged" : "success",
                temperature:     modelParams.temperature,
              }),
            ])

            // Deduct credits for per-call agents
            if (creditsRequired > 0) {
              await supabase.rpc("deduct_credits", {
                user_id_param:      userId,
                amount_param:       creditsRequired,
                description_param:  `Agent: ${agent.name}`,
                reference_id_param: execution?.id ?? null,
              })
            }
          } catch (err: any) {
            send({ type: "error", error: "Execution failed" })
            controller.close()
            if (execution?.id) {
              await supabase.from("executions").update({
                status:        "failed",
                error_message: err.message,
                completed_at:  new Date().toISOString(),
              }).eq("id", execution.id)
            }
          }
        },
      })

      return new Response(stream, {
        headers: {
          "Content-Type":  "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection":    "keep-alive",
        },
      })
    }

    // ── Synchronous path ──────────────────────────────────────────────────────
    const { text: rawText, inputTokens, outputTokens, costUsd } = await routeCompletion(modelParams)

    const latencyMs = Date.now() - startMs
    const { safe: safeText, scrub, parsed: parsedOut } = processOutput(rawText, (agent as any).output_schema)
    const flagged = scrub.flagged
    const output  = parsedOut.isJSON ? parsedOut.parsed : safeText

    await Promise.all([
      supabase.from("executions").update({
        status:        "success",
        output,
        tokens_input:  inputTokens,
        tokens_output: outputTokens,
        latency_ms:    latencyMs,
        cost:          costUsd,
        cost_usd:      costUsd,
        completed_at:  new Date().toISOString(),
      }).eq("id", execution?.id ?? ""),
      supabase.rpc("increment_executions_used", { user_id_param: userId }),
      supabase.from("execution_traces").insert({
        execution_id:    execution?.id,
        agent_id:        agentId,
        user_id:         userId,
        model:           modelParams.model,
        system_prompt:   modelParams.system,
        user_message:    userMessage,
        assistant_reply: safeText,
        total_ms:        latencyMs,
        tokens_input:    inputTokens,
        tokens_output:   outputTokens,
        cost_usd:        costUsd,
        status:          flagged ? "flagged" : "success",
        error_message:   flagged ? scrub.redacted.join(",") : null,
        temperature:     modelParams.temperature,
      }),
    ])

    // Deduct credits for per-call agents
    if (creditsRequired > 0) {
      await supabase.rpc("deduct_credits", {
        user_id_param:      userId,
        amount_param:       creditsRequired,
        description_param:  `Agent: ${agent.name}`,
        reference_id_param: execution?.id ?? null,
      })
    }

    return NextResponse.json({
      executionId: execution?.id,
      output,
      latencyMs,
      tokens:  { input: inputTokens, output: outputTokens },
      cost:    costUsd,
      flagged: flagged || undefined,
    })

  } catch (err: any) {
    console.error("POST /api/agents/[id]/execute:", err)
    return NextResponse.json({ error: "Execution failed" }, { status: 500 })
  }
}
