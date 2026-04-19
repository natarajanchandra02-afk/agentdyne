export const runtime = 'edge'

/**
 * POST /api/execute — legacy generic execution endpoint
 *
 * Security hardening applied:
 *   - Input length cap (32 KB) to prevent abuse / prompt stuffing
 *   - Banned-user check before execution
 *   - Quota check before inserting execution record (no orphaned rows)
 *   - Execution record created only after all checks pass
 *   - Cost written to execution record for analytics
 *   - Null-safe for execution record (handles race conditions)
 *   - API key timing-safe lookup
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { apiRateLimit } from "@/lib/rate-limit"

const MAX_INPUT_BYTES = 32_768 // 32 KB hard cap on raw input

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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
    const apiKey =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")

    // ── API key auth ───────────────────────────────────────────────────────
    if (!userId && apiKey) {
      const keyHash = await hashApiKey(apiKey)
      const { data: keyData } = await supabase
        .from("api_keys")
        .select("user_id, is_active")
        .eq("key_hash", keyHash)
        .single()

      if (!keyData?.is_active) {
        return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 })
      }
      userId = keyData.user_id

      // Update last_used_at asynchronously — don't block response
      supabase.from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_hash", keyHash)
        .then()
    }

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    // ── Parse + validate body ──────────────────────────────────────────────
    let body: Record<string, unknown>
    try { body = await req.json() } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const { agentId, input } = body

    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 })
    }

    if (!/^[0-9a-f-]{36}$/i.test(agentId)) {
      return NextResponse.json({ error: "Invalid agentId format" }, { status: 400 })
    }

    // Input length cap — prevent prompt-stuffing and cost abuse
    // inputStr is sent to the AI; inputJson is stored in executions.input (jsonb NOT NULL)
    const inputStr  = typeof input === "string" ? input : JSON.stringify(input ?? "")
    const inputJson = typeof input === "string" ? { text: input } : (input ?? {})
    if (new TextEncoder().encode(inputStr).length > MAX_INPUT_BYTES) {
      return NextResponse.json(
        { error: `Input exceeds maximum size of ${MAX_INPUT_BYTES / 1024} KB` },
        { status: 413 }
      )
    }

    // ── Load agent ─────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, status, model_name, system_prompt, max_tokens, temperature, pricing_model, free_calls_per_month")
      .eq("id", agentId)
      .eq("status", "active")
      .single()

    if (!agent) {
      return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 })
    }

    // ── Load user profile (quota + ban check) ──────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan, is_banned")
      .eq("id", userId)
      .single()

    // Banned user check
    if (profile?.is_banned) {
      return NextResponse.json(
        { error: "Your account has been suspended. Contact support." },
        { status: 403 }
      )
    }

    // Monthly quota check
    if (
      profile &&
      profile.monthly_execution_quota !== -1 &&
      (profile.executions_used_this_month ?? 0) >= (profile.monthly_execution_quota ?? 0)
    ) {
      return NextResponse.json(
        { error: "Monthly execution quota exceeded. Please upgrade your plan.", code: "QUOTA_EXCEEDED" },
        { status: 429 }
      )
    }

    // Subscription check for paid agents
    if (agent.pricing_model === "subscription") {
      const { data: subscription } = await supabase
        .from("agent_subscriptions")
        .select("status")
        .eq("user_id", userId)
        .eq("agent_id", agentId)
        .single()

      const freeCallsUsed = profile?.executions_used_this_month ?? 0
      const freeCallsAllowed = agent.free_calls_per_month ?? 0
      const hasFreeAccess = freeCallsUsed < freeCallsAllowed

      if (!hasFreeAccess && subscription?.status !== "active") {
        return NextResponse.json(
          { error: "Subscription required to run this agent", code: "SUBSCRIPTION_REQUIRED" },
          { status: 403 }
        )
      }
    }

    // ── Insert execution record AFTER all checks ───────────────────────────
    // executions.input is jsonb NOT NULL — store as JSON object, never a raw string
    const { data: execution, error: execInsertErr } = await supabase
      .from("executions")
      .insert({
        agent_id:   agentId,
        user_id:    userId,
        status:     "running",
        input:      inputJson,   // jsonb: { text: "..." } or original object
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (execInsertErr || !execution) {
      console.error("Failed to create execution record:", execInsertErr)
      return NextResponse.json({ error: "Failed to start execution" }, { status: 500 })
    }

    const startTime = Date.now()

    try {
      const response = await anthropic.messages.create({
        model:       agent.model_name  || "claude-sonnet-4-20250514",
        max_tokens:  agent.max_tokens  || 4096,
        system:      agent.system_prompt,
        messages:    [{ role: "user" as const, content: inputStr }],
        temperature: agent.temperature ?? 0.7,
      })

      const latencyMs  = Date.now() - startTime
      const outputText = response.content[0]?.type === "text" ? response.content[0].text : ""

      // executions.output is jsonb — always store as an object, never a bare string
      let outputJson: Record<string, unknown> = { text: outputText }
      try {
        const parsed = JSON.parse(outputText)
        if (typeof parsed === "object" && parsed !== null) {
          outputJson = parsed
        } else {
          outputJson = { result: parsed }
        }
      } catch { /* keep { text: outputText } */ }

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

      // Increment monthly quota counter (fire-and-forget)
      supabase.rpc("increment_executions_used", { user_id_param: userId }).then()

      // Callers receive the raw text + parsed result cleanly separated
      const outputForCaller = outputJson.text !== undefined ? outputJson : { text: outputText, ...outputJson }

      return NextResponse.json({
        executionId: execution.id,
        output:      outputForCaller,
        latencyMs,
        tokens: {
          input:  response.usage.input_tokens,
          output: response.usage.output_tokens,
        },
        cost: costUsd,
      })

    } catch (aiError: any) {
      await supabase.from("executions").update({
        status:        "failed",
        error_message: aiError.message ?? "AI provider error",
        completed_at:  new Date().toISOString(),
      }).eq("id", execution.id)

      console.error("POST /api/execute AI error:", aiError)
      return NextResponse.json({ error: "Execution failed: " + (aiError.message ?? "Unknown error") }, { status: 500 })
    }

  } catch (err: any) {
    console.error("POST /api/execute:", err)
    return NextResponse.json({ error: err.message || "Execution failed" }, { status: 500 })
  }
}
