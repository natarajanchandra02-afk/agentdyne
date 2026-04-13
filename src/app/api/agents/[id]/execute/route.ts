import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { apiRateLimit } from "@/lib/rate-limit"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function hashApiKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

// POST /api/agents/[id]/execute
// Next.js 15: params is a Promise
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  try {
    const { id: agentId } = await params
    const supabase        = await createClient()

    // ── Auth: session cookie OR Bearer API key ──────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")
      if (rawKey) {
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
        // Fire-and-forget: update last_used_at
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

    // ── Load agent ──────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("status", "active")
      .single()

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    }

    // ── Quota check ─────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan")
      .eq("id", userId)
      .single()

    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0

    if (quota !== -1 && used >= quota) {
      return NextResponse.json(
        { error: "Monthly quota exceeded. Please upgrade your plan.", code: "QUOTA_EXCEEDED" },
        { status: 429 }
      )
    }

    // ── Subscription gate ───────────────────────────────────────────────────
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
            { error: "Subscription required", code: "SUBSCRIPTION_REQUIRED" },
            { status: 403 }
          )
        }
      }
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json()
    const { input, stream: wantsStream } = body

    if (input === undefined || input === null) {
      return NextResponse.json({ error: "input is required" }, { status: 400 })
    }

    // ── Create execution record ─────────────────────────────────────────────
    const { data: execution } = await supabase
      .from("executions")
      .insert({ agent_id: agentId, user_id: userId, status: "running", input })
      .select()
      .single()

    const startMs     = Date.now()
    const userMessage = typeof input === "string" ? input : JSON.stringify(input)

    const modelParams = {
      model:       (agent.model_name as string) ?? "claude-sonnet-4-20250514",
      max_tokens:  (agent.max_tokens  as number) ?? 4096,
      system:      agent.system_prompt as string,
      messages:    [{ role: "user" as const, content: userMessage }],
      temperature: (agent.temperature as number) ?? 0.7,
    }

    // ── Streaming ───────────────────────────────────────────────────────────
    if (wantsStream) {
      const encoder = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: object) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

          let fullText     = ""
          let inputTokens  = 0
          let outputTokens = 0

          try {
            // Use .stream() — returns a properly iterable MessageStream
            const msgStream = anthropic.messages.stream(modelParams)

            for await (const event of msgStream) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                send({ type: "delta", delta: event.delta.text })
                fullText += event.delta.text
              }
              if (event.type === "message_delta") {
                outputTokens = event.usage?.output_tokens ?? 0
              }
              if (event.type === "message_start") {
                inputTokens = event.message?.usage?.input_tokens ?? 0
              }
            }

            const latencyMs = Date.now() - startMs
            const cost      = inputTokens * 0.000003 + outputTokens * 0.000015

            send({ type: "done", executionId: execution?.id, latencyMs })
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()

            // Persist asynchronously — don't block the stream close
            await Promise.all([
              supabase.from("executions").update({
                status: "success", output: fullText,
                tokens_input: inputTokens, tokens_output: outputTokens,
                latency_ms: latencyMs, cost,
                completed_at: new Date().toISOString(),
              }).eq("id", execution?.id ?? ""),
              supabase.rpc("increment_executions_used", { user_id_param: userId }),
            ])

          } catch (err: any) {
            send({ type: "error", error: err.message })
            controller.close()
            if (execution?.id) {
              await supabase.from("executions").update({
                status: "failed",
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

    // ── Synchronous ─────────────────────────────────────────────────────────
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
        latency_ms: latencyMs, cost,
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
    return NextResponse.json({ error: err.message ?? "Execution failed" }, { status: 500 })
  }
}
