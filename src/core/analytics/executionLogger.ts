/**
 * @module executionLogger
 * @path   src/core/analytics/executionLogger.ts
 *
 * Centralised structured execution logging.
 *
 * All execution events flow through here for:
 *   - Performance analytics (p50/p95/p99 latency)
 *   - Cost analytics (avg cost per agent, cost trends)
 *   - Quality signals (success rate, failure patterns)
 *   - Marketplace ranking inputs (efficiency score)
 *
 * Design: fire-and-forget safe — never throws, never blocks the
 * user-facing response. Use .catch(() => {}) at call sites.
 *
 * Batch mode: logs are buffered and written in a single INSERT
 * to reduce Supabase write pressure under high load.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogEventType =
  | "execution.started"
  | "execution.completed"
  | "execution.failed"
  | "execution.killed"        // hit a kill switch
  | "execution.timeout"
  | "pipeline.started"
  | "pipeline.completed"
  | "pipeline.failed"
  | "model.downgraded"
  | "model.upgraded"
  | "credits.deducted"
  | "credits.reconciled"
  | "guardrail.blocked"
  | "injection.blocked"
  | "injection.flagged"
  | "quota.exceeded"
  | "rate_limit.hit"

export interface ExecutionLogEntry {
  eventType:      LogEventType
  userId:         string | null
  agentId:        string | null
  executionId?:   string
  pipelineId?:    string
  model?:         string
  latencyMs?:     number
  costUsd?:       number
  tokensIn?:      number
  tokensOut?:     number
  status?:        string
  error?:         string
  metadata?:      Record<string, unknown>
}

// ─── Logger ───────────────────────────────────────────────────────────────────

/**
 * logExecutionEvent
 *
 * Writes a structured event to governance_events for analytics.
 * Never throws — all errors are suppressed.
 *
 * @example
 * await logExecutionEvent(supabase, {
 *   eventType:   "execution.completed",
 *   userId:      userId,
 *   agentId:     agentId,
 *   executionId: execution.id,
 *   model:       resolvedModel,
 *   latencyMs:   latencyMs,
 *   costUsd:     actualCostUsd,
 *   tokensIn:    inputTokens,
 *   tokensOut:   outputTokens,
 *   status:      "success",
 * })
 */
export async function logExecutionEvent(
  supabase: any,
  entry:    ExecutionLogEntry
): Promise<void> {
  try {
    const severity = entry.status === "failed" || entry.eventType.endsWith(".failed")
      ? "warning"
      : entry.eventType.includes("kill") || entry.eventType.includes("block")
        ? "critical"
        : "info"

    await supabase.from("governance_events").insert({
      user_id:    entry.userId,
      event_type: entry.eventType,
      severity,
      resource:   entry.agentId ? "agents" : entry.pipelineId ? "pipelines" : null,
      resource_id: entry.agentId ?? entry.pipelineId ?? null,
      details: {
        execution_id: entry.executionId,
        pipeline_id:  entry.pipelineId,
        model:        entry.model,
        latency_ms:   entry.latencyMs,
        cost_usd:     entry.costUsd,
        tokens_in:    entry.tokensIn,
        tokens_out:   entry.tokensOut,
        status:       entry.status,
        error:        entry.error,
        ...entry.metadata,
      },
    })
  } catch { /* never throw from logger */ }
}

/**
 * logBatch
 * Writes multiple events in a single INSERT to reduce DB round-trips.
 */
export async function logBatch(
  supabase: any,
  entries:  ExecutionLogEntry[]
): Promise<void> {
  if (entries.length === 0) return
  try {
    await supabase.from("governance_events").insert(
      entries.map(entry => ({
        user_id:    entry.userId,
        event_type: entry.eventType,
        severity:   "info",
        resource:   entry.agentId ? "agents" : null,
        resource_id: entry.agentId ?? null,
        details: {
          execution_id: entry.executionId,
          model:        entry.model,
          latency_ms:   entry.latencyMs,
          cost_usd:     entry.costUsd,
          tokens_in:    entry.tokensIn,
          tokens_out:   entry.tokensOut,
          status:       entry.status,
          ...entry.metadata,
        },
      }))
    )
  } catch { /* non-fatal */ }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export async function logExecutionComplete(
  supabase:     any,
  userId:       string,
  agentId:      string,
  executionId:  string,
  model:        string,
  latencyMs:    number,
  costUsd:      number,
  tokensIn:     number,
  tokensOut:    number,
  status:       "success" | "failed",
  error?:       string
): Promise<void> {
  await logExecutionEvent(supabase, {
    eventType:   status === "success" ? "execution.completed" : "execution.failed",
    userId,
    agentId,
    executionId,
    model,
    latencyMs,
    costUsd,
    tokensIn,
    tokensOut,
    status,
    error,
  })
}

export async function logModelChange(
  supabase:        any,
  userId:          string,
  agentId:         string,
  requestedModel:  string,
  resolvedModel:   string,
  reason:          string
): Promise<void> {
  await logExecutionEvent(supabase, {
    eventType: requestedModel !== resolvedModel ? "model.downgraded" : "execution.started",
    userId,
    agentId,
    metadata:  { requested_model: requestedModel, resolved_model: resolvedModel, reason },
  })
}
