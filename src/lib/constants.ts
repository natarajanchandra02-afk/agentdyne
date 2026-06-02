// ============================================================
// AgentDyne Platform — Shared constants
// May 2026 — Launch-ready version
// Safe to import from both client and server components.
// DO NOT import server-only modules here.
// ============================================================

// ── Agent field limits ─────────────────────────────────────────────────────
export const MAX_AGENT_NAME_LENGTH         = 60
export const MAX_AGENT_DESCRIPTION_LENGTH  = 300
export const MAX_SYSTEM_PROMPT_LENGTH      = 32_000
export const MAX_AGENTS_PER_USER           = 50

// ── Supported models (aligned with model-router.ts) ───────────────────────
export const SUPPORTED_MODELS = [
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gpt-4o",
  "gpt-4o-mini",
] as const

export type SupportedModel = (typeof SUPPORTED_MODELS)[number]

export const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-6":         "Claude Sonnet 4.6 — Balanced (recommended)",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5 — Fastest / cheapest",
  "claude-opus-4-6":           "Claude Opus 4.6 — Most powerful",
  "gemini-2.5-flash":          "Gemini 2.5 Flash — Google (ultra-low cost)",
  "gemini-2.5-pro":            "Gemini 2.5 Pro — Google flagship",
  "gpt-4o":                    "GPT-4o — OpenAI flagship",
  "gpt-4o-mini":               "GPT-4o Mini — OpenAI lightweight",
}

// Models available to each plan (enforced in execute route)
export const PLAN_ALLOWED_MODELS: Record<string, SupportedModel[]> = {
  free:       ["claude-haiku-4-5-20251001", "gemini-2.5-flash"],
  starter:    ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "gemini-2.5-flash", "gpt-4o-mini"],
  pro:        SUPPORTED_MODELS.filter(m => m !== "claude-opus-4-6") as SupportedModel[],
  enterprise: [...SUPPORTED_MODELS] as SupportedModel[],
}

// ── Revenue share ──────────────────────────────────────────────────────────
export const PLATFORM_FEE_PERCENT = 0.20
export const PLATFORM_TAKE_RATE   = 0.20
export const SELLER_SHARE         = 0.80

// ── Plan quotas — SINGLE SOURCE OF TRUTH ──────────────────────────────────
export const PLAN_QUOTAS: Record<string, number> = {
  free:       50,
  starter:    500,
  pro:        5_000,
  enterprise: -1,
}

// ── Compute caps (hard monthly USD spend limit per plan) ───────────────────
export const PLAN_COMPUTE_CAPS: Record<string, number> = {
  free:       5.00,
  starter:    10.00,
  pro:        50.00,
  enterprise: -1,
}

// ── Concurrency limits ─────────────────────────────────────────────────────
export const PLAN_CONCURRENCY: Record<string, number> = {
  free:       1,
  starter:    3,
  pro:        10,
  enterprise: 50,
}

// ── Token costs (USD per token, May 2026 blended) ─────────────────────────
export const TOKEN_COST_PER_TOKEN = {
  inputPer:  0.000003,
  outputPer: 0.000015,
} as const

// ── Scoring thresholds ─────────────────────────────────────────────────────
export const MIN_EXECUTIONS_FOR_SCORE = 10
export const MAX_CAPABILITY_TAGS      = 20
export const EVAL_SCORE_REJECT        = 70
export const EVAL_SCORE_FAST_TRACK    = 85

// ── Feature flags ──────────────────────────────────────────────────────────
export const FEATURE_FLAGS = {
  FREE_CAN_PUBLISH:       false,
  PIPELINES_ENABLED:      true,
  PIPELINES_FREE_ENABLED: false,
  QUEUE_EXECUTION:        false,
  EVAL_HARNESS:           true,
  REPUTATION_SYSTEM:      true,
  LEAKED_PASSWORD_PROT:   true,
  STREAMING_ENABLED:      true,
  MULTI_AGENT_SWARM:      true,
  BROWSER_AGENTS:         true,
  EMBED_WIDGETS:          true,
  GEMINI_MODELS:          true,
} as const
