/**
 * AgentDyne — OpenTelemetry Trace Shaping
 *
 * Converts AgentDyne's internal execution/governance-event records into
 * OTLP/HTTP JSON (OpenTelemetry Protocol) so external tools — Datadog,
 * Honeycomb, Grafana Tempo, any OTLP-compatible collector — can ingest
 * them without a custom parser.
 *
 * This is a pure data-shaping layer. It reads from `executions` and
 * `governance_events`, both already populated by the existing execution
 * path (lib/monitoring.ts, core/analytics/executionLogger.ts) — nothing
 * here writes to those tables or changes when/how they're written.
 *
 * Edge-runtime safe: Web Crypto + fetch only, no Node.js APIs.
 */

// ── OTLP JSON shapes (minimal subset needed) ────────────────────────────────

interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number  // 1=INTERNAL, 2=SERVER, 3=CLIENT
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean } }>
  status: { code: number; message?: string }  // 0=UNSET, 1=OK, 2=ERROR
}

interface OtlpResourceSpans {
  resourceSpans: Array<{
    resource: { attributes: Array<{ key: string; value: { stringValue: string } }> }
    scopeSpans: Array<{
      scope: { name: string; version: string }
      spans: OtlpSpan[]
    }>
  }>
}

function attr(key: string, value: string | number | boolean | undefined | null) {
  if (value === undefined || value === null) return null
  if (typeof value === "string") return { key, value: { stringValue: value } }
  if (typeof value === "boolean") return { key, value: { boolValue: value } }
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } }
  return { key, value: { doubleValue: value } }
}

function nonNull<T>(arr: (T | null)[]): T[] {
  return arr.filter((x): x is T => x !== null)
}

function toNanos(iso: string): string {
  // BigInt(x) function form, not the `123n` literal syntax — the literal
  // requires --target ES2020, which this project's tsconfig doesn't set
  // (pre-existing, see tsconfig.json); the function form has no such
  // restriction and compiles cleanly regardless of target.
  return String(BigInt(new Date(iso).getTime()) * BigInt(1_000_000))
}

/** Deterministic 16-byte trace id / 8-byte span id from a uuid, so re-fetching the same execution yields the same ids. */
async function idsFromExecutionId(executionId: string): Promise<{ traceId: string; spanId: string }> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(executionId))
  const bytes = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("")
  return { traceId: bytes.slice(0, 32), spanId: bytes.slice(32, 48) }
}

export interface ExecutionForTrace {
  id: string
  agent_id: string | null
  model: string | null           // resolved from execution_traces.selected_model by the caller
  status: string | null
  latency_ms: number | null
  cost: number | null            // matches executions.cost (USD)
  tokens_input: number | null
  tokens_output: number | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

/**
 * buildExecutionTrace
 * One execution → one OTLP trace with a single root span carrying
 * AgentDyne's standard attributes (agent id, model, cost, tokens).
 * Matches the shape a customer's collector expects with zero custom code.
 */
export async function buildExecutionTrace(execution: ExecutionForTrace): Promise<OtlpResourceSpans> {
  const { traceId, spanId } = await idsFromExecutionId(execution.id)
  const start = execution.created_at
  const end = execution.completed_at ?? execution.created_at

  const span: OtlpSpan = {
    traceId,
    spanId,
    name: "agentdyne.agent.execute",
    kind: 1,
    startTimeUnixNano: toNanos(start),
    endTimeUnixNano: toNanos(end),
    attributes: nonNull([
      attr("agentdyne.execution_id", execution.id),
      attr("agentdyne.agent_id", execution.agent_id),
      attr("agentdyne.model", execution.model),
      attr("agentdyne.cost_usd", execution.cost ?? undefined),
      attr("agentdyne.tokens_in", execution.tokens_input ?? undefined),
      attr("agentdyne.tokens_out", execution.tokens_output ?? undefined),
      attr("agentdyne.status", execution.status),
    ]),
    status: execution.status === "failed"
      ? { code: 2, message: execution.error_message ?? "execution failed" }
      : { code: 1 },
  }

  return {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "agentdyne" } }] },
      scopeSpans: [{ scope: { name: "agentdyne.executions", version: "2.3.0" }, spans: [span] }],
    }],
  }
}

// ── HMAC signing for pushed batches — identical convention to lib/webhook-dispatcher.ts ──

export async function hmacSignBatch(secret: string, payload: string): Promise<string> {
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    )
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
    return "v1=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")
  } catch {
    return "v1=error"
  }
}

export async function deliverOtlpBatch(
  endpointUrl: string,
  headers: Record<string, string>,
  secret: string,
  payload: OtlpResourceSpans,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const body = JSON.stringify(payload)
  const signature = await hmacSignBatch(secret, body)
  try {
    const res = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentDyne-Signature": signature,
        "User-Agent": "AgentDyne-OtelExporter/1.0",
        ...headers,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    return { ok: res.ok, status: res.status }
  } catch (err: any) {
    return { ok: false, status: 0, error: err.message ?? "Network error" }
  }
}
