export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

/** Validate input size — prevent oversized payloads from burning quota */
const MAX_INPUT_BYTES = 32_000

/**
 * POST /api/agents/[id]/execute
 *
 * Security posture:
 * - Rate limited: 100/min per IP (apiRateLimit), extra strict on execute
 * - Auth required: session cookie OR hashed Bearer API key
 * - Quota enforced: monthly execution cap per user plan
 * - Input size cap: 32 KB to prevent token-stuffing attacks
 * - UUID validated before DB hit
 * - System prompt must exist (no prompt = agent not properly configured)
 * - No streaming to anonymous callers (too easy to abuse)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Per-IP rate limit on execute (100/min covers normal usage)
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id: agentId } = await params

    // Validate UUID format to prevent injection probing
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(agentId)) {
      return NextResponse.json({ error: "Invalid agent id" }, { status: 400 })
    }

    const supabase = await createClient()

    // ── Auth: session cookie OR Bearer/x-api-key ─────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")

      if (rawKey) {
        // Length sanity check (API keys are "agd_" + ~48 chars)
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

        // Fire-and-forget last_used_at update (don't await — doesn't block response)
        supabase
          .from("api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("key_hash", keyHash)
          .then(() => {})
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // ── Load agent ────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, model_name, system_prompt, max_tokens, temperature, pricing_model, free_calls_per_month, status")
      .eq("id",     agentId)
      .eq("status", "active")
      .single()

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    }

    // Agents without a system prompt are misconfigured — block execution
    if (!agent.system_prompt || agent.system_prompt.trim().length < 10) {
      return NextResponse.json(
        { error: "Agent is not configured (missing system prompt). Contact the agent creator." },
        { status: 422 }
      )
    }

    // ── Quota check ───────────────────────────────────────────────────────
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

    // ── Subscription gate (for paid agents) ──────────────────────────────
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

    // ── Parse and validate body ───────────────────────────────────────────
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

    // Convert input to string and enforce byte limit
    const userMessage = typeof input === "string" ? input : JSON.stringify(input)
    if (new TextEncoder().encode(userMessage).length > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: `Input too large. Max ${MAX_INPUT_BYTES / 1000}KB.` },
        { status: 413 }
      )
    }

    // ── Create execution record ───────────────────────────────────────────
    const { data: execution } = await supabase
      .from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input })
      .select("id")
      .single()

    const startMs = Date.now()

    const modelParams = {
      model:       (agent.model_name as string) ?? "claude-sonnet-4-20250514",
      max_tokens:  (agent.max_tokens  as number) ?? 4096,
      system:      agent.system_prompt as string,
      messages:    [{ role: "user" as const, content: userMessage }],
      temperature: (agent.temperature as number) ?? 0.7,
    }

    // ── Streaming path ────────────────────────────────────────────────────
    if (wantsStream) {
      const encoder = new TextEncoder()
      const stream  = new ReadableStream({
        async start(controller) {
          const send = (data: object) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

          let fullText = ""; let inputTokens = 0; let outputTokens = 0

          try {
            const msgStream = anthropic.messages.stream(modelParams)
            for await (const event of msgStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                send({ type: "delta", delta: event.delta.text })
                fullText += event.delta.text
              }
              if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? 0
              if (event.type === "message_start") inputTokens  = event.message?.usage?.input_tokens ?? 0
            }

            const latencyMs = Date.now() - startMs
            const cost      = inputTokens * 0.000003 + outputTokens * 0.000015
            send({ type: "done", executionId: execution?.id, latencyMs, cost })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()

            await Promise.all([
              supabase.from("executions").update({
                status: "success", output: fullText,
                tokens_input: inputTokens, tokens_output: outputTokens,
                latency_ms: latencyMs, cost, cost_usd: cost,
                completed_at: new Date().toISOString(),
              }).eq("id", execution?.id ?? ""),
              supabase.rpc("increment_executions_used", { user_id_param: userId }),
            ])
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

    // ── Synchronous path ──────────────────────────────────────────────────
    const aiResponse = await anthropic.messages.create(modelParams)

    const latencyMs    = Date.now() - startMs
    const rawText      = aiResponse.content[0]?.type === "text" ? aiResponse.content[0].text : ""
    let output: unknown = rawText
    try { output = JSON.parse(rawText) } catch {}

    const inputTokens  = aiResponse.usage.input_tokens
    const outputTokens = aiResponse.usage.output_tokens
    const cost         = inputTokens * 0.000003 + outputTokens * 0.000015

    await Promise.all([
      supabase.from("executions").update({
        status: "success", output,
        tokens_input: inputTokens, tokens_output: outputTokens,
        latency_ms: latencyMs, cost, cost_usd: cost,
        completed_at: new Date().toISOString(),
      }).eq("id", execution?.id ?? ""),
      supabase.rpc("increment_executions_used", { user_id_param: userId }),
    ])

    return NextResponse.json({
      executionId: execution?.id,
      output,
      latencyMs,
      tokens: { input: inputTokens, output: outputTokens },
      cost,
    })

  } catch (err: any) {
    console.error("POST /api/agents/[id]/execute:", err)
    return NextResponse.json({ error: "Execution failed" }, { status: 500 })
  }
}
