/**
 * AgentDyne Platform — Shared constants
 *
 * Rules:
 *  - No server-only imports (stripe, supabase/server, etc.)
 *  - This file is imported by client components — keep it isomorphic.
 *  - All exported names must stay stable. A rename here breaks the build
 *    in every file that imports by name.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Agent builder limits
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum characters allowed in a system prompt */
export const MAX_SYSTEM_PROMPT_LENGTH = 32_000

/** Maximum characters in an agent name */
export const MAX_AGENT_NAME_LENGTH = 60

/** Maximum characters in an agent short description */
export const MAX_AGENT_DESCRIPTION_LENGTH = 300

/** Minimum executions before an agent earns a quality score */
export const MIN_EXECUTIONS_FOR_SCORE = 10

/** Maximum capability tags per agent */
export const MAX_CAPABILITY_TAGS = 20

// ─────────────────────────────────────────────────────────────────────────────
// Supported AI models
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-1.5-pro",
] as const

export type SupportedModel = typeof SUPPORTED_MODELS[number]

/** Human-readable labels for model dropdowns */
export const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6":           "Claude Opus 4.6 — Most powerful",
  "claude-sonnet-4-20250514":  "Claude Sonnet 4 — Balanced (recommended)",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5 — Fastest / cheapest",
  "gpt-4o":                    "GPT-4o — OpenAI flagship",
  "gpt-4o-mini":               "GPT-4o Mini — OpenAI lightweight",
  "gemini-1.5-pro":            "Gemini 1.5 Pro — Google flagship",
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue / billing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Platform take rate — 20 % of every transaction.
 *
 * Both names below are intentionally exported so that existing imports
 * don't break regardless of which name the file uses.
 *
 *  PLATFORM_TAKE_RATE   — canonical name (used in newer code)
 *  PLATFORM_FEE_PERCENT — legacy name (used in seller-client.tsx)
 *
 * Do NOT remove either export without auditing all consumers.
 */
export const PLATFORM_TAKE_RATE   = 0.20
export const PLATFORM_FEE_PERCENT = 0.20   // alias for PLATFORM_TAKE_RATE

export const SELLER_SHARE       = 0.80
export const SELLER_REVENUE_PCT = (1 - PLATFORM_TAKE_RATE) * 100   // 80

// ─────────────────────────────────────────────────────────────────────────────
// Plan quotas
// ─────────────────────────────────────────────────────────────────────────────

/** Monthly execution quota per plan. -1 = unlimited */
export const PLAN_QUOTAS: Record<string, number> = {
  free:       100,
  starter:    1_000,
  pro:        10_000,
  enterprise: -1,
}
