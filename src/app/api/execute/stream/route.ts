export const runtime = "edge"

/**
 * POST /api/execute/stream — Streaming SSE execution endpoint (P0)
 *
 * Streams tokens from Anthropic API via Server-Sent Events.
 * Self-correction agentic loop: if confidence < threshold, re-prompts automatically (P1).
 * Memory-aware: loads semantic memories and enriches system prompt.
 *
 * SSE event types:
 *   {type:"start", executionId, agentName}
 *   {type:"token", token}
 *   {type:"correction", attempt, reason, confidence}
 *   {type:"done", executionId, latencyMs, cost, tokens, correctionAttempts, memoryContextUsed}
 *   {type:"error", error, code}
 */

import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { checkInput } from "@/lib/guardrails"
import { PLAN_QUOTAS } from "@/lib/constants"
import { extractAndStoreExecutionMemories, getRelevantMemories, buildMemorySystemPrompt } from "@/lib/memory-graph"
import { extractConfidence, evaluateConfidenceGating } from "@/lib/trust-layer"
import { dispatchWebhooks } from "@/lib/webhook-dispatcher"
import type { PlanName } from "@/lib/anti-abuse"

const MAX_INPUT_BYTES      = 32_768
const MAX_CORRECTION_LOOPS = 3
const CONFIDENCE_THRESHOLD = 0.6

async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
}

function modelCostUsd(model: string, inp: number, out: number): number {
  const costs: Record<string, [number, number]> = {
    "claude-haiku-4-5-20251001": [0.00025,  0.00125],
    "claude-sonnet-4-6":         [0.003,    0.015],
    "claude-opus-4-6":           [0.015,    0.075],
    "gemini-2.5-flash":          [0.000175, 0.0007],
    "gemini-2.5-pro":            [0.0035,   0.014],
    "gpt-4o-mini":               [0.00015,  0.0006],
    "gpt-4o":                    [0.005,    0.015],
  }
  const [iRate, oRate] = costs[model] ?? [0.003, 0.015]
  return (inp / 1000) * iRate + (out / 1000) * oRate
}

