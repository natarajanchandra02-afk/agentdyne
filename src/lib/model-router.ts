/**
 * AgentDyne Model Router — May 2026
 * Cognitive Depth Router with Gemini 2.5 Flash/Pro (P3: third cost tier)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MODELS = {
  // Anthropic
  HAIKU:        "claude-haiku-4-5-20251001",
  SONNET:       "claude-sonnet-4-6",
  OPUS:         "claude-opus-4-6",
  // OpenAI
  GPT_4O_MINI:  "gpt-4o-mini",
  GPT_4O:       "gpt-4o",
  // Google Gemini — May 2026 (P3: third cost tier below Haiku)
  GEMINI_FLASH: "gemini-2.5-flash",
  GEMINI_PRO:   "gemini-2.5-pro",
} as const
export type ModelId = typeof MODELS[keyof typeof MODELS]

/** Cost per 1k tokens (USD) — May 2026 */
const MODEL_COST: Record<ModelId, { inputPer1k: number; outputPer1k: number }> = {
  [MODELS.HAIKU]:        { inputPer1k: 0.00025,  outputPer1k: 0.00125  },
  [MODELS.SONNET]:       { inputPer1k: 0.003,    outputPer1k: 0.015    },
  [MODELS.OPUS]:         { inputPer1k: 0.015,    outputPer1k: 0.075    },
  [MODELS.GPT_4O_MINI]:  { inputPer1k: 0.00015,  outputPer1k: 0.0006   },
  [MODELS.GPT_4O]:       { inputPer1k: 0.005,    outputPer1k: 0.015    },
  [MODELS.GEMINI_FLASH]: { inputPer1k: 0.000175, outputPer1k: 0.0007   },
  [MODELS.GEMINI_PRO]:   { inputPer1k: 0.0035,   outputPer1k: 0.014    },
}

const THRESHOLDS = {
  SHORT_PROMPT_CHARS:      500,
  LONG_PROMPT_CHARS:      2000,
  MEDIUM_CONTEXT_TOKENS:  2_000,
  COMPLEX_CONTEXT_TOKENS: 8_000,
  MEDIUM_TOOL_COUNT:      1,
  COMPLEX_TOOL_COUNT:     3,
  BUDGET_DOWNGRADE_USD:   0.005,
  BUDGET_SONNET_MIN_USD:  0.02,
} as const

