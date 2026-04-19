/**
 * @module modelSelector
 * @path   src/core/router/modelSelector.ts
 *
 * Intelligent model routing with cost/quality optimisation.
 *
 * Routing logic (priority order):
 *   1. Hard plan allowlist — free users can ONLY use economy models
 *   2. Credit-pressure downgrade — auto-downgrade if balance is tight
 *   3. Task complexity routing — simple queries don't need premium models
 *   4. Token budget routing — large contexts need models with big windows
 *   5. Provider availability — skip if env key not set
 *
 * Why this matters as a founder:
 *   A free user running a simple Q&A on claude-opus-4-6 (premium)
 *   costs us ~100× more than running it on claude-haiku (economy).
 *   This router prevents margin destruction without degrading UX for
 *   tasks where the quality difference is negligible.
 */

import { PLAN_LIMITS, type PlanName } from "@/lib/anti-abuse"
import { MODEL_COST_TABLE } from "@/core/execution/costEstimator"

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskComplexity = "low" | "medium" | "high"

export interface ModelSelectionInput {
  /** Model the agent creator configured */
  requestedModel:  string
  /** User's subscription plan */
  plan:            PlanName
  /** Estimated input token count */
  estimatedTokens: number
  /** User's current credit balance */
  creditBalance:   number
  /** Inferred task complexity */
  taskComplexity:  TaskComplexity
  /** Prefer streaming-capable model */
  requiresStreaming?: boolean
}

export interface ModelSelectionResult {
  /** Final resolved model to use */
  model:          string
  /** Whether the model was changed from what was requested */
  wasDowngraded:  boolean
  /** Whether the model was upgraded (e.g. for large context) */
  wasUpgraded:    boolean
  /** Why the model was changed */
  reason:         string | null
  /** Estimated cost multiplier vs requested model (< 1 = cheaper) */
  costMultiplier: number
}

// ─── Model tiers ─────────────────────────────────────────────────────────────

const ECONOMY_MODELS   = ["claude-haiku-4-5-20251001", "gpt-4o-mini", "gemini-1.5-flash"] as const
const STANDARD_MODELS  = ["claude-sonnet-4-6", "claude-sonnet-4-20250514", "gpt-4o", "gemini-1.5-pro"] as const
const PREMIUM_MODELS   = ["claude-opus-4-6"] as const

/** Best economy fallback by provider prefix */
const ECONOMY_FALLBACK: Record<string, string> = {
  "claude-":  "claude-haiku-4-5-20251001",
  "gpt-":     "gpt-4o-mini",
  "gemini-":  "gemini-1.5-flash",
  "default":  "claude-haiku-4-5-20251001",
}

function getEconomyFallback(model: string): string {
  for (const [prefix, fallback] of Object.entries(ECONOMY_FALLBACK)) {
    if (prefix !== "default" && model.startsWith(prefix)) return fallback
  }
  return ECONOMY_FALLBACK["default"]!
}

function getModelTier(model: string): "economy" | "standard" | "premium" {
  if ((ECONOMY_MODELS  as readonly string[]).includes(model)) return "economy"
  if ((STANDARD_MODELS as readonly string[]).includes(model)) return "standard"
  if ((PREMIUM_MODELS  as readonly string[]).includes(model)) return "premium"
  return "standard"
}

function getCostMultiplier(from: string, to: string): number {
  const fromRates = MODEL_COST_TABLE[from]   ?? MODEL_COST_TABLE["_default"]!
  const toRates   = MODEL_COST_TABLE[to]     ?? MODEL_COST_TABLE["_default"]!
  const fromCost  = fromRates.input  + fromRates.output
  const toCost    = toRates.input    + toRates.output
  if (fromCost === 0) return 1
  return parseFloat((toCost / fromCost).toFixed(4))
}

// ─── Main selector ────────────────────────────────────────────────────────────

/**
 * selectModel
 *
 * @example
 * const { model, wasDowngraded, reason } = selectModel({
 *   requestedModel: agent.model_name,
 *   plan: "free",
 *   estimatedTokens: 1200,
 *   creditBalance: 0.05,
 *   taskComplexity: "low",
 * })
 * // model = "claude-haiku-4-5-20251001" (downgraded from sonnet for free tier)
 */
