/**
 * @module budgetValidator
 * @path   src/core/execution/budgetValidator.ts
 *
 * Pre-execution credit and plan budget validation.
 * Returns a typed result — never throws.
 *
 * Called by the execute route AFTER cost estimation,
 * BEFORE creating the execution record or calling the AI.
 *
 * Validation chain (fail-fast, cheapest first):
 *   1. Is user banned?
 *   2. Does the user have a credits row?
 *   3. Is credit balance sufficient for the worst-case cost?
 *   4. Does this execution exceed the plan's per-execution spending ceiling?
 *   5. Has the user hit their monthly execution quota?
 *   6. Is the requested model allowed on this plan?
 */

import { MODEL_COST_TABLE, PLATFORM_MARGIN } from "./costEstimator"
import { PLAN_LIMITS, type PlanName } from "@/lib/anti-abuse"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationCode =
  | "OK"
  | "USER_BANNED"
  | "NO_CREDITS_ROW"
  | "INSUFFICIENT_CREDITS"
  | "COST_CEILING_EXCEEDED"
  | "QUOTA_EXCEEDED"
  | "MODEL_NOT_ALLOWED"
  | "AGENT_REQUIRES_SUBSCRIPTION"

export interface ValidationResult {
  ok:            boolean
  code:          ValidationCode
  message:       string
  httpStatus:    number
  /** credit balance after the charge (if ok) */
  balanceAfter?: number
  /** how many executions remaining in the month (if ok) */
  quotaRemaining?: number
  /** downgraded model to use instead (if model not allowed) */
  fallbackModel?: string
}

export interface BudgetValidationInput {
  /** User profile from DB */
  profile: {
    is_banned:                  boolean
    subscription_plan:          string | null
    monthly_execution_quota:    number | null
    executions_used_this_month: number | null
  }
  /** Credits row from DB */
  credits: {
    balance_usd: number
  } | null
  /** Cost estimate from costEstimator */
  worstCaseCostUsd: number
  /** Agent's requested model */
  requestedModel:   string
  /** Whether agent requires a subscription (pricing_model === "subscription") */
  requiresSubscription?: boolean
  hasActiveSubscription?: boolean
  /** Free calls remaining for freemium agents */
  freeCallsRemaining?: number
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * validateBudget
 *
 * @example
 * const result = validateBudget({ profile, credits, worstCaseCostUsd, requestedModel })
 * if (!result.ok) {
 *   return NextResponse.json({ error: result.message, code: result.code }, { status: result.httpStatus })
 * }
 */
export function validateBudget(input: BudgetValidationInput): ValidationResult {
  const {
    profile,
    credits,
    worstCaseCostUsd,
    requestedModel,
    requiresSubscription  = false,
    hasActiveSubscription = false,
    freeCallsRemaining    = 0,
  } = input

  // 1. Banned check
  if (profile.is_banned) {
    return {
      ok: false, code: "USER_BANNED", httpStatus: 403,
      message: "Your account has been suspended. Contact support at support@agentdyne.com.",
    }
  }

  // 2. Credits row must exist
  if (!credits) {
    return {
      ok: false, code: "NO_CREDITS_ROW", httpStatus: 402,
      message: "Your account has no credits. Add credits to start executing agents.",
    }
  }

  const plan   = (profile.subscription_plan ?? "free") as PlanName
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  // 3. Per-execution cost ceiling (hard plan limit)
  if (worstCaseCostUsd > limits.max_cost_per_exec_usd) {
    return {
      ok: false, code: "COST_CEILING_EXCEEDED", httpStatus: 402,
      message: `This execution's estimated cost ($${worstCaseCostUsd.toFixed(4)}) exceeds your plan's per-execution limit of $${limits.max_cost_per_exec_usd}. Upgrade to run more expensive agents.`,
    }
  }

  // 4. Credit balance check (use worst-case to be safe)
  const balance = Number(credits.balance_usd ?? 0)
  if (balance < worstCaseCostUsd) {
    return {
      ok: false, code: "INSUFFICIENT_CREDITS", httpStatus: 402,
      message: `Insufficient credits. You have $${balance.toFixed(4)} but this execution needs up to $${worstCaseCostUsd.toFixed(4)}. Add credits to continue.`,
    }
  }

  // 5. Monthly quota check
  const quota = profile.monthly_execution_quota ?? 100
  const used  = profile.executions_used_this_month ?? 0

  if (quota !== -1 && used >= quota) {
    return {
      ok: false, code: "QUOTA_EXCEEDED", httpStatus: 429,
      message: `Monthly execution quota exhausted (${used}/${quota}). Quota resets on the 1st or upgrade your plan for more executions.`,
    }
  }

  // 6. Model allowlist check
  const allowedModels = limits.allowed_models as readonly string[]
  const modelAllowed  = allowedModels.includes(requestedModel)

  if (!modelAllowed) {
    // Find best allowed model for fallback
    const fallbackModel = allowedModels[allowedModels.length - 1] ?? "claude-haiku-4-5-20251001"
    // Don't block — just signal to downgrade
    return {
      ok:           true,
      code:         "OK",
      message:      "OK — model downgraded to plan tier",
      httpStatus:   200,
      balanceAfter: balance - worstCaseCostUsd,
      quotaRemaining: Math.max(0, quota - used - 1),
      fallbackModel,
    }
  }

  // 7. Subscription gate (only checks if agent requires it)
  if (requiresSubscription && freeCallsRemaining <= 0 && !hasActiveSubscription) {
    return {
      ok: false, code: "AGENT_REQUIRES_SUBSCRIPTION", httpStatus: 403,
      message: "This agent requires an active subscription. Subscribe in Marketplace to continue.",
    }
  }

  // All checks passed
  return {
    ok:             true,
    code:           "OK",
    message:        "OK",
    httpStatus:     200,
    balanceAfter:   parseFloat((balance - worstCaseCostUsd).toFixed(8)),
    quotaRemaining: quota === -1 ? -1 : Math.max(0, quota - used - 1),
  }
}
