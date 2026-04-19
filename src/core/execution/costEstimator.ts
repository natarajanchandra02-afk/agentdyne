/**
 * @module costEstimator
 * @path   src/core/execution/costEstimator.ts
 *
 * Deterministic, pre-flight cost estimation engine.
 * Called BEFORE every execution to:
 *   1. Show estimated cost to user (transparency)
 *   2. Validate credit balance (prevent failed executions)
 *   3. Choose the optimal model (cost/quality routing)
 *   4. Enforce plan spending ceilings
 *
 * Design: pure functions, no I/O, edge-runtime safe.
 * Zero external dependencies — usable in any runtime context.
 */

// ─── Model cost table (USD per 1K tokens, April 2026) ─────────────────────────

export const MODEL_COST_TABLE: Record<string, { input: number; output: number; contextWindow: number; tier: "economy" | "standard" | "premium" }> = {
  // Anthropic — primary provider
  "claude-haiku-4-5-20251001":   { input: 0.00025,  output: 0.00125, contextWindow: 200_000, tier: "economy"  },
  "claude-sonnet-4-6":           { input: 0.003,    output: 0.015,   contextWindow: 200_000, tier: "standard" },
  "claude-sonnet-4-20250514":    { input: 0.003,    output: 0.015,   contextWindow: 200_000, tier: "standard" },
  "claude-opus-4-6":             { input: 0.015,    output: 0.075,   contextWindow: 200_000, tier: "premium"  },
  // OpenAI
  "gpt-4o-mini":                 { input: 0.00015,  output: 0.0006,  contextWindow: 128_000, tier: "economy"  },
  "gpt-4o":                      { input: 0.005,    output: 0.015,   contextWindow: 128_000, tier: "standard" },
  // Google
  "gemini-1.5-flash":            { input: 0.000075, output: 0.0003,  contextWindow: 1_000_000, tier: "economy"  },
  "gemini-1.5-pro":              { input: 0.00125,  output: 0.005,   contextWindow: 2_000_000, tier: "standard" },
  // Fallback
  _default:                      { input: 0.003,    output: 0.015,   contextWindow: 128_000, tier: "standard" },
}

// ─── Platform margin config ───────────────────────────────────────────────────

/** Platform takes a 3× margin on all AI compute costs */
export const PLATFORM_MARGIN = 3.0

/** Minimum charge per execution to cover overhead */
export const MINIMUM_CHARGE_USD = 0.0001

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface EstimationInput {
  /** Raw user input text */
  inputText:     string
  /** Agent system prompt */
  systemPrompt:  string
  /** Requested model from agent config */
  model:         string
  /** Agent's configured max_tokens */
  maxTokens:     number
  /** Number of expected tool call rounds (for MCP agents) */
  toolCallRounds?: number
  /** Number of pipeline steps (1 for single agent) */
  pipelineSteps?:  number
}

export interface CostEstimate {
  /** Estimated input tokens (conservative) */
  tokensInputEst:   number
  /** Estimated output tokens (based on intent + max_tokens) */
  tokensOutputEst:  number
  /** Raw AI API cost (what we pay) */
  rawCostUsd:       number
  /** Amount charged to user (rawCost × margin) */
  userCostUsd:      number
  /** Worst-case cost (if model uses full max_tokens) */
  worstCaseCostUsd: number
  /** Confidence level of the estimate */
  confidence:       "high" | "medium" | "low"
  /** Per-model breakdown */
  model:            string
  modelTier:        "economy" | "standard" | "premium"
  /** Breakdown by component */
  breakdown: {
    systemPromptTokens: number
    inputTokens:        number
    outputTokens:       number
    toolCallOverhead:   number
    pipelineMultiplier: number
  }
}

export interface PipelineCostEstimate {
  steps:             CostEstimate[]
  totalRawCostUsd:   number
  totalUserCostUsd:  number
  worstCaseTotalUsd: number
  estimatedLatencyMs: number
}

// ─── Token estimation ─────────────────────────────────────────────────────────

/** Conservative token estimate: 1 token ≈ 3.5 chars for mixed content */
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 3.5)
}

/**
 * Estimate output tokens based on task intent signals.
 * This prevents over-charging short Q&A vs long generation tasks.
 */
function estimateOutputTokens(
  inputText: string,
  maxTokens: number
): { estimate: number; confidence: "high" | "medium" | "low" } {
  const q = inputText.toLowerCase().trim()
  const len = q.length

  // Short, factual queries → low output
  if (len < 100 || /^(what|who|when|where|is|are|does|did|how many|list).{0,80}[?]?$/i.test(q)) {
    return { estimate: Math.min(maxTokens, 400), confidence: "high" }
  }

  // Extraction tasks → moderate output
  if (/\b(extract|parse|identify|find all|list all|summarize|summarise)\b/i.test(q)) {
    return { estimate: Math.min(maxTokens, 800), confidence: "high" }
  }

  // Generation / writing tasks → high output
  if (/\b(write|draft|create|generate|compose|build|explain|describe|analyse|analyze)\b/i.test(q)) {
    return { estimate: Math.min(maxTokens, Math.ceil(maxTokens * 0.7)), confidence: "medium" }
  }

  // Default: 50% of max_tokens
  return { estimate: Math.min(maxTokens, Math.ceil(maxTokens * 0.5)), confidence: "low" }
}