async function streamAnthropic(
  apiKey: string, model: string, system: string,
  messages: Array<{role: "user" | "assistant"; content: string}>,
  maxTokens: number, temperature: number,
  onToken: (t: string) => void
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, temperature, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}`)

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = "", text = "", inp = 0, out = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split("\n"); buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6).trim()
      if (raw === "[DONE]") continue
      try {
        const e = JSON.parse(raw)
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
          const t = e.delta.text ?? ""; text += t; onToken(t)
        } else if (e.type === "message_delta" && e.usage) { out = e.usage.output_tokens ?? 0 }
        else if (e.type === "message_start" && e.message?.usage) { inp = e.message.usage.input_tokens ?? 0 }
      } catch {}
    }
  }
  return { text, inputTokens: inp, outputTokens: out }
}

export async function POST(req: NextRequest) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (obj: Record<string, unknown>) => {
        try { ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)) } catch {}
      }
      const close = () => {
        try { ctrl.enqueue(encoder.encode("data: [DONE]\n\n")); ctrl.close() } catch {}
      }

      try {
        const supabase = await createClient()

        // Auth
        let userId: string | undefined
        const { data: { user } } = await supabase.auth.getUser()
        userId = user?.id

        if (!userId) {
          const rawKey = req.headers.get("x-api-key") ??
            req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
          if (rawKey && rawKey.length <= 200) {
            const kh = await hashKey(rawKey)
            const { data: kr } = await supabase.from("api_keys")
              .select("user_id, is_active, expires_at").eq("key_hash", kh).single()
            if (kr?.is_active && !(kr.expires_at && new Date(kr.expires_at) < new Date())) {
              userId = kr.user_id
            } else { send({ type: "error", error: "Invalid API key", code: "UNAUTHORIZED" }); close(); return }
          }
        }
        if (!userId) { send({ type: "error", error: "Authentication required", code: "UNAUTHORIZED" }); close(); return }

        let body: Record<string, unknown>
        try { body = await req.json() } catch { send({ type: "error", error: "Invalid JSON" }); close(); return }

        const { agentId, input, enableSelfCorrection = true } = body as {
          agentId?: string; input?: unknown; enableSelfCorrection?: boolean
        }
        if (!agentId || typeof agentId !== "string") {
          send({ type: "error", error: "agentId required", code: "BAD_REQUEST" }); close(); return
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_plan, lifetime_executions_used, is_banned")
          .eq("id", userId).single()

        if (profile?.is_banned) { send({ type: "error", error: "Account suspended", code: "BANNED" }); close(); return }

        const plan = (profile?.subscription_plan ?? "free") as PlanName
        if (plan === "free" && (profile?.lifetime_executions_used ?? 0) >= PLAN_QUOTAS.free) {
          send({ type: "error", error: "Free plan limit reached. Upgrade to continue.", code: "QUOTA_EXCEEDED" }); close(); return
        }
        // Monthly quota check for paid plans
        if (plan !== "free" && plan !== "enterprise") {
          const quota = PLAN_QUOTAS[plan] ?? -1
          const used  = profile?.executions_used_this_month ?? 0
          if (quota !== -1 && used >= quota) {
            send({ type: "error", error: `${plan} plan quota of ${quota} executions/month reached.`, code: "QUOTA_EXCEEDED" }); close(); return
          }
        }

        const { data: agent } = await supabase
          .from("agents")
          .select("id, name, status, model_name, system_prompt, max_tokens, temperature")
          .eq("id", agentId).eq("status", "active").single()

        if (!agent) { send({ type: "error", error: "Agent not found", code: "NOT_FOUND" }); close(); return }

        const inputStr = typeof input === "string" ? input : JSON.stringify(input ?? "")
        if (new TextEncoder().encode(inputStr).length > MAX_INPUT_BYTES) {
          send({ type: "error", error: "Input too large", code: "TOO_LARGE" }); close(); return
        }
        if (!checkInput(inputStr).allowed) {
          send({ type: "error", error: "Input rejected by content policy", code: "CONTENT_POLICY" }); close(); return
        }

        // Semantic memory retrieval
        const memoryResult = await getRelevantMemories(supabase, userId, agentId, inputStr, { topK: 8 })
        const systemPrompt = buildMemorySystemPrompt(agent.system_prompt as string ?? "", memoryResult)

        const { data: execution } = await supabase
          .from("executions")
          .insert({
            agent_id: agentId, user_id: userId, status: "running",
            input: { text: inputStr }, stream_enabled: true,
            created_at: new Date().toISOString(),
          })
          .select("id").single()

        if (!execution) { send({ type: "error", error: "Failed to create execution", code: "DB_ERROR" }); close(); return }

        send({ type: "start", executionId: execution.id, agentName: agent.name })

        const apiKey = process.env.ANTHROPIC_API_KEY!
        const model  = (agent.model_name as string) || "claude-sonnet-4-6"
        const maxTok = Math.min((agent.max_tokens as number) || 4096, 8192)
        const temp   = (agent.temperature as number) ?? 0.7

        const startMs = Date.now()
        let totalCost = 0, totalInp = 0, totalOut = 0, corrections = 0
        let finalText = ""

        const msgs: Array<{role: "user"|"assistant"; content: string}> = [
          { role: "user", content: inputStr }
        ]

        for (let attempt = 0; attempt <= MAX_CORRECTION_LOOPS; attempt++) {
          const { text, inputTokens, outputTokens } = await streamAnthropic(
            apiKey, model, systemPrompt, msgs, maxTok, temp,
            (token) => send({ type: "token", token })
          )

          finalText = text
          totalInp += inputTokens; totalOut += outputTokens
          totalCost += modelCostUsd(model, inputTokens, outputTokens)

          // Self-correction agentic loop (P1)
          if (enableSelfCorrection && attempt < MAX_CORRECTION_LOOPS) {
            let parsedOutput: Record<string, unknown> | null = null
            try {
              const stripped = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim()
              parsedOutput = JSON.parse(stripped)
            } catch {}

            const confidence = extractConfidence(parsedOutput ?? { text })
            const gating = evaluateConfidenceGating(confidence, {
              confidence_threshold: CONFIDENCE_THRESHOLD,
              on_low_confidence: "retry",
            })

            if (!gating.shouldContinue && gating.shouldRetry && confidence !== undefined) {
              corrections++
              send({
                type: "correction", attempt: corrections,
                reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold — self-correcting`,
                confidence,
              })
              msgs.push({ role: "assistant", content: text })
              msgs.push({
                role: "user",
                content: `Your previous response had low confidence (${(confidence * 100).toFixed(0)}%). Please review and provide a more accurate, confident response. Original request: ${inputStr}`,
              })
              continue
            }
          }
          break
        }

        const latencyMs = Date.now() - startMs

        await Promise.all([
          supabase.from("executions").update({
            status: "success", output: { text: finalText },
            tokens_input: totalInp, tokens_output: totalOut,
            latency_ms: latencyMs, cost_usd: totalCost,
            correction_attempts: corrections,
            completed_at: new Date().toISOString(),
          }).eq("id", execution.id),
          supabase.rpc("increment_executions_used", { user_id_param: userId }),
        ])

        // Background: extract & store memories + fire webhooks
        extractAndStoreExecutionMemories(supabase, userId, agentId, inputStr, finalText).catch(() => {})
        dispatchWebhooks(supabase, userId, "execution.success", {
          executionId: execution.id, agentId, agentName: agent.name,
          status: "success", latencyMs, costUsd: totalCost,
          tokens: { input: totalInp, output: totalOut }, correctionAttempts: corrections,
        }).catch(() => {})

        send({
          type: "done", executionId: execution.id,
          latencyMs, cost: totalCost,
          tokens: { input: totalInp, output: totalOut },
          correctionAttempts: corrections, model,
          memoryContextUsed: memoryResult.retrieved,
        })
        close()

      } catch (err: any) {
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: err?.message ?? "Internal error", code: "INTERNAL" })}\n\n`))
          ctrl.enqueue(encoder.encode("data: [DONE]\n\n"))
          ctrl.close()
        } catch {}
      }
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
