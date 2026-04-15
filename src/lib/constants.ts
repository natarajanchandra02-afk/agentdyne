/**
 * Platform-wide constants shared between client and server.
 *
 * IMPORTANT: Do NOT import server-only modules (stripe, supabase/server, etc.)
 * in this file. It is imported by client components.
 */

/** AgentDyne platform fee: 20% of each transaction. Seller keeps 80%. */
export const PLATFORM_FEE_PERCENT = 0.20

/** Seller revenue share percentage (displayed in UI) */
export const SELLER_REVENUE_PCT = (1 - PLATFORM_FEE_PERCENT) * 100  // 80

/** Minimum executions required before an agent earns a quality score */
export const MIN_EXECUTIONS_FOR_SCORE = 10

/** Maximum capability tags per agent */
export const MAX_CAPABILITY_TAGS = 20

/** Maximum system prompt length (characters) */
export const MAX_SYSTEM_PROMPT_LENGTH = 8000

/** Maximum agent name length */
export const MAX_AGENT_NAME_LENGTH = 60

/** Maximum agent description length */
export const MAX_AGENT_DESCRIPTION_LENGTH = 300

/** Supported AI models on the platform */
export const SUPPORTED_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-1.5-pro",
] as const

export type SupportedModel = typeof SUPPORTED_MODELS[number]