// ─── Core estimation function ─────────────────────────────────────────────────

/**
 * estimateCost
 *
 * Returns a detailed cost estimate before execution.
 * Call this in the execute route BEFORE making the AI call.
 *
 * @example
 * const estimate = estimateCost({
 *   inputText: userMessage,
 *   systemPrompt: agent.system_prompt,
 *   model: agent.model_name,
 *   maxTokens: agent.max_tokens,
 * })
 * if (!estimate.withinBudget) return 402
 */
export function estimateCost(input: EstimationInput): CostEstimate {
  const {
    inputText,
    systemPrompt,
    model,
    maxTokens,
    toolCallRounds  = 0,
    pipelineSteps   = 1,
  } = input

  const rates    = MODEL_COST_TABLE[model] ?? MODEL_COST_TABLE["_default"]!
  const modelTier = rates.tier

  // Token breakdown
  const systemTokens = charsToTokens(systemPrompt.length)
  const inputTokens  = charsToTokens(inputText.length)
  const totalInput   = systemTokens + inputTokens

  // Tool call overhead: each round ~200 tokens for tool schema + results
  const toolOverhead = toolCallRounds * 200

  // Output estimation
  const { estimate: outputEst, confidence } = estimateOutputTokens(inputText, maxTokens)

  // Pipeline multiplier: sequential steps share context overhead
  const pipelineMult = pipelineSteps

  // Worst case: full max_tokens used for output
  const worstCaseOutput = maxTokens

  // Cost calculations
  const rawCost = (
    (totalInput + toolOverhead) / 1000 * rates.input +
    outputEst / 1000 * rates.output
  ) * pipelineMult

  const worstCaseRaw = (
    (totalInput + toolOverhead) / 1000 * rates.input +
    worstCaseOutput / 1000 * rates.output
  ) * pipelineMult

  const userCost      = Math.max(MINIMUM_CHARGE_USD, rawCost * PLATFORM_MARGIN)
  const worstCaseUser = Math.max(MINIMUM_CHARGE_USD, worstCaseRaw * PLATFORM_MARGIN)

  return {
    tokensInputEst:   totalInput,
    tokensOutputEst:  outputEst,
    rawCostUsd:       parseFloat(rawCost.toFixed(8)),
    userCostUsd:      parseFloat(userCost.toFixed(8)),
    worstCaseCostUsd: parseFloat(worstCaseUser.toFixed(8)),
    confidence,
    model,
    modelTier,
    breakdown: {
      systemPromptTokens: systemTokens,
      inputTokens,
      outputTokens:       outputEst,
      toolCallOverhead:   toolOverhead,
      pipelineMultiplier: pipelineMult,
    },
  }
}

/**
 * estimatePipelineCost
 * Estimates cost across all nodes in a pipeline.
 */
export function estimatePipelineCost(
  steps: Array<{
    inputText:    string
    systemPrompt: string
    model:        string
    maxTokens:    number
  }>
): PipelineCostEstimate {
  const estimates = steps.map(s => estimateCost(s))

  const totalRaw   = estimates.reduce((s, e) => s + e.rawCostUsd,      0)
  const totalUser  = estimates.reduce((s, e) => s + e.userCostUsd,     0)
  const worstCase  = estimates.reduce((s, e) => s + e.worstCaseCostUsd, 0)

  // Latency estimate: 2-5s per step (conservative)
  const estimatedLatency = steps.length * 3_000

  return {
    steps,
    totalRawCostUsd:    parseFloat(totalRaw.toFixed(8)),
    totalUserCostUsd:   parseFloat(totalUser.toFixed(8)),
    worstCaseTotalUsd:  parseFloat(worstCase.toFixed(8)),
    estimatedLatencyMs: estimatedLatency,
  }
}

/**
 * reconcileActualCost
 * Called AFTER execution with actual token usage to compute the true cost.
 * Returns the difference vs estimate for analytics and over/under-charging correction.
 */
export function reconcileActualCost(
  model:            string,
  actualInputTokens: number,
  actualOutputTokens: number
): {
  rawCostUsd:    number
  userCostUsd:   number
  inputCostUsd:  number
  outputCostUsd: number
} {
  const rates = MODEL_COST_TABLE[model] ?? MODEL_COST_TABLE["_default"]!

  const inputCost  = (actualInputTokens  / 1000) * rates.input
  const outputCost = (actualOutputTokens / 1000) * rates.output
  const rawCost    = inputCost + outputCost
  const userCost   = Math.max(MINIMUM_CHARGE_USD, rawCost * PLATFORM_MARGIN)

  return {
    rawCostUsd:    parseFloat(rawCost.toFixed(8)),
    userCostUsd:   parseFloat(userCost.toFixed(8)),
    inputCostUsd:  parseFloat(inputCost.toFixed(8)),
    outputCostUsd: parseFloat(outputCost.toFixed(8)),
  }
}

/**
 * formatCostForDisplay — human-readable cost string for UI
 * $0.0001 → "< $0.001"
 * $0.00234 → "$0.002"
 * $1.23456 → "$1.23"
 */
export function formatCostForDisplay(usd: number): string {
  if (usd < 0.001)  return "< $0.001"
  if (usd < 0.01)   return `$${usd.toFixed(4)}`
  if (usd < 1)      return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