const PLAN_MODEL_CEILING: Record<string, ModelId> = {
  free:       MODELS.HAIKU,
  starter:    MODELS.SONNET,
  pro:        MODELS.OPUS,
  enterprise: MODELS.OPUS,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type Complexity = "simple" | "medium" | "complex" | "expert"

export interface ComplexityInput {
  prompt: string; toolCount: number; contextTokens: number
  requiresReasoning?: boolean; isMultiStep?: boolean
}

export interface ModelChoice {
  model: ModelId; estimatedCostUsd: number; downgradeReason?: string
}

export interface RoutingResult {
  selectedModel: ModelId; fallbackChain: ModelId[]
  estimatedCostUsd: number; costSavedVsSonnet: number
  routing: { complexity: Complexity; reason: string; costStrategy: string; downgradeReason?: string; planCeiling: ModelId }
  depthAssessment: { promptChars: number; contextTokens: number; toolCount: number; complexity: Complexity; selectedModel: ModelId; estimatedCost: number; timestamp: string }
}

// ─── Complexity Assessment ────────────────────────────────────────────────────

export function assessComplexity(input: ComplexityInput): Complexity {
  const { prompt, toolCount, contextTokens, requiresReasoning, isMultiStep } = input
  const promptChars = prompt.length
  if (isMultiStep || contextTokens >= THRESHOLDS.COMPLEX_CONTEXT_TOKENS ||
      (requiresReasoning && toolCount >= THRESHOLDS.COMPLEX_TOOL_COUNT)) return "expert"
  if (promptChars > THRESHOLDS.LONG_PROMPT_CHARS || toolCount >= THRESHOLDS.COMPLEX_TOOL_COUNT ||
      contextTokens >= THRESHOLDS.MEDIUM_CONTEXT_TOKENS) return "complex"
  if (requiresReasoning || toolCount >= THRESHOLDS.MEDIUM_TOOL_COUNT ||
      promptChars > THRESHOLDS.SHORT_PROMPT_CHARS) return "medium"
  return "simple"
}

export function estimateCost(model: ModelId, inputTokens: number, outputTokens: number): number {
  const { inputPer1k, outputPer1k } = MODEL_COST[model] ?? MODEL_COST[MODELS.SONNET]
  return (inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k
}

export function selectModel(config: {
  complexity: Complexity; plan: string; budgetRemaining: number
  maxCostPerRun?: number; preferredModel?: ModelId
}): ModelChoice {
  const { complexity, plan, budgetRemaining, maxCostPerRun, preferredModel } = config
  const planCeiling = PLAN_MODEL_CEILING[plan] ?? MODELS.HAIKU
  const inp = 500, out = 2048

  const complexityIdeal: Record<Complexity, ModelId> = {
    simple: MODELS.HAIKU, medium: MODELS.SONNET,
    complex: MODELS.SONNET, expert: MODELS.OPUS,
  }
  let model = complexityIdeal[complexity]

  const modelTier = (m: ModelId) => {
    if (m === MODELS.GEMINI_FLASH) return -1  // cheapest tier
    if (m === MODELS.HAIKU || m === MODELS.GPT_4O_MINI) return 0
    if (m === MODELS.SONNET || m === MODELS.GPT_4O || m === MODELS.GEMINI_PRO) return 1
    return 2
  }
  if (modelTier(model) > modelTier(planCeiling)) model = planCeiling
  if (preferredModel && modelTier(preferredModel) <= modelTier(planCeiling)) model = preferredModel

  let downgradeReason: string | undefined
  if (budgetRemaining < THRESHOLDS.BUDGET_DOWNGRADE_USD) {
    if (model !== MODELS.HAIKU && model !== MODELS.GEMINI_FLASH) {
      downgradeReason = `Budget too low ($${budgetRemaining.toFixed(4)}) — downgraded to Haiku`
      model = MODELS.HAIKU
    }
  } else if (budgetRemaining < THRESHOLDS.BUDGET_SONNET_MIN_USD && model === MODELS.OPUS) {
    downgradeReason = `Budget insufficient for Opus — using Sonnet`
    model = MODELS.SONNET
  }

  if (maxCostPerRun !== undefined) {
    const opusCost = estimateCost(MODELS.OPUS, inp, out)
    const sonnetCost = estimateCost(MODELS.SONNET, inp, out)
    if (model === MODELS.OPUS && opusCost > maxCostPerRun) {
      model = MODELS.SONNET; if (!downgradeReason) downgradeReason = `Opus exceeds maxCostPerRun`
    }
    if (model === MODELS.SONNET && sonnetCost > maxCostPerRun) {
      model = MODELS.HAIKU; if (!downgradeReason) downgradeReason = `Sonnet exceeds maxCostPerRun`
    }
  }

  return { model, estimatedCostUsd: estimateCost(model, inp, out), downgradeReason }
}

export function getFallbackChain(primaryModel: ModelId): ModelId[] {
  switch (primaryModel) {
    case MODELS.GEMINI_FLASH: return [MODELS.HAIKU, MODELS.SONNET]
    case MODELS.HAIKU:        return [MODELS.SONNET, MODELS.OPUS]
    case MODELS.SONNET:       return [MODELS.OPUS]
    case MODELS.OPUS:         return []
    case MODELS.GPT_4O_MINI:  return [MODELS.GPT_4O, MODELS.SONNET]
    case MODELS.GPT_4O:       return [MODELS.OPUS]
    case MODELS.GEMINI_PRO:   return [MODELS.OPUS]
    default:                  return [MODELS.SONNET]
  }
}

export function routeModel(input: {
  prompt: string; toolCount: number; contextTokens: number; plan: string
  budgetRemaining: number; maxCostPerRun?: number; previousFailures?: number
  requiresReasoning?: boolean; isMultiStep?: boolean; preferredModel?: string
}): RoutingResult {
  const { prompt, toolCount, contextTokens, plan, budgetRemaining,
    maxCostPerRun, previousFailures = 0, requiresReasoning, isMultiStep, preferredModel } = input

  const complexity = assessComplexity({ prompt, toolCount, contextTokens, requiresReasoning, isMultiStep })
  let adjustedComplexity = complexity
  if (previousFailures >= 2 && complexity !== "expert") adjustedComplexity = "expert"
  else if (previousFailures === 1 && complexity === "simple") adjustedComplexity = "medium"

  const planCeiling = PLAN_MODEL_CEILING[plan] ?? MODELS.HAIKU
  const { model, estimatedCostUsd, downgradeReason } = selectModel({
    complexity: adjustedComplexity, plan, budgetRemaining, maxCostPerRun,
    preferredModel: preferredModel as ModelId | undefined,
  })

  const modelTier = (m: ModelId) => {
    if (m === MODELS.GEMINI_FLASH) return -1
    if (m === MODELS.HAIKU || m === MODELS.GPT_4O_MINI) return 0
    if (m === MODELS.SONNET || m === MODELS.GPT_4O || m === MODELS.GEMINI_PRO) return 1
    return 2
  }
  const rawChain = getFallbackChain(model)
  const fallbackChain = rawChain.filter(m => modelTier(m) <= modelTier(planCeiling)) as ModelId[]

  const sonnetCost = estimateCost(MODELS.SONNET, 500, 2048)
  const costSavedPercent = sonnetCost > 0 ? Math.max(0, Math.round(((sonnetCost - estimatedCostUsd) / sonnetCost) * 100)) : 0

  const reasonParts: string[] = [`Complexity: ${adjustedComplexity}`]
  if (adjustedComplexity !== complexity) reasonParts.push(`escalated from ${complexity} (${previousFailures} prior failures)`)
  if (downgradeReason) reasonParts.push(downgradeReason)
  if (plan === "free") reasonParts.push("free plan → Haiku only")

  const costStrategyMap: Record<Complexity, string> = {
    simple: `Haiku/Gemini Flash selected — ${costSavedPercent}% cheaper`,
    medium: "Sonnet selected — reasoning required",
    complex: "Sonnet selected — long context or multiple tools",
    expert: "Opus selected — multi-step pipeline or expert reasoning",
  }

  return {
    selectedModel: model, fallbackChain, estimatedCostUsd, costSavedVsSonnet: costSavedPercent,
    routing: { complexity: adjustedComplexity, reason: reasonParts.join("; "),
      costStrategy: costStrategyMap[adjustedComplexity], downgradeReason, planCeiling },
    depthAssessment: { promptChars: prompt.length, contextTokens, toolCount,
      complexity: adjustedComplexity, selectedModel: model, estimatedCost: estimatedCostUsd,
      timestamp: new Date().toISOString() },
  }
}

export function shouldEscalateOnConfidence(confidence: number | undefined, currentModel: ModelId, budgetRemaining: number, threshold = 0.6): boolean {
  if (confidence === undefined) return false
  if (confidence >= threshold) return false
  if (currentModel === MODELS.OPUS) return false
  if (budgetRemaining < THRESHOLDS.BUDGET_SONNET_MIN_USD) return false
  return true
}

// ─── routeCompletion — Anthropic + OpenAI + Gemini ───────────────────────────

export async function routeCompletion(params: {
  model: string; system: string; userMessage: string
  maxTokens?: number; temperature?: number; tools?: any[]; stream?: boolean
}): Promise<{ text: string; inputTokens: number; outputTokens: number; costUsd: number; routingMetadata?: { selectedModel: string; estimatedCostUsd: number } }> {
  const { model: requestedModel, system, userMessage, maxTokens = 4096, temperature = 0.7, tools, stream = false } = params

  const validModels = Object.values(MODELS) as string[]
  const model = validModels.includes(requestedModel) ? requestedModel : MODELS.SONNET

  const isAnthropic = model.startsWith("claude-")
  const isOpenAI    = model.startsWith("gpt-")
  const isGemini    = model.startsWith("gemini-")

  // ── Anthropic ────────────────────────────────────────────────────────────
  if (isAnthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set")
    const body: Record<string, unknown> = {
      model, max_tokens: Math.min(maxTokens, 8192), temperature,
      messages: [{ role: "user", content: userMessage }], system,
    }
    if (tools?.length) body.tools = tools
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      throw new Error(`Anthropic API error ${res.status}: ${errBody.slice(0, 200)}`)
    }
    const data = await res.json() as any
    const block = data.content?.[0]
    const text = block?.type === "text" ? (block.text as string) : ""
    const inp  = data.usage?.input_tokens  ?? 0
    const out  = data.usage?.output_tokens ?? 0
    return { text, inputTokens: inp, outputTokens: out, costUsd: estimateCost(model as ModelId, inp, out) }
  }

  // ── OpenAI ───────────────────────────────────────────────────────────────
  if (isOpenAI) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY not set")
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature,
        messages: [{ role: "system", content: system }, { role: "user", content: userMessage }],
        ...(tools?.length ? { tools } : {}),
      }),
    })
    if (!res.ok) throw new Error(`OpenAI error ${res.status}`)
    const data = await res.json() as any
    const text = data.choices?.[0]?.message?.content as string ?? ""
    const inp  = data.usage?.prompt_tokens    ?? 0
    const out  = data.usage?.completion_tokens ?? 0
    return { text, inputTokens: inp, outputTokens: out, costUsd: estimateCost(model as ModelId, inp, out) }
  }

  // ── Google Gemini 2.5 Flash / Pro (P3) ──────────────────────────────────
  if (isGemini) {
    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) {
      // Graceful fallback to Haiku when Gemini key not configured
      console.warn("GOOGLE_AI_API_KEY not set — falling back to Haiku")
      return routeCompletion({ ...params, model: MODELS.HAIKU })
    }

    // Gemini generateContent endpoint
    const geminiModel = model === MODELS.GEMINI_FLASH ? "gemini-2.5-flash-preview-05-20" : "gemini-2.5-pro-preview-05-06"
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`

    // Build Gemini function declarations from OpenAI-style tools
    const geminiTools = tools?.length ? [{
      functionDeclarations: tools.map(t => ({
        name: t.function?.name ?? t.name,
        description: t.function?.description ?? t.description ?? "",
        parameters: t.function?.parameters ?? t.parameters ?? {},
      })),
    }] : undefined

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: Math.min(maxTokens, 8192), temperature },
        ...(geminiTools ? { tools: geminiTools } : {}),
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => "")
      // Graceful fallback to Haiku on Gemini error
      console.warn(`Gemini error ${res.status}: ${errBody.slice(0, 100)} — falling back to Haiku`)
      return routeCompletion({ ...params, model: MODELS.HAIKU })
    }

    const data = await res.json() as any
    const candidate = data.candidates?.[0]
    let text = ""

    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) text += part.text
    }

    // Gemini token usage
    const inp = data.usageMetadata?.promptTokenCount    ?? 0
    const out = data.usageMetadata?.candidatesTokenCount ?? 0

    return { text, inputTokens: inp, outputTokens: out, costUsd: estimateCost(model as ModelId, inp, out) }
  }

  throw new Error(`Unknown model provider for model: ${model}`)
}