export function selectModel(input: ModelSelectionInput): ModelSelectionResult {
  const { requestedModel, plan, estimatedTokens, creditBalance, taskComplexity } = input

  const planLimits     = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  const allowedModels  = planLimits.allowed_models as readonly string[]
  const requestedTier  = getModelTier(requestedModel)
  const contextWindow  = MODEL_COST_TABLE[requestedModel]?.contextWindow ?? 128_000

  // ── RULE 1: Plan allowlist (hard gate) ───────────────────────────────────
  if (!allowedModels.includes(requestedModel)) {
    const bestAllowed = [...allowedModels].reverse()[0] ?? getEconomyFallback(requestedModel)
    return {
      model:          bestAllowed,
      wasDowngraded:  true,
      wasUpgraded:    false,
      reason:         `Your ${plan} plan does not include ${requestedModel}. Using ${bestAllowed} instead.`,
      costMultiplier: getCostMultiplier(requestedModel, bestAllowed),
    }
  }

  // ── RULE 2: Credit pressure (prevent execution failure due to balance) ───
  // If balance is tight (< 2× worst-case cost), downgrade to economy
  const estimatedWorstCostUsd = (estimatedTokens / 1000) *
    (MODEL_COST_TABLE[requestedModel]?.input ?? 0.003) * 3  // rough 3× margin
  const balanceBuffer = creditBalance / Math.max(estimatedWorstCostUsd, 0.001)

  if (
    balanceBuffer < 2 &&
    requestedTier !== "economy" &&
    allowedModels.includes(getEconomyFallback(requestedModel))
  ) {
    const fallback = getEconomyFallback(requestedModel)
    return {
      model:          fallback,
      wasDowngraded:  true,
      wasUpgraded:    false,
      reason:         `Low credit balance — using economy model to ensure execution completes.`,
      costMultiplier: getCostMultiplier(requestedModel, fallback),
    }
  }

  // ── RULE 3: Task complexity routing ─────────────────────────────────────
  // Simple tasks on premium models: downgrade to standard or economy
  if (
    taskComplexity === "low" &&
    requestedTier === "premium"
  ) {
    const standardCandidate = STANDARD_MODELS.find(m => allowedModels.includes(m) && m.startsWith(requestedModel.split("-")[0] ?? ""))
      ?? STANDARD_MODELS.find(m => allowedModels.includes(m))

    if (standardCandidate) {
      return {
        model:          standardCandidate,
        wasDowngraded:  true,
        wasUpgraded:    false,
        reason:         `Task complexity is low — using standard model for cost efficiency.`,
        costMultiplier: getCostMultiplier(requestedModel, standardCandidate),
      }
    }
  }

  // For very simple tasks (low complexity, small input), use economy if allowed
  if (
    taskComplexity === "low" &&
    estimatedTokens < 500 &&
    requestedTier !== "economy" &&
    allowedModels.includes(getEconomyFallback(requestedModel))
  ) {
    const fallback = getEconomyFallback(requestedModel)
    return {
      model:          fallback,
      wasDowngraded:  true,
      wasUpgraded:    false,
      reason:         `Small, simple task — economy model is sufficient.`,
      costMultiplier: getCostMultiplier(requestedModel, fallback),
    }
  }

  // ── RULE 4: Context window check ─────────────────────────────────────────
  // If estimated tokens exceed context window, need a larger context model
  if (estimatedTokens > contextWindow * 0.8) {
    // Find model with larger context window in allowed list
    const largerContextModel = allowedModels.find(m => {
      const info = MODEL_COST_TABLE[m]
      return info && info.contextWindow > contextWindow
    })

    if (largerContextModel) {
      return {
        model:          largerContextModel,
        wasDowngraded:  false,
        wasUpgraded:    true,
        reason:         `Input exceeds context window — using model with larger context.`,
        costMultiplier: getCostMultiplier(requestedModel, largerContextModel),
      }
    }
    // If no larger model available, truncation will handle it in context-compression
  }

  // ── No routing needed — use requested model ──────────────────────────────
  return {
    model:          requestedModel,
    wasDowngraded:  false,
    wasUpgraded:    false,
    reason:         null,
    costMultiplier: 1,
  }
}

/**
 * getCheapestModelForPlan
 * Returns the cheapest model available for a given plan.
 * Used for cost estimation lower bounds.
 */
export function getCheapestModelForPlan(plan: PlanName): string {
  const limits  = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  const allowed = limits.allowed_models as readonly string[]

  return [...allowed].sort((a, b) => {
    const aCost = (MODEL_COST_TABLE[a]?.input ?? 999) + (MODEL_COST_TABLE[a]?.output ?? 999)
    const bCost = (MODEL_COST_TABLE[b]?.input ?? 999) + (MODEL_COST_TABLE[b]?.output ?? 999)
    return aCost - bCost
  })[0] ?? "claude-haiku-4-5-20251001"
}

/**
 * getModelInfo
 * Returns display info for a model — used in marketplace agent cards.
 */
export function getModelInfo(model: string) {
  const rates = MODEL_COST_TABLE[model]
  if (!rates) return null
  return {
    model,
    tier:          rates.tier,
    contextWindow: rates.contextWindow,
    costPer1kInput:  rates.input,
    costPer1kOutput: rates.output,
    estimatedCostPer100calls: ((rates.input * 0.5 + rates.output * 0.5) * 100).toFixed(4),
  }
}
