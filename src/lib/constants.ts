// ============================================================
// AgentDyne Platform — Shared constants
// April 2026 — FINAL RELEASE VERSION
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
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-6",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-1.5-pro",
] as const

export type SupportedModel = (typeof SUPPORTED_MODELS)[number]

export const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-6":          "Claude Sonnet 4.6 — Balanced (recommended)",
  "claude-haiku-4-5-20251001":  "Claude Haiku 4.5 — Fastest / cheapest",
  "claude-opus-4-6":            "Claude Opus 4.6 — Most powerful",
  "gpt-4o":                     "GPT-4o — OpenAI flagship",
  "gpt-4o-mini":                "GPT-4o Mini — OpenAI lightweight",
  "gemini-1.5-pro":             "Gemini 1.5 Pro — Google flagship",
}

// ── Revenue share ──────────────────────────────────────────────────────────
export const PLATFORM_FEE_PERCENT  = 0.20   // 20% platform take rate
export const PLATFORM_TAKE_RATE    = 0.20
export const SELLER_SHARE          = 0.80   // 80% to seller

// ── Plan quotas — SINGLE SOURCE OF TRUTH (aligned with pricing page + anti-abuse)
// Free: 50 lifetime / 30 days — growth lever, tightly controlled
// Starter: 500/month | Pro: 5,000/month | Enterprise: unlimited
export const PLAN_QUOTAS: Record<string, number> = {
  free:       50,        // lifetime total (checked against lifetime_executions_used)
  starter:    500,
  pro:        5_000,
  enterprise: -1,        // -1 = no cap
}

// ── Compute caps (hard monthly USD spend limit per plan) ──────────────────
export const PLAN_COMPUTE_CAPS: Record<string, number> = {
  free:       5.00,      // $5 lifetime cap (safety net)
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

// ── Token cost estimates (USD per token, April 2026) ─────────────────────
export const TOKEN_COST_PER_TOKEN = {
  inputPer:  0.000003,   // $3 / 1M input tokens (Sonnet blended)
  outputPer: 0.000015,   // $15 / 1M output tokens
} as const

// ── Scoring ───────────────────────────────────────────────────────────────
export const MIN_EXECUTIONS_FOR_SCORE = 10
export const MAX_CAPABILITY_TAGS      = 20

// ── Evaluation gates ──────────────────────────────────────────────────────
export const EVAL_SCORE_REJECT      = 70     // < 70 = instant reject
export const EVAL_SCORE_FAST_TRACK  = 85     // > 85 = fast-track review

// ── Feature flags (phase-gated launch) ───────────────────────────────────
export const FEATURE_FLAGS = {
  FREE_CAN_PUBLISH:         false,   // Phase 3: free users can submit to marketplace
  PIPELINES_ENABLED:        true,    // Phase 2: pipelines available to paid users
  PIPELINES_FREE_ENABLED:   false,   // Free users cannot use pipelines
  QUEUE_EXECUTION:          false,   // Phase 3: async queue (Cloudflare Queues)
  EVAL_HARNESS:             true,    // Live: eval harness on submit
  REPUTATION_SYSTEM:        true,    // Live: builder_rank tracking
  LEAKED_PASSWORD_PROT:     true,    // Dashboard: must enable manually
} as const
