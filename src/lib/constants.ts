// ============================================================
// AgentDyne Platform — Shared constants
// Safe to import from both client and server components.
// DO NOT import server-only modules here.
// ============================================================

// ── Agent field limits ─────────────────────────────────────────────────────
export const MAX_AGENT_NAME_LENGTH         = 60
export const MAX_AGENT_DESCRIPTION_LENGTH  = 300
export const MAX_SYSTEM_PROMPT_LENGTH      = 32_000
export const MAX_AGENTS_PER_USER           = 50

// ── Supported models ──────────────────────────────────────────────────────
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

// ── Revenue share ──────────────────────────────────────────────────────────
export const PLATFORM_FEE_PERCENT  = 0.20   // 20% platform take rate
export const PLATFORM_TAKE_RATE    = 0.20
export const SELLER_SHARE          = 0.80   // 80% to seller

// ── Plan quotas (monthly execution limits) ────────────────────────────────
export const PLAN_QUOTAS: Record<string, number> = {
  free:       100,
  starter:    1_000,
  pro:        10_000,
  enterprise: -1,   // unlimited (-1 = no cap)
}

// ── Token cost estimates (USD per token, April 2026) ─────────────────────
export const TOKEN_COST_PER_TOKEN = {
  inputPer:  0.000003,   // $3 / 1M input tokens
  outputPer: 0.000015,   // $15 / 1M output tokens
} as const

// ── Scoring ───────────────────────────────────────────────────────────────
export const MIN_EXECUTIONS_FOR_SCORE = 10
export const MAX_CAPABILITY_TAGS      = 20
