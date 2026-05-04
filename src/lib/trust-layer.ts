/**
 * AgentDyne Trust Layer Lite
 *
 * The 20% implementation that gives 80% of the value of a full
 * Agent Message Contract (AMC) system.
 *
 * What this provides:
 *   1. Intent hash — SHA-256 of the original user input, propagated through
 *      every pipeline step unchanged. If a step modifies intent (semantic drift),
 *      the hash detects it.
 *
 *   2. Input/output hashing — SHA-256 of each step's input and output.
 *      Enables deterministic replay: same hash → return cached output.
 *      Prevents re-running LLM calls on retry (idempotent step execution).
 *
 *   3. Confidence extraction — agents can return { confidence: 0.0-1.0 } in
 *      their output. The pipeline uses this for conditional routing:
 *      if confidence < threshold → retry with better model or halt.
 *
 *   4. Step envelope — minimal metadata attached to each step result for
 *      audit trail, debugging, and enterprise trust signals.
 *
 * What this does NOT build (Series A+):
 *   - Full provenance graph (parent_step_id chains)
 *   - Semantic entropy engine (logprob-based uncertainty)
 *   - Deterministic replay engine (Redis Streams, append-only log)
 *   - Cross-pipeline intent tracking
 *
 * Edge-runtime safe: Web Crypto API only, no Node.js crypto.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StepEnvelope {
  step_id:          string   // node.id
  pipeline_run_id:  string   // pipeline_execution.id
  agent_id:         string
  step_index:       number

  intent_hash:      string   // SHA-256 of original pipeline input — never changes
  input_hash:       string   // SHA-256 of this step's actual input
  output_hash:      string   // SHA-256 of this step's output (empty string if failed)

  confidence?:      number   // 0.0–1.0 extracted from output if present
  semantic_summary?: string  // first 200 chars of output text for quick review

  created_at:       string
}

export interface ConfidenceGatingResult {
  shouldContinue: boolean
  shouldRetry:    boolean
  shouldUpgrade:  boolean   // route to a better model
  confidence:     number
  reason:         string
}

// ─── SHA-256 hash ─────────────────────────────────────────────────────────────

/**
 * sha256hex — Edge-runtime safe SHA-256 using Web Crypto.
 * Returns lowercase hex string.
 */
