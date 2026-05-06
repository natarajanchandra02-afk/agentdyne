export const runtime = "edge"

/**
 * POST /api/executions/[id]/replay
 *
 * Replays a past execution with optional overrides (model, temperature).
 * Compares the new output to the original and returns a structured diff.
 *
 * Enterprise use cases:
 *   - A/B test: "Would Opus have given a better answer than Haiku?"
 *   - Debug: "Why did this execution fail? Replay with higher temperature."
 *   - Compliance: "Replay with an audit trail to prove determinism."
 *   - Cost analysis: "How much did routing save vs baseline Sonnet?"
 *
 * Input:
 *   { overrides?: { model?: string; temperature?: number; system_prompt?: string } }
 *
 * Output:
 *   {
 *     replayId, originalOutput, newOutput,
 *     outputsIdentical, diff,
 *     originalCost, replayCost, costDelta,
 *     originalModel, replayModel,
 *     originalLatency, replayLatency, latencyDelta
 *   }
 */

import { NextRequest, NextResponse }      from "next/server"
import { createClient }                   from "@/lib/supabase/server"
import { apiRateLimit }                   from "@/lib/rate-limit"
import { routeCompletion, MODELS }        from "@/lib/model-router"
import { checkInput }                     from "@/lib/guardrails"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SUPPORTED_MODELS = Object.values(MODELS) as string[]

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
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
    const { id: executionId } = await params
    if (!UUID_RE.test(executionId))
      return NextResponse.json({ error: "Invalid execution id" }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // ── Load original execution ───────────────────────────────────────────────
    const { data: execution } = await supabase
      .from("executions")
      .select("id, agent_id, user_id, input, output, status, cost, cost_usd, latency_ms, created_at")
      .eq("id",      executionId)
      .eq("user_id", user.id)        // ownership check
      .eq("status",  "success")      // only replay successful executions
      .single()

    if (!execution)
      return NextResponse.json({ error: "Execution not found, not yours, or not successful" }, { status: 404 })

    // ── Load the execution trace (has system_prompt + model) ─────────────────
    const { data: trace } = await supabase
      .from("execution_traces")
      .select("model, system_prompt, user_message, assistant_reply, temperature, tokens_input, tokens_output, cost_usd")
      .eq("execution_id", executionId)
      .maybeSingle()

    if (!trace?.user_message)
      return NextResponse.json({ error: "Execution trace not found — cannot replay without original input" }, { status: 422 })

    // ── Load agent ────────────────────────────────────────────────────────────
    const { data: agent } = await supabase
      .from("agents")
      .select("id, name, model_name, system_prompt, max_tokens, temperature")
      .eq("id", execution.agent_id as string)
      .single()

    if (!agent)
      return NextResponse.json({ error: "Agent not found" }, { status: 404 })

    // ── Parse overrides ───────────────────────────────────────────────────────
    let body: { overrides?: { model?: string; temperature?: number; system_prompt?: string } } = {}
    try { body = await req.json() } catch { /* overrides are optional */ }

    const overrides = body.overrides ?? {}

    // Validate override model
    if (overrides.model && !SUPPORTED_MODELS.includes(overrides.model))
      return NextResponse.json({ error: `Unsupported model: ${overrides.model}` }, { status: 400 })

    if (overrides.temperature !== undefined) {
      const t = Number(overrides.temperature)
      if (isNaN(t) || t < 0 || t > 2)
        return NextResponse.json({ error: "temperature must be 0–2" }, { status: 400 })
    }

    // ── Build replay params ───────────────────────────────────────────────────
    const replayModel   = overrides.model        ?? trace.model        ?? (agent.model_name as string)
    const replayTemp    = overrides.temperature  ?? trace.temperature  ?? (agent.temperature as number) ?? 0.7
    const replaySystem  = overrides.system_prompt ?? trace.system_prompt ?? (agent.system_prompt as string)
    const replayMessage = trace.user_message

    // Safety check on original input (just in case)
    const guardResult = checkInput(replayMessage)
    if (!guardResult.allowed)
      return NextResponse.json({ error: "Original input failed safety check — cannot replay" }, { status: 400 })

    // ── Create replay session record ──────────────────────────────────────────
    const { data: replaySession, error: replayInsertErr } = await supabase
      .from("replay_sessions")
      .insert({
        original_execution_id: executionId,
        replayed_by:           user.id,
        agent_id:              execution.agent_id,
        modifications:         overrides,
        original_output_hash:  await sha256hex(String(trace.assistant_reply ?? "")),
        status:                "running",
        started_at:            new Date().toISOString(),
      })
      .select("id")
      .single()

    if (replayInsertErr || !replaySession)
      return NextResponse.json({ error: "Failed to create replay session" }, { status: 500 })

    const replayId = replaySession.id

    // ── Run the replay ────────────────────────────────────────────────────────
    let newText: string, newInputTok: number, newOutputTok: number, newCostUsd: number

    try {
      const result = await routeCompletion({
        model:       replayModel,
        system:      replaySystem,
        userMessage: replayMessage,
        maxTokens:   Math.min(agent.max_tokens as number ?? 4096, 4096),
        temperature: replayTemp,
      })
      newText      = result.text
      newInputTok  = result.inputTokens
      newOutputTok = result.outputTokens
      newCostUsd   = result.costUsd
    } catch (llmErr: any) {
      // Mark replay as failed
      await supabase.from("replay_sessions").update({
        status: "failed", completed_at: new Date().toISOString(),
      }).eq("id", replayId)
      return NextResponse.json({ error: `Replay LLM error: ${llmErr.message?.slice(0, 200)}` }, { status: 502 })
    }

    const replayLatencyMs = Date.now() - startMs

    // ── Compare outputs ───────────────────────────────────────────────────────
    const originalText   = trace.assistant_reply ?? ""
    const newOutputHash  = await sha256hex(newText)
    const origOutputHash = await sha256hex(originalText)
    const outputsIdentical = newOutputHash === origOutputHash

    // Simple diff: return char-level diff size as a % and first 500 chars of each
    const origLen = originalText.length
    const newLen  = newText.length
    const diffPct = origLen > 0
      ? Math.round(Math.abs(origLen - newLen) / Math.max(origLen, newLen) * 100)
      : 0

    // ── Cost delta ────────────────────────────────────────────────────────────
    const originalCostUsd = trace.cost_usd ?? (execution.cost_usd ?? execution.cost ?? 0)
    const costDelta       = newCostUsd - Number(originalCostUsd)
    const costDeltaPct    = Number(originalCostUsd) > 0
      ? Math.round((costDelta / Number(originalCostUsd)) * 100)
      : 0

    // ── Update replay session ─────────────────────────────────────────────────
    await supabase.from("replay_sessions").update({
      status:              "success",
      replay_output_hash:  newOutputHash,
      outputs_identical:   outputsIdentical,
      replay_cost_usd:     newCostUsd,
      replay_latency_ms:   replayLatencyMs,
      completed_at:        new Date().toISOString(),
    }).eq("id", replayId)

    // WAL entry for the replay
    supabase.from("execution_wal").insert({
      execution_id:  executionId,
      sequence_num:  99,               // 99 = replay marker (doesn't conflict with original steps)
      event_type:    "replay",
      model_used:    replayModel,
      tokens_input:  newInputTok,
      tokens_output: newOutputTok,
      latency_ms:    replayLatencyMs,
      cost_usd:      newCostUsd,
      status:        "success",
      event_payload: {
        replay_session_id:  replayId,
        overrides,
        outputs_identical:  outputsIdentical,
        cost_delta_pct:     costDeltaPct,
      },
    }).then(() => {}).catch(() => {})

    return NextResponse.json({
      replayId,
      originalExecutionId: executionId,
      // Outputs
      originalOutput: originalText,
      newOutput:      newText,
      outputsIdentical,
      diff: {
        sizeDeltaPct: diffPct,
        originalChars: origLen,
        newChars:      newLen,
        summary: outputsIdentical
          ? "Outputs are identical — execution is deterministic for this input."
          : `Outputs differ by ~${diffPct}% in length.`,
      },
      // Models
      originalModel: trace.model ?? agent.model_name,
      replayModel,
      modelChanged:  replayModel !== (trace.model ?? agent.model_name),
      // Cost
      originalCost:  Number(originalCostUsd),
      replayCost:    newCostUsd,
      costDelta,
      costDeltaPct,
      costInsight: costDelta < 0
        ? `Replay was ${Math.abs(costDeltaPct)}% cheaper than original`
        : costDelta > 0
        ? `Replay was ${costDeltaPct}% more expensive than original`
        : "Same cost",
      // Latency
      originalLatencyMs: execution.latency_ms ?? 0,
      replayLatencyMs,
      latencyDelta:      replayLatencyMs - (execution.latency_ms ?? 0),
      // Tokens
      tokens: { input: newInputTok, output: newOutputTok },
    })

  } catch (err: any) {
    console.error("POST /api/executions/[id]/replay:", err)
    return NextResponse.json({ error: "Replay failed" }, { status: 500 })
  }
}
