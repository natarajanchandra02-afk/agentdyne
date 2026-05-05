/**
 * AgentDyne Model Router — Production Cognitive Depth Router
 *
 * Responsibilities:
 *   1. Complexity assessment    → classify prompt complexity
 *   2. Model selection          → choose cheapest model that can handle it
 *   3. Fallback chain           → ordered escalation on failure/timeout
 *   4. Observability            → structured reasoning for DB storage
 *   5. Edge runtime compatible  → no Node.js APIs, pure TypeScript
 *
 * All decisions are deterministic and logged via the returned `routing` object.
 * Store routing.reason in executions.model_routing_reason and
 * routing.depthAssessment in execution_traces.depth_assessment.
 *
 * Updated to April 2026 model names (from constants.ts).
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Canonical model identifiers — must match agents.model_name in DB */
export const MODELS = {
  HAIKU:  "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-4-6",
  OPUS:   "claude-opus-4-6",
  // OpenAI fallback (future — enabled when OPENAI_API_KEY is set)
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4O:      "gpt-4o",
} as const
export type ModelId = typeof MODELS[keyof typeof MODELS]

/** Cost per 1k tokens (USD) — April 2026 pricing */
const MODEL_COST: Record<ModelId, { inputPer1k: number; outputPer1k: number }> = {
  [MODELS.HAIKU]:    { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  [MODELS.SONNET]:   { inputPer1k: 0.003,   outputPer1k: 0.015   },
  [MODELS.OPUS]:     { inputPer1k: 0.015,   outputPer1k: 0.075   },
  [MODELS.GPT_4O_MINI]: { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  [MODELS.GPT_4O]:      { inputPer1k: 0.005,   outputPer1k: 0.015  },
}

/** Complexity thresholds — tune without changing business logic */
const THRESHOLDS = {
  /** Prompts shorter than this are "short" signals */
  SHORT_PROMPT_CHARS:   500,
  /** Prompts longer than this trigger "complex" routing */
  LONG_PROMPT_CHARS:   2000,
  /** Context token counts that bump complexity */
  MEDIUM_CONTEXT_TOKENS: 2_000,
  COMPLEX_CONTEXT_TOKENS: 8_000,
  /** Tool counts */
  MEDIUM_TOOL_COUNT:     1,
  COMPLEX_TOOL_COUNT:    3,
  /** Budget levels (USD per run) */
  BUDGET_DOWNGRADE_USD:  0.005,  // below this, force Haiku regardless
  BUDGET_SONNET_MIN_USD: 0.02,   // below this, avoid Opus
} as const

/** Plan → model ceiling (free plan always gets Haiku) */
const PLAN_MODEL_CEILING: Record<string, ModelId> = {
  free:       MODELS.HAIKU,
  starter:    MODELS.SONNET,
  pro:        MODELS.OPUS,
  enterprise: MODELS.OPUS,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Complexity = "simple" | "medium" | "complex" | "expert"

export interface ComplexityInput {
  prompt:             string
  toolCount:          number
  contextTokens:      number
  requiresReasoning?: boolean
  isMultiStep?:       boolean   // pipeline context
}

export interface ModelChoice {
  model:          ModelId
  estimatedCostUsd: number
  downgradeReason?: string
}

export interface RoutingResult {
  selectedModel:     ModelId
  fallbackChain:     ModelId[]
  estimatedCostUsd:  number
  costSavedVsSonnet: number       // % saved vs always-Sonnet baseline
  routing: {
    complexity:      Complexity
    reason:          string
    costStrategy:    string
    downgradeReason?: string
    planCeiling:     ModelId
  }
  /** Store this object in execution_traces.depth_assessment */
  depthAssessment: {
    promptChars:   number
    contextTokens: number
    toolCount:     number
    complexity:    Complexity
    selectedModel: ModelId
    estimatedCost: number
    timestamp:     string
  }
}

// ─── 1. Complexity Assessment ─────────────────────────────────────────────────

/**
 * assessComplexity
 *
 * Pure function: maps observable prompt signals to a complexity tier.
 * No LLM calls. O(1) — runs in microseconds.
 *
 *   simple  → Haiku handles it perfectly (short, no tools, no reasoning)
 *   medium  → Sonnet needed (some reasoning OR 1–2 tools)
 *   complex → Sonnet needed (long prompt OR multiple tools OR RAG context)
 *   expert  → Opus needed (>8k tokens OR multi-step pipelines OR explicit flag)
 */
export function assessComplexity(input: ComplexityInput): Complexity {
  const { prompt, toolCount, contextTokens, requiresReasoning, isMultiStep } = input
  const promptChars = prompt.length

  // Expert: Opus territory
  if (
    isMultiStep ||
    contextTokens >= THRESHOLDS.COMPLEX_CONTEXT_TOKENS ||
    (requiresReasoning && toolCount >= THRESHOLDS.COMPLEX_TOOL_COUNT)
  ) return "expert"

  // Complex: Sonnet needed but Opus not required
  if (
    promptChars > THRESHOLDS.LONG_PROMPT_CHARS ||
    toolCount >= THRESHOLDS.COMPLEX_TOOL_COUNT ||
    contextTokens >= THRESHOLDS.MEDIUM_CONTEXT_TOKENS
  ) return "complex"

  // Medium: Sonnet preferred
  if (
    requiresReasoning ||
    toolCount >= THRESHOLDS.MEDIUM_TOOL_COUNT ||
    promptChars > THRESHOLDS.SHORT_PROMPT_CHARS
  ) return "medium"

  // Simple: Haiku is sufficient
  return "simple"
}

// ─── 2. Estimate cost ─────────────────────────────────────────────────────────

/**
 * estimateCost
 *
 * Rough cost estimate for one execution with the given model.
 * Uses conservative assumptions: 500 input tokens + (maxTokens * 0.7) output.
 * Accurate to within 2–3× for typical agents.
 */
export function estimateCost(
  model:     ModelId,
  inputTokens:  number,
  outputTokens: number,
): number {
  const { inputPer1k, outputPer1k } = MODEL_COST[model] ?? MODEL_COST[MODELS.SONNET]
  return (inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k
}

// ─── 3. Model Selection ───────────────────────────────────────────────────────

/**
 * selectModel
 *
 * Returns the cheapest model that can handle the given complexity,
 * subject to plan ceiling and budget constraints.
 *
 * Decision order:
 *   1. Plan ceiling (free → always Haiku)
 *   2. Budget check (very low budget → force Haiku)
 *   3. Complexity mapping
 *   4. Budget cap (can't afford Opus → use Sonnet)
 */
export function selectModel(config: {
  complexity:      Complexity
  plan:            string
  budgetRemaining: number
  maxCostPerRun?:  number
  preferredModel?: ModelId   // override from agent config
}): ModelChoice {
  const { complexity, plan, budgetRemaining, maxCostPerRun, preferredModel } = config

  const planCeiling = PLAN_MODEL_CEILING[plan] ?? MODELS.HAIKU
  const inputTokens  = 500
  const outputTokens = 2048

  // Complexity → ideal model
  const complexityIdeal: Record<Complexity, ModelId> = {
    simple:  MODELS.HAIKU,
    medium:  MODELS.SONNET,
    complex: MODELS.SONNET,
    expert:  MODELS.OPUS,
  }
  let model = complexityIdeal[complexity]

  // Apply plan ceiling (never exceed what the plan allows)
  const modelTier = (m: ModelId) =>
    m === MODELS.HAIKU ? 0 : m === MODELS.SONNET ? 1 : 2
  if (modelTier(model) > modelTier(planCeiling)) {
    model = planCeiling
  }

  // Apply agent's preferred model if it fits within constraints
  if (preferredModel && modelTier(preferredModel) <= modelTier(planCeiling)) {
    model = preferredModel
  }

  // Budget check: if remaining budget is very low, force Haiku
  let downgradeReason: string | undefined
  if (budgetRemaining < THRESHOLDS.BUDGET_DOWNGRADE_USD) {
    if (model !== MODELS.HAIKU) {
      downgradeReason = `Budget too low ($${budgetRemaining.toFixed(4)} remaining) — downgraded to Haiku`
      model = MODELS.HAIKU
    }
  } else if (budgetRemaining < THRESHOLDS.BUDGET_SONNET_MIN_USD && model === MODELS.OPUS) {
    downgradeReason = `Budget insufficient for Opus ($${budgetRemaining.toFixed(4)}) — using Sonnet`
    model = MODELS.SONNET
  }

  // Max cost per run cap
  if (maxCostPerRun !== undefined) {
    const opusCost   = estimateCost(MODELS.OPUS,   inputTokens, outputTokens)
    const sonnetCost = estimateCost(MODELS.SONNET, inputTokens, outputTokens)
    if (model === MODELS.OPUS && opusCost > maxCostPerRun) {
      model = MODELS.SONNET
      if (!downgradeReason) downgradeReason = `Opus cost ~$${opusCost.toFixed(4)} exceeds maxCostPerRun $${maxCostPerRun}`
    }
    if (model === MODELS.SONNET && sonnetCost > maxCostPerRun) {
      model = MODELS.HAIKU
      if (!downgradeReason) downgradeReason = `Sonnet cost ~$${sonnetCost.toFixed(4)} exceeds maxCostPerRun $${maxCostPerRun}`
    }
  }

  return {
    model,
    estimatedCostUsd: estimateCost(model, inputTokens, outputTokens),
    downgradeReason,
  }
}

// ─── 4. Fallback chain ────────────────────────────────────────────────────────

/**
 * getFallbackChain
 *
 * Returns the ordered list of fallback models to try after the primary fails.
 * Fallback always escalates — never degrades — to maintain output quality.
 *
 *   Haiku  → [Sonnet, Opus]
 *   Sonnet → [Opus]
 *   Opus   → []  (no fallback — already at ceiling)
 */
export function getFallbackChain(primaryModel: ModelId): ModelId[] {
  switch (primaryModel) {
    case MODELS.HAIKU:       return [MODELS.SONNET, MODELS.OPUS]
    case MODELS.SONNET:      return [MODELS.OPUS]
    case MODELS.OPUS:        return []
    case MODELS.GPT_4O_MINI: return [MODELS.GPT_4O, MODELS.SONNET]
    case MODELS.GPT_4O:      return [MODELS.OPUS]
    default:                 return [MODELS.SONNET]
  }
}

// ─── 5. Main router function ──────────────────────────────────────────────────

/**
 * routeModel
 *
 * The single entry point for all model routing decisions.
 *
 * Call this at the start of every agent or pipeline node execution.
 * Never hardcode model names in execute routes — always go through this router.
 *
 * Returns:
 *   selectedModel     → pass to Anthropic/OpenAI API call
 *   fallbackChain     → try in order on failure/timeout
 *   estimatedCostUsd  → show to user before run (trust layer)
 *   costSavedVsSonnet → "Saved 83% using Haiku instead of Sonnet"
 *   routing           → store in executions.model_routing_reason
 *   depthAssessment   → store in execution_traces.depth_assessment
 */
export function routeModel(input: {
  prompt:            string
  toolCount:         number
  contextTokens:     number
  plan:              string
  budgetRemaining:   number
  maxCostPerRun?:    number
  previousFailures?: number
  requiresReasoning?: boolean
  isMultiStep?:      boolean
  preferredModel?:   string   // from agents.model_name
}): RoutingResult {
  const {
    prompt, toolCount, contextTokens, plan, budgetRemaining,
    maxCostPerRun, previousFailures = 0,
    requiresReasoning, isMultiStep, preferredModel,
  } = input

  // Step 1: Assess complexity
  const complexity = assessComplexity({
    prompt, toolCount, contextTokens, requiresReasoning, isMultiStep,
  })

  // Step 2: Previous failures → bump complexity by 1 tier (escalate)
  let adjustedComplexity = complexity
  if (previousFailures >= 2 && complexity !== "expert")  adjustedComplexity = "expert"
  else if (previousFailures === 1 && complexity === "simple") adjustedComplexity = "medium"

  // Step 3: Select model
  const planCeiling = PLAN_MODEL_CEILING[plan] ?? MODELS.HAIKU
  const { model, estimatedCostUsd, downgradeReason } = selectModel({
    complexity:      adjustedComplexity,
    plan,
    budgetRemaining,
    maxCostPerRun,
    preferredModel:  preferredModel as ModelId | undefined,
  })

  // Step 4: Build fallback chain (respect plan ceiling for fallbacks too)
  const rawChain = getFallbackChain(model)
  const modelTier = (m: ModelId) =>
    m === MODELS.HAIKU ? 0 : m === MODELS.SONNET ? 1 : 2
  const fallbackChain = rawChain.filter(
    m => modelTier(m) <= modelTier(planCeiling)
  ) as ModelId[]

  // Step 5: Calculate cost savings vs always-Sonnet baseline
  const sonnetCost      = estimateCost(MODELS.SONNET, 500, 2048)
  const costSavedPercent =
    sonnetCost > 0
      ? Math.max(0, Math.round(((sonnetCost - estimatedCostUsd) / sonnetCost) * 100))
      : 0

  // Step 6: Build routing reason string
  const reasonParts: string[] = [`Complexity: ${adjustedComplexity}`]
  if (adjustedComplexity !== complexity) reasonParts.push(`escalated from ${complexity} (${previousFailures} prior failures)`)
  if (downgradeReason) reasonParts.push(downgradeReason)
  if (preferredModel && preferredModel !== model) reasonParts.push(`agent preferred ${preferredModel} but was overridden`)
  if (plan === "free") reasonParts.push("free plan → Haiku only")

  const costStrategyMap: Record<Complexity, string> = {
    simple:  `Haiku selected — ${costSavedPercent}% cheaper than Sonnet for simple tasks`,
    medium:  "Sonnet selected — reasoning required",
    complex: "Sonnet selected — long context or multiple tools",
    expert:  "Opus selected — multi-step pipeline or expert reasoning required",
  }

  return {
    selectedModel:     model,
    fallbackChain,
    estimatedCostUsd,
    costSavedVsSonnet: costSavedPercent,
    routing: {
      complexity:      adjustedComplexity,
      reason:          reasonParts.join("; "),
      costStrategy:    costStrategyMap[adjustedComplexity],
      downgradeReason,
      planCeiling,
    },
    depthAssessment: {
      promptChars:   prompt.length,
      contextTokens,
      toolCount,
      complexity:    adjustedComplexity,
      selectedModel: model,
      estimatedCost: estimatedCostUsd,
      timestamp:     new Date().toISOString(),
    },
  }
}

// ─── 6. Confidence-based escalation hook ─────────────────────────────────────

/**
 * shouldEscalateOnConfidence
 *
 * Call after an agent returns output with a confidence score.
 * Returns true if the model should be escalated and the step retried.
 *
 * Example usage in execute route:
 *   const output = await callLLM(selectedModel, ...)
 *   const confidence = extractConfidence(output)
 *   if (shouldEscalateOnConfidence(confidence, selectedModel, budgetRemaining)) {
 *     const fallback = getFallbackChain(selectedModel)[0]
 *     output = await callLLM(fallback, ...)
 *   }
 */
export function shouldEscalateOnConfidence(
  confidence:    number | undefined,
  currentModel:  ModelId,
  budgetRemaining: number,
  threshold = 0.6,
): boolean {
  if (confidence === undefined) return false          // no signal → trust output
  if (confidence >= threshold)  return false          // confident → accept
  if (currentModel === MODELS.OPUS) return false      // already at ceiling
  if (budgetRemaining < THRESHOLDS.BUDGET_SONNET_MIN_USD) return false  // can't afford upgrade
  return true
}

// ─── 7. Legacy compatibility wrapper ─────────────────────────────────────────

/**
 * routeCompletion
 *
 * Drop-in replacement for the old model-router.ts routeCompletion function.
 * Existing execute routes call this with a model name + prompt + options.
 *
 * This function does NOT make a network call — it calls the provider client.
 * The actual HTTP call to Anthropic/OpenAI happens inside here.
 *
 * Returns { text, inputTokens, outputTokens, costUsd, routingMetadata }.
 */
export async function routeCompletion(params: {
  model:       string
  system:      string
  userMessage: string
  maxTokens?:  number
  temperature?: number
  tools?:      any[]
  stream?:     boolean
}): Promise<{
  text:          string
  inputTokens:   number
  outputTokens:  number
  costUsd:       number
  routingMetadata?: { selectedModel: string; estimatedCostUsd: number }
}> {
  const {
    model: requestedModel, system, userMessage,
    maxTokens = 4096, temperature = 0.7, tools, stream = false,
  } = params

  // Validate model — fall back to Sonnet if unknown
  const validModels = Object.values(MODELS) as string[]
  const model = validModels.includes(requestedModel) ? requestedModel : MODELS.SONNET

  const isAnthropic = model.startsWith("claude-")
  const isOpenAI    = model.startsWith("gpt-")

  if (isAnthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")

    const body: Record<string, unknown> = {
      model,
      max_tokens: Math.min(maxTokens, 8192),
      temperature,
      messages: [{ role: "user", content: userMessage }],
      system,
    }
    if (tools && tools.length > 0) body.tools = tools

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
    }

    const data  = await res.json() as any
    const block = data.content?.[0]
    const text  = block?.type === "text" ? (block.text as string) : ""
    const inp   = data.usage?.input_tokens  ?? 0
    const out   = data.usage?.output_tokens ?? 0
    const cost  = estimateCost(model as ModelId, inp, out)

    return { text, inputTokens: inp, outputTokens: out, costUsd: cost }
  }

  if (isOpenAI) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY not set")

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user",   content: userMessage },
        ],
        ...(tools && tools.length > 0 ? { tools } : {}),
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      throw new Error(`OpenAI API error ${res.status}: ${errBody.slice(0, 200)}`)
    }

    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content as string ?? ""
    const inp  = data.usage?.prompt_tokens     ?? 0
    const out  = data.usage?.completion_tokens ?? 0
    const cost = estimateCost(model as ModelId, inp, out)

    return { text, inputTokens: inp, outputTokens: out, costUsd: cost }
  }

  throw new Error(`Unknown model provider for model: ${model}`)
}
