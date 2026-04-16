// ============================================================
// AgentDyne Platform — Shared constants
// ============================================================

export const MAX_SYSTEM_PROMPT_LENGTH = 32_000

export const SUPPORTED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-1.5-pro",
] as const

export type SupportedModel = (typeof SUPPORTED_MODELS)[number]

export const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-6":            "Claude Opus 4.6 — Most powerful",
  "claude-sonnet-4-20250514":   "Claude Sonnet 4 — Balanced (recommended)",
  "claude-haiku-4-5-20251001":  "Claude Haiku 4.5 — Fastest / cheapest",
  "gpt-4o":                     "GPT-4o — OpenAI flagship",
  "gpt-4o-mini":                "GPT-4o Mini — OpenAI lightweight",
  "gemini-1.5-pro":             "Gemini 1.5 Pro — Google flagship",
}

// Platform revenue share
export const PLATFORM_TAKE_RATE    = 0.20   // 20% platform fee
export const SELLER_SHARE          = 0.80   // 80% to seller
// Alias used by seller-client.tsx — keeps both names valid
export const PLATFORM_FEE_PERCENT  = 0.20

export const PLAN_QUOTAS: Record<string, number> = {
  free:       100,
  starter:    1_000,
  pro:        10_000,
  enterprise: -1,   // unlimited
}