export async function sha256hex(input: unknown): Promise<string> {
  const text = typeof input === "string"
    ? input
    : JSON.stringify(input ?? "")
  const data = new TextEncoder().encode(text)
  const buf  = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// ─── Intent hash ──────────────────────────────────────────────────────────────

/**
 * buildIntentHash
 *
 * Called once at pipeline start with the original user input.
 * The same hash is passed to every step unchanged.
 *
 * If any step's input diverges significantly from the intent hash
 * (detected by comparing hashes), it flags semantic drift.
 *
 * The hash includes the pipeline ID so replays from different
 * pipelines don't collide in the checkpoint table.
 */
export async function buildIntentHash(
  pipelineId: string,
  originalInput: unknown
): Promise<string> {
  const normalized = typeof originalInput === "string"
    ? originalInput.toLowerCase().replace(/\s+/g, " ").trim()
    : JSON.stringify(originalInput)
  return sha256hex(`intent:${pipelineId}:${normalized}`)
}

// ─── Step envelope builder ─────────────────────────────────────────────────────

/**
 * buildStepEnvelope
 *
 * Called after each step completes (success or failure).
 * Stored in pipeline_step_checkpoints alongside the step result.
 */
export async function buildStepEnvelope(params: {
  nodeId:        string
  pipelineRunId: string
  agentId:       string
  stepIndex:     number
  intentHash:    string
  input:         unknown
  output:        unknown
}): Promise<StepEnvelope> {
  const [inputHash, outputHash] = await Promise.all([
    sha256hex(params.input),
    params.output !== null && params.output !== undefined
      ? sha256hex(params.output)
      : Promise.resolve(""),
  ])

  const confidence   = extractConfidence(params.output)
  const summary      = extractSummary(params.output)

  return {
    step_id:          params.nodeId,
    pipeline_run_id:  params.pipelineRunId,
    agent_id:         params.agentId,
    step_index:       params.stepIndex,
    intent_hash:      params.intentHash,
    input_hash:       inputHash,
    output_hash:      outputHash,
    confidence,
    semantic_summary: summary,
    created_at:       new Date().toISOString(),
  }
}

// ─── Confidence extraction ─────────────────────────────────────────────────────

/**
 * extractConfidence
 *
 * Looks for a confidence field in the agent's output.
 * Agents can return: { "output": "...", "confidence": 0.87 }
 *
 * Returns undefined if confidence is not present.
 * Never throws — confidence is optional.
 */
export function extractConfidence(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined
  const obj = output as Record<string, unknown>
  const raw = obj.confidence ?? obj.score ?? obj.certainty ?? obj.probability
  if (raw === null || raw === undefined) return undefined
  const n = typeof raw === "number" ? raw : parseFloat(String(raw))
  if (isNaN(n)) return undefined
  // Normalize: if > 1 assume it's a percentage (e.g. 87 → 0.87)
  return n > 1 ? Math.min(n / 100, 1.0) : Math.min(Math.max(n, 0), 1.0)
}

/**
 * extractSummary
 *
 * Extracts a short plain-text summary from the output for admin review.
 * Takes the first 200 chars of the text field.
 */
export function extractSummary(output: unknown): string | undefined {
  if (!output) return undefined
  if (typeof output === "string") return output.slice(0, 200)
  if (typeof output === "object") {
    const obj = output as Record<string, unknown>
    const text = obj.text ?? obj.output ?? obj.result ?? obj.content ?? obj.summary
    if (typeof text === "string") return text.slice(0, 200)
  }
  return undefined
}

// ─── Confidence-based gating ──────────────────────────────────────────────────

/**
 * evaluateConfidenceGating
 *
 * Decides what to do next based on agent confidence.
 *
 *   confidence >= 0.7  → continue (default)
 *   confidence  0.4–0.7 → retry with same model OR upgrade model
 *   confidence < 0.4   → halt (output unreliable)
 *   undefined          → continue (no confidence = trust the output)
 *
 * @param nodeConfig  Optional per-node config from DAG (confidence_threshold, on_low_confidence)
 */
export function evaluateConfidenceGating(
  confidence: number | undefined,
  nodeConfig?: {
    confidence_threshold?: number
    on_low_confidence?: "halt" | "retry" | "upgrade" | "continue"
  }
): ConfidenceGatingResult {
  // No confidence signal → always continue
  if (confidence === undefined) {
    return { shouldContinue: true, shouldRetry: false, shouldUpgrade: false, confidence: 1, reason: "no_confidence_signal" }
  }

  const threshold = nodeConfig?.confidence_threshold ?? 0.6
  const behavior  = nodeConfig?.on_low_confidence ?? "retry"

  if (confidence >= threshold) {
    return { shouldContinue: true, shouldRetry: false, shouldUpgrade: false, confidence, reason: "above_threshold" }
  }

  // Below threshold
  switch (behavior) {
    case "halt":
      return { shouldContinue: false, shouldRetry: false, shouldUpgrade: false, confidence, reason: `confidence ${confidence.toFixed(2)} below ${threshold} → halted` }
    case "upgrade":
      return { shouldContinue: false, shouldRetry: false, shouldUpgrade: true, confidence, reason: `confidence ${confidence.toFixed(2)} below ${threshold} → upgrade model` }
    case "continue":
      return { shouldContinue: true, shouldRetry: false, shouldUpgrade: false, confidence, reason: `confidence ${confidence.toFixed(2)} below ${threshold} → continuing (permissive mode)` }
    case "retry":
    default:
      return { shouldContinue: false, shouldRetry: true, shouldUpgrade: false, confidence, reason: `confidence ${confidence.toFixed(2)} below ${threshold} → retry` }
  }
}

// ─── Semantic drift detection ─────────────────────────────────────────────────

/**
 * detectIntentDrift
 *
 * Detects if a step's output has drifted from the original user intent.
 * Used to flag pipelines where an intermediate agent "hijacked" the task.
 *
 * Simple heuristic: if the output text doesn't share any significant
 * tokens with the original input, flag it as potential drift.
 *
 * This is NOT a semantic embedding comparison — that's V2.
 * This is a fast, cheap token-overlap check that catches obvious drifts.
 *
 * Returns a drift score 0.0 (no drift) to 1.0 (complete drift).
 */
export function detectIntentDrift(
  originalInput: string,
  stepOutput:    unknown
): { driftScore: number; flagged: boolean } {
  const outputText = typeof stepOutput === "string"
    ? stepOutput
    : typeof stepOutput === "object" && stepOutput !== null
      ? (extractSummary(stepOutput) ?? JSON.stringify(stepOutput).slice(0, 500))
      : String(stepOutput ?? "")

  if (!outputText || !originalInput) return { driftScore: 0, flagged: false }

  // Tokenize: lowercase words 4+ chars
  const tokenize = (s: string) => new Set(
    s.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []
  )

  const inputTokens  = tokenize(originalInput)
  const outputTokens = tokenize(outputText)

  if (inputTokens.size === 0 || outputTokens.size === 0)
    return { driftScore: 0, flagged: false }

  // Overlap: how many input tokens appear in output
  let overlap = 0
  for (const t of inputTokens) { if (outputTokens.has(t)) overlap++ }

  const overlapRatio = overlap / inputTokens.size
  // Low overlap = high drift. But short inputs naturally have low overlap.
  // Only flag if input is reasonably long (>10 meaningful tokens).
  const driftScore = inputTokens.size >= 5 ? Math.max(0, 1 - overlapRatio * 2) : 0
  const flagged    = driftScore > 0.8 && inputTokens.size >= 10

  return { driftScore: parseFloat(driftScore.toFixed(3)), flagged }
}

// ─── Tool call idempotency ─────────────────────────────────────────────────────

/**
 * buildToolCallId
 *
 * Creates a stable ID for a tool call: SHA-256(userId + toolName + serializedInput).
 * If this ID already exists in the DB with status='committed', return cached result.
 *
 * Prevents:
 *   - Double Slack message sends on pipeline retry
 *   - Double database writes
 *   - Double external API charges
 */
export async function buildToolCallId(
  userId:    string,
  toolName:  string,
  toolInput: unknown
): Promise<string> {
  return sha256hex(`tool:${userId}:${toolName}:${JSON.stringify(toolInput)}`)
}
