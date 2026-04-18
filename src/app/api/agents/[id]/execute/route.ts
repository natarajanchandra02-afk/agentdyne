export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion, routeStream } from "@/lib/model-router"
import { checkInput, processOutput } from "@/lib/guardrails"
import { runInjectionPipeline } from "@/lib/injection-filter"
import { runAnthropicToolLoop } from "@/lib/mcp-tool-executor"
import { retrieveRAGContext, buildRAGSystemPrompt } from "@/lib/rag-retriever"

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

const MAX_INPUT_BYTES = 32_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * POST /api/agents/[id]/execute
 *
 * Full security + feature stack:
 * ✅ Rate limit
 * ✅ UUID validation
 * ✅ Session + API key auth
 * ✅ Injection filter + guardrails
 * ✅ Input size cap (32KB)
 * ✅ Quota enforcement
 * ✅ Subscription gate
 * ✅ Credit pre-check
 * ✅ RAG context injection (pgvector embed→search, via rag-retriever.ts)
 * ✅ MCP tool-use loop (if mcp_server_ids set + Anthropic model)
 * ✅ Multi-provider model routing (Anthropic, OpenAI, Gemini, vLLM)
 * ✅ Streaming (SSE)
 * ✅ Execution trace
 * ✅ Credit deduction
 * ✅ Output sanitization + PII scrub
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

        // Fire-and-forget last_used_at update
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
      .select(`
        id, name, model_name, system_prompt, max_tokens, temperature,
        pricing_model, price_per_call, free_calls_per_month, status,
        knowledge_base_id, mcp_server_ids, output_schema, timeout_seconds
      `)
      .eq("id",     agentId)
      .eq("status", "active")
      .single()

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    }

    if (!agent.system_prompt || (agent.system_prompt as string).trim().length < 10) {
      return NextResponse.json(
        { error: "Agent is not configured correctly — missing system prompt." },
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
      const freeLeft = ((agent.free_calls_per_month as number) ?? 0) - used
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

    // ── Credits pre-check ─────────────────────────────────────────────────────
    const pricePerCall   = parseFloat(String(agent.price_per_call ?? 0))
    let creditsRequired  = 0

    if ((agent.pricing_model === "per_call" || agent.pricing_model === "freemium") && pricePerCall > 0) {
      creditsRequired = pricePerCall
      const { data: credits } = await supabase
        .from("credits")
        .select("balance_usd")
        .eq("user_id", userId)
        .single()

      const balance = credits?.balance_usd ?? 0
      if (balance < creditsRequired) {
        return NextResponse.json({
          error:    "Insufficient credits. Top up to use this agent.",
          code:     "INSUFFICIENT_CREDITS",
          balance,
          required: creditsRequired,
        }, { status: 402 })
      }
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const contentLength = req.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_INPUT_BYTES) {
      return NextResponse.json({ error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` }, { status: 413 })
    }

    let body: { input?: unknown; stream?: boolean }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input, stream: wantsStream } = body
    if (input === undefined || input === null) {
      return NextResponse.json({ error: "input is required" }, { status: 400 })
    }

    const userMessage = typeof input === "string" ? input : JSON.stringify(input)

    if (new TextEncoder().encode(userMessage).length > MAX_INPUT_BYTES) {
      return NextResponse.json({ error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` }, { status: 413 })
    }

    // ── Guardrails: injection filter + content policy ─────────────────────────
    const guardrailResult                      = checkInput(userMessage)
    const { filterResult, score, shouldLog }   = runInjectionPipeline(userMessage, "user")

    if (!guardrailResult.allowed || !filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id:  userId,
        agent_id: agentId,
        input:    userMessage.slice(0, 500),
        pattern:  !guardrailResult.allowed
          ? (guardrailResult.blocked_by ?? "content_policy")
          : (filterResult as any).pattern,
        action:   "blocked",
      }).then(() => {})

      return NextResponse.json(
        { error: "Input rejected. Please revise your request.", code: "GUARDRAIL_BLOCKED" },
        { status: 400 }
      )
    }

    if (shouldLog || guardrailResult.flagged) {
      supabase.from("injection_attempts").insert({
        user_id:  userId,
        agent_id: agentId,
        input:    userMessage.slice(0, 500),
        pattern:  guardrailResult.pii_found?.length > 0
          ? `pii:${guardrailResult.pii_found.join(",")}`
          : `score_${score}`,
        action:   "flagged",
      }).then(() => {})
    }

    // ── Create execution record ───────────────────────────────────────────────
    const { data: execution } = await supabase
      .from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input })
      .select("id")
      .single()

    // ── RAG context injection ─────────────────────────────────────────────────
    // Uses rag-retriever.ts which correctly embeds the query via OpenAI before
    // calling search_rag_chunks RPC with the pgvector embedding.
    let enrichedSystemPrompt = agent.system_prompt as string
    let ragUsed = false

    if (agent.knowledge_base_id) {
      const ragResult = await retrieveRAGContext(
        supabase,
        agent.knowledge_base_id as string,
        userMessage,
        { topK: 5, threshold: 0.65 }
      )
      enrichedSystemPrompt = buildRAGSystemPrompt(enrichedSystemPrompt, ragResult)
      ragUsed = ragResult.retrieved
    }

    // ── Determine if MCP tool-use loop should run ─────────────────────────────
    const mcpServerIds: string[] = Array.isArray(agent.mcp_server_ids) ? agent.mcp_server_ids : []
    const modelName   = (agent.model_name as string) || "claude-sonnet-4-20250514"
    const useMCPLoop  = mcpServerIds.length > 0 && modelName.startsWith("claude-")

    const modelParams = {
      model:       modelName,
      system:      enrichedSystemPrompt,
      userMessage,
      maxTokens:   (agent.max_tokens  as number) || 4096,
      temperature: (agent.temperature as number) || 0.7,
    }

    // ── Streaming path ────────────────────────────────────────────────────────
    if (wantsStream && !useMCPLoop) {
      const encoder = new TextEncoder()
      const stream  = new ReadableStream({
        async start(controller) {
          const send = (data: object) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

          let fullText  = ""
          let inputTok  = 0
          let outputTok = 0
          const ttfts: number[] = []

          try {
            const { inputTokens, outputTokens, costUsd } = await routeStream(
              modelParams,
              (chunk) => {
                if (ttfts.length === 0) ttfts.push(Date.now() - startMs)
                send({ type: "delta", delta: chunk })
                fullText += chunk
              }
            )
            inputTok  = inputTokens
            outputTok = outputTokens

            const latencyMs = Date.now() - startMs
            const { safe: safeText } = processOutput(fullText, (agent as any).output_schema)

            send({ type: "done", executionId: execution?.id, latencyMs, cost: costUsd })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()

            await Promise.all([
              supabase.from("executions").update({
                status: "success", output: safeText,
                tokens_input: inputTok, tokens_output: outputTok,
                latency_ms: latencyMs, cost: costUsd, cost_usd: costUsd,
                completed_at: new Date().toISOString(),
              }).eq("id", execution?.id ?? ""),

              supabase.rpc("increment_executions_used", { user_id_param: userId }),

              supabase.from("execution_traces").insert({
                execution_id:    execution?.id,
                agent_id:        agentId,
                user_id:         userId,
                model:           modelName,
                system_prompt:   enrichedSystemPrompt,
                user_message:    userMessage,
                assistant_reply: safeText,
                ttft_ms:         ttfts[0] ?? null,
                total_ms:        latencyMs,
                tokens_input:    inputTok,
                tokens_output:   outputTok,
                cost_usd:        costUsd,
                status:          "success",
                temperature:     modelParams.temperature,
              }),
            ])

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
                status: "failed", error_message: err.message,
                completed_at: new Date().toISOString(),
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
    let rawText   = ""
    let inputTok  = 0
    let outputTok = 0
    let costUsd   = 0
    let toolCalls = 0

    if (useMCPLoop) {
      const result = await runAnthropicToolLoop({
        model:        modelName,
        system:       enrichedSystemPrompt,
        userMessage,
        maxTokens:    modelParams.maxTokens,
        temperature:  modelParams.temperature,
        mcpServerIds,
      })
      rawText   = result.text
      inputTok  = result.inputTokens
      outputTok = result.outputTokens
      costUsd   = result.costUsd
      toolCalls = result.toolCallCount
    } else {
      const result = await routeCompletion(modelParams)
      rawText   = result.text
      inputTok  = result.inputTokens
      outputTok = result.outputTokens
      costUsd   = result.costUsd
    }

    const latencyMs = Date.now() - startMs
    const { safe: safeText, scrub, parsed: parsedOut } = processOutput(rawText, (agent as any).output_schema)
    const output = parsedOut.isJSON ? parsedOut.parsed : safeText

    await Promise.all([
      supabase.from("executions").update({
        status:        "success",
        output,
        tokens_input:  inputTok,
        tokens_output: outputTok,
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
        model:           modelName,
        system_prompt:   enrichedSystemPrompt,
        user_message:    userMessage,
        assistant_reply: safeText,
        total_ms:        latencyMs,
        tokens_input:    inputTok,
        tokens_output:   outputTok,
        cost_usd:        costUsd,
        status:          scrub.flagged ? "flagged" : "success",
        error_message:   scrub.flagged ? scrub.redacted?.join(",") : null,
        temperature:     modelParams.temperature,
        tool_calls:      toolCalls > 0 ? toolCalls : undefined,
      }),
    ])

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
      tokens:     { input: inputTok, output: outputTok },
      cost:       costUsd,
      toolCalls:  toolCalls > 0 ? toolCalls : undefined,
      ragUsed:    ragUsed || undefined,
      flagged:    scrub.flagged || undefined,
    })

  } catch (err: any) {
    console.error("POST /api/agents/[id]/execute:", err)
    return NextResponse.json({ error: "Execution failed" }, { status: 500 })
  }
}
