/**
 * AgentDyne — Anti-Abuse Engine
 * ============================================================
 * LAYER 1: Per-user rate limiting (plan-aware, not just per-IP)
 * LAYER 2: Cost estimation + pre-flight budget check
 * LAYER 3: Execution guardrails (max tokens, timeout, loop detection)
 * LAYER 4: Bot fingerprinting + behavioral anomaly detection
 *
 * All functions are edge-runtime safe (no Node.js APIs).
 * Persistence uses Supabase (rate_limit_counters + abuse_events tables).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONSTANTS & PLAN LIMITS
// ─────────────────────────────────────────────────────────────────────────────

/** Execution limits per subscription plan */
export const PLAN_LIMITS = {
  free: {
    executions_per_minute:  3,
    executions_per_hour:    20,
    executions_per_day:     50,
    max_tokens_per_exec:    2_000,
    max_input_chars:        4_000,
    max_pipeline_steps:     5,
    max_cost_per_exec_usd:  0.05,  // hard ceiling per single execution
    concurrent_executions:  1,
    allowed_models:         ["claude-haiku-4-5-20251001"],
  },
  starter: {
    executions_per_minute:  10,
    executions_per_hour:    100,
    executions_per_day:     500,
    max_tokens_per_exec:    4_000,
    max_input_chars:        16_000,
    max_pipeline_steps:     10,
    max_cost_per_exec_usd:  0.25,
    concurrent_executions:  3,
    allowed_models:         ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
  },
  pro: {
    executions_per_minute:  30,
    executions_per_hour:    500,
    executions_per_day:     5_000,
    max_tokens_per_exec:    8_000,
    max_input_chars:        64_000,
    max_pipeline_steps:     25,
    max_cost_per_exec_usd:  1.00,
    concurrent_executions:  10,
    allowed_models:         ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
  },
  enterprise: {
    executions_per_minute:  200,
    executions_per_hour:    5_000,
    executions_per_day:     100_000,
    max_tokens_per_exec:    32_000,
    max_input_chars:        200_000,
    max_pipeline_steps:     100,
    max_cost_per_exec_usd:  10.00,
    concurrent_executions:  50,
    allowed_models:         ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"],
  },
} as const

export type PlanName = keyof typeof PLAN_LIMITS

/** Model cost per 1K tokens (input + output) */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.00025,  output: 0.00125  },
  "claude-sonnet-4-6":         { input: 0.003,    output: 0.015    },
  "claude-opus-4-6":           { input: 0.015,    output: 0.075    },
  // fallback
  "default":                   { input: 0.003,    output: 0.015    },
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — COST ESTIMATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface CostEstimate {
  estimated_tokens_input:  number
  estimated_tokens_output: number
  estimated_cost_usd:      number
  model:                   string
  within_plan_limit:       boolean
  within_credit_balance:   boolean
  estimated_credits_needed: number
}

/**
 * estimateExecutionCost
 * Call BEFORE executing to show cost to user + enforce budget ceiling.
 *
 * Token estimation: 1 token ≈ 4 chars (conservative estimate for pre-flight)
 * We charge for the ESTIMATE up front; difference is reconciled post-execution.
 */
export function estimateExecutionCost(params: {
  inputText:      string
  systemPrompt:   string
  modelName:      string
  maxTokens:      number
  plan:           PlanName
  creditBalance:  number
}): CostEstimate {
  const { inputText, systemPrompt, modelName, maxTokens, plan, creditBalance } = params

  const model = MODEL_COSTS[modelName] ?? MODEL_COSTS["default"]
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  // Conservative token estimate: (input chars + system chars) / 3.5
  const estimatedInput  = Math.ceil((inputText.length + systemPrompt.length) / 3.5)
  // Assume 70% of max_tokens will be used on average
  const estimatedOutput = Math.min(Math.ceil(maxTokens * 0.7), limits.max_tokens_per_exec)

  const estimatedCost =
    (estimatedInput  / 1000) * model.input +
    (estimatedOutput / 1000) * model.output

  // Platform margin: 3× (cost × 3 = what user pays in credits)
  const MARGIN = 3
  const estimatedCredits = estimatedCost * MARGIN

  return {
    estimated_tokens_input:   estimatedInput,
    estimated_tokens_output:  estimatedOutput,
    estimated_cost_usd:       estimatedCost,
    model:                    modelName,
    within_plan_limit:        estimatedCost <= limits.max_cost_per_exec_usd,
    within_credit_balance:    creditBalance >= estimatedCredits,
    estimated_credits_needed: estimatedCredits,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — DISTRIBUTED RATE LIMITER (per-user, plan-aware)
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed:    boolean
  remaining:  number
  resetAt:    number   // unix ms
  retryAfter: number   // seconds
  window:     "minute" | "hour" | "day"
  limitHit:   number
}

/**
 * checkUserRateLimit
 *
 * Three-window check: minute → hour → day (cheapest first).
 * Uses Supabase rate_limit_counters table for distributed state.
 * Falls back to "allow" if DB is unavailable (fail-open for UX).
 */
export async function checkUserRateLimit(
  supabase: SupabaseClient,
  userId:   string,
  plan:     PlanName
): Promise<RateLimitResult> {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  const now    = Date.now()

  const windows: Array<{
    key:    string
    limit:  number
    window: "minute" | "hour" | "day"
    ms:     number
  }> = [
    {
      key:    `exec:min:${userId}`,
      limit:  limits.executions_per_minute,
      window: "minute",
      ms:     60_000,
    },
    {
      key:    `exec:hr:${userId}`,
      limit:  limits.executions_per_hour,
      window: "hour",
      ms:     3_600_000,
    },
    {
      key:    `exec:day:${userId}`,
      limit:  limits.executions_per_day,
      window: "day",
      ms:     86_400_000,
    },
  ]

  for (const w of windows) {
    try {
      const windowEnd = new Date(now + w.ms).toISOString()

      // Upsert: increment counter or create new window
      const { data, error } = await supabase.rpc("increment_rate_limit", {
        key_param:        w.key,
        window_end_param: windowEnd,
        limit_param:      w.limit,
      })

      if (error) continue  // fail-open on DB error

      const result = data as { count: number; window_end: string; blocked: boolean }

      if (result.blocked) {
        const resetAt = new Date(result.window_end).getTime()
        return {
          allowed:    false,
          remaining:  0,
          resetAt,
          retryAfter: Math.ceil((resetAt - now) / 1000),
          window:     w.window,
          limitHit:   w.limit,
        }
      }

      // Not blocked at this window — continue to next
    } catch {
      continue  // fail-open
    }
  }

  return {
    allowed:    true,
    remaining:  limits.executions_per_minute, // approximate
    resetAt:    now + 60_000,
    retryAfter: 0,
    window:     "minute",
    limitHit:   0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — BOT / ABUSE FINGERPRINTING
// ─────────────────────────────────────────────────────────────────────────────

export interface BotSignal {
  name:        string
  score:       number   // 0–100 (higher = more suspicious)
  description: string
}

export interface BotDetectionResult {
  riskScore:    number        // 0–100 composite
  signals:      BotSignal[]
  action:       "allow" | "challenge" | "block"
  reason:       string | null
}

/**
 * detectBotPatterns
 *
 * Stateless header/timing/payload-based bot detection.
 * Scores are additive up to 100. Actions:
 *   < 30: allow
 *   30–60: challenge (add CAPTCHA / slow response)
 *   > 60: block
 *
 * Note: This runs BEFORE any DB call — pure signal scoring.
 * Pair with behavioral analysis (checkUserBehavior) for full picture.
 */
export function detectBotPatterns(req: {
  userAgent:         string | null
  contentType:       string | null
  accept:            string | null
  origin:            string | null
  referer:           string | null
  xRequestedWith:    string | null
  cfThreatScore:     number | null   // Cloudflare threat score (0–100)
  requestsThisHour?: number          // from behavioral analysis
  inputText:         string
}): BotDetectionResult {
  const signals: BotSignal[] = []

  // ── 1. Missing User-Agent (strong bot signal) ─────────────────────────
  if (!req.userAgent || req.userAgent.trim().length < 5) {
    signals.push({
      name:        "missing_user_agent",
      score:       40,
      description: "No or empty User-Agent header",
    })
  } else {
    // Known bot / scraper user agents
    const botUAPatterns = [
      /curl\//i, /wget\//i, /python-requests\//i, /go-http-client\//i,
      /axios\//i, /node-fetch\//i, /got\//i, /^java\//i,
      /scrapy\//i, /bot\b/i, /spider\b/i, /crawler\b/i,
    ]
    const matchedUA = botUAPatterns.find(p => p.test(req.userAgent!))
    if (matchedUA) {
      signals.push({
        name:        "bot_user_agent",
        score:       25,
        description: `User-Agent matches known bot pattern: ${req.userAgent}`,
      })
    }
  }

  // ── 2. No Accept header (browsers always send Accept) ────────────────
  if (!req.accept) {
    signals.push({
      name:        "missing_accept_header",
      score:       15,
      description: "Missing Accept header — likely programmatic request",
    })
  }

  // ── 3. No Origin / Referer for browser-expected request ──────────────
  if (!req.origin && !req.referer) {
    signals.push({
      name:        "missing_origin_referer",
      score:       10,
      description: "No Origin or Referer header",
    })
  }

  // ── 4. Cloudflare threat score ────────────────────────────────────────
  if (req.cfThreatScore !== null && req.cfThreatScore > 20) {
    const score = Math.min(50, req.cfThreatScore)
    signals.push({
      name:        "cf_threat_score",
      score,
      description: `Cloudflare threat score: ${req.cfThreatScore}`,
    })
  }

  // ── 5. High volume (behavioral) ───────────────────────────────────────
  if (req.requestsThisHour !== undefined && req.requestsThisHour > 100) {
    const score = Math.min(40, Math.floor((req.requestsThisHour - 100) / 10))
    signals.push({
      name:        "high_volume",
      score,
      description: `${req.requestsThisHour} requests this hour`,
    })
  }

  // ── 6. Input pattern abuse signals ───────────────────────────────────
  const suspiciousPatterns = [
    { pattern: /(.)\1{50,}/, name: "repeated_char",  score: 20 },  // "aaaa..." × 50
    { pattern: /^[\s\n]+$/,  name: "blank_input",    score: 15 },  // only whitespace
    { pattern: /.{8000,}/,   name: "oversized_input",score: 20 },  // > 8KB input
    {
      pattern: /(\b\w{3,}\b)(?:\s+\1){5,}/,          // same word repeated 5+ times
      name:    "word_spam",
      score:   25,
    },
  ]

  for (const sp of suspiciousPatterns) {
    if (sp.pattern.test(req.inputText)) {
      signals.push({
        name:        sp.name,
        score:       sp.score,
        description: `Input pattern: ${sp.name}`,
      })
    }
  }

  // ── Composite score ───────────────────────────────────────────────────
  const riskScore = Math.min(100, signals.reduce((s, sig) => s + sig.score, 0))

  let action: "allow" | "challenge" | "block"
  let reason: string | null = null

  if (riskScore >= 60) {
    action = "block"
    reason = signals.sort((a, b) => b.score - a.score)[0]?.description ?? "Risk score exceeded"
  } else if (riskScore >= 30) {
    action = "challenge"
    reason = `Risk score ${riskScore}/100 — suspicious activity detected`
  } else {
    action = "allow"
  }

  return { riskScore, signals, action, reason }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — BEHAVIORAL ANOMALY DETECTION (DB-backed)
// ─────────────────────────────────────────────────────────────────────────────

export interface BehaviorProfile {
  requests_last_hour:  number
  requests_last_day:   number
  failures_last_hour:  number
  avg_cost_last_day:   number
  unusual_spike:       boolean
  abuse_score:         number   // 0–100
}

/**
 * getUserBehaviorProfile
 *
 * Looks at the user's execution history to build a behavioral profile.
 * A sudden spike (10× normal rate) is flagged regardless of plan limits.
 */
export async function getUserBehaviorProfile(
  supabase: SupabaseClient,
  userId:   string
): Promise<BehaviorProfile> {
  const now      = new Date()
  const hourAgo  = new Date(now.getTime() - 3_600_000).toISOString()
  const dayAgo   = new Date(now.getTime() - 86_400_000).toISOString()

  try {
    const [hourRes, dayRes, failRes, costRes] = await Promise.all([
      supabase
        .from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", hourAgo),

      supabase
        .from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", dayAgo),

      supabase
        .from("executions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "failed")
        .gte("created_at", hourAgo),

      supabase
        .from("executions")
        .select("cost_usd")
        .eq("user_id", userId)
        .gte("created_at", dayAgo),
    ])

    const reqs_hour  = hourRes.count  ?? 0
    const reqs_day   = dayRes.count   ?? 0
    const fails_hour = failRes.count  ?? 0
    const avgCost    = costRes.data?.length
      ? (costRes.data as any[]).reduce((s, e) => s + Number(e.cost_usd ?? 0), 0) / costRes.data.length
      : 0

    // Spike detection: last hour rate vs day average
    const hourly_avg_from_day = reqs_day / 24
    const unusual_spike       = reqs_hour > Math.max(10, hourly_avg_from_day * 5)

    // Abuse score
    let abuse_score = 0
    if (unusual_spike)               abuse_score += 30
    if (reqs_hour > 50)              abuse_score += 20
    if (fails_hour > 10)             abuse_score += 20
    if (fails_hour / Math.max(reqs_hour, 1) > 0.5) abuse_score += 15  // >50% failure rate
    if (avgCost > 1.00)              abuse_score += 15  // expensive executions

    return {
      requests_last_hour:  reqs_hour,
      requests_last_day:   reqs_day,
      failures_last_hour:  fails_hour,
      avg_cost_last_day:   avgCost,
      unusual_spike,
      abuse_score:         Math.min(100, abuse_score),
    }
  } catch {
    // Fail-open: if behavior check errors, don't block the user
    return {
      requests_last_hour:  0,
      requests_last_day:   0,
      failures_last_hour:  0,
      avg_cost_last_day:   0,
      unusual_spike:       false,
      abuse_score:         0,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — EXECUTION GUARDRAILS
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecutionGuardrailResult {
  allowed:       boolean
  reason:        string | null
  clampedTokens: number         // max_tokens clamped to plan limit
  clampedInput:  string         // input truncated to plan char limit
  modelAllowed:  boolean
  fallbackModel: string | null  // cheaper model if requested model not in plan
}

/**
 * applyExecutionGuardrails
 *
 * Enforces hard limits before sending to AI:
 *   1. Input length cap (chars)
 *   2. Max tokens cap
 *   3. Model allowlist (free users → Haiku only)
 *   4. Cost ceiling per execution
 */
export function applyExecutionGuardrails(params: {
  plan:           PlanName
  inputText:      string
  requestedTokens: number
  requestedModel: string
  estimatedCost:  number
}): ExecutionGuardrailResult {
  const { plan, inputText, requestedTokens, requestedModel, estimatedCost } = params
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  // 1. Cost ceiling
  if (estimatedCost > limits.max_cost_per_exec_usd) {
    return {
      allowed:       false,
      reason:        `Estimated cost $${estimatedCost.toFixed(4)} exceeds plan limit of $${limits.max_cost_per_exec_usd}`,
      clampedTokens: 0,
      clampedInput:  inputText,
      modelAllowed:  false,
      fallbackModel: null,
    }
  }

  // 2. Input truncation (soft guard — don't block, just truncate)
  const clampedInput = inputText.length > limits.max_input_chars
    ? inputText.slice(0, limits.max_input_chars) + "\n\n[Input truncated to plan limit]"
    : inputText

  // 3. Token clamping
  const clampedTokens = Math.min(requestedTokens, limits.max_tokens_per_exec)

  // 4. Model allowlist
  const allowed = limits.allowed_models as readonly string[]
  const modelAllowed = allowed.includes(requestedModel)

  let fallbackModel: string | null = null
  if (!modelAllowed) {
    // Downgrade to cheapest allowed model for this plan
    fallbackModel = allowed[0] ?? "claude-haiku-4-5-20251001"
  }

  return {
    allowed:       true,
    reason:        null,
    clampedTokens,
    clampedInput,
    modelAllowed,
    fallbackModel,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — LOOP / RECURSION DETECTION (for pipelines)
// ─────────────────────────────────────────────────────────────────────────────

export interface LoopCheckResult {
  safe:         boolean
  cycleFound:   boolean
  maxDepthHit:  boolean
  visitedNodes: string[]
}

/**
 * detectPipelineLoop
 *
 * Topological sort-based cycle detection for pipeline DAGs.
 * Also enforces max step depth per plan.
 *
 * @param nodes  Array of { id: string }
 * @param edges  Array of { source: string; target: string }
 * @param plan   Subscription plan (determines max step limit)
 */
export function detectPipelineLoop(
  nodes:  Array<{ id: string }>,
  edges:  Array<{ source: string; target: string }>,
  plan:   PlanName = "free"
): LoopCheckResult {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  const visited    = new Set<string>()
  const inStack    = new Set<string>()
  const adj        = new Map<string, string[]>()

  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    adj.get(e.source)!.push(e.target)
  }

  let cycleFound = false

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) { cycleFound = true; return true }
    if (visited.has(nodeId)) return false

    visited.add(nodeId)
    inStack.add(nodeId)

    for (const neighbor of (adj.get(nodeId) ?? [])) {
      if (dfs(neighbor)) return true
    }

    inStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) dfs(node.id)
    if (cycleFound) break
  }

  const maxDepthHit = nodes.length > limits.max_pipeline_steps

  return {
    safe:         !cycleFound && !maxDepthHit,
    cycleFound,
    maxDepthHit,
    visitedNodes: [...visited],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — ABUSE EVENT LOGGER
// ─────────────────────────────────────────────────────────────────────────────

export type AbuseEventType =
  | "rate_limit_hit"
  | "bot_blocked"
  | "bot_challenged"
  | "cost_ceiling_hit"
  | "model_downgraded"
  | "input_truncated"
  | "loop_detected"
  | "behavioral_anomaly"
  | "credits_exhausted"

export async function logAbuseEvent(
  supabase: SupabaseClient,
  params: {
    userId:    string | null
    agentId:   string | null
    eventType: AbuseEventType
    severity:  "info" | "warning" | "critical"
    details:   Record<string, unknown>
    ipHash?:   string
  }
): Promise<void> {
  try {
    await supabase.from("governance_events").insert({
      user_id:    params.userId,
      event_type: params.eventType,
      severity:   params.severity,
      resource:   params.agentId ? "agents" : null,
      resource_id: params.agentId ?? null,
      details:    params.details,
    })
  } catch {
    // Never throw from logger
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — MASTER PRE-FLIGHT CHECK
// Run this ONCE before every execution. Combines all layers.
// ─────────────────────────────────────────────────────────────────────────────

export interface PreflightResult {
  allowed:         boolean
  code:            string      // machine-readable rejection code
  message:         string      // human-readable message for UI
  httpStatus:      number
  retryAfter?:     number      // seconds (for rate limits)
  estimatedCost?:  CostEstimate
  guardrails?:     ExecutionGuardrailResult
}

export async function runPreflightChecks(
  supabase: SupabaseClient,
  params: {
    userId:         string
    agentId:        string
    plan:           PlanName
    inputText:      string
    systemPrompt:   string
    requestedModel: string
    requestedTokens: number
    creditBalance:  number
    requestHeaders: {
      userAgent:      string | null
      accept:         string | null
      origin:         string | null
      referer:        string | null
      cfThreatScore:  number | null
    }
  }
): Promise<PreflightResult> {
  const {
    userId, agentId, plan, inputText, systemPrompt,
    requestedModel, requestedTokens, creditBalance, requestHeaders,
  } = params

  // ── STEP 1: Bot detection (stateless, instant) ────────────────────────
  const botResult = detectBotPatterns({
    userAgent:      requestHeaders.userAgent,
    contentType:    "application/json",
    accept:         requestHeaders.accept,
    origin:         requestHeaders.origin,
    referer:        requestHeaders.referer,
    xRequestedWith: null,
    cfThreatScore:  requestHeaders.cfThreatScore,
    inputText,
  })

  if (botResult.action === "block") {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "bot_blocked",
      severity:  "critical",
      details:   { riskScore: botResult.riskScore, signals: botResult.signals, reason: botResult.reason },
    })
    return {
      allowed:    false,
      code:       "BOT_BLOCKED",
      message:    "Request blocked — automated abuse detected.",
      httpStatus: 403,
    }
  }

  // ── STEP 2: Per-user rate limit (plan-aware) ──────────────────────────
  const rateResult = await checkUserRateLimit(supabase, userId, plan)

  if (!rateResult.allowed) {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "rate_limit_hit",
      severity:  "warning",
      details:   { window: rateResult.window, limit: rateResult.limitHit, plan },
    })
    return {
      allowed:    false,
      code:       "RATE_LIMIT_EXCEEDED",
      message:    `Rate limit reached (${rateResult.limitHit} per ${rateResult.window}). Upgrade your plan for higher limits.`,
      httpStatus: 429,
      retryAfter: rateResult.retryAfter,
    }
  }

  // ── STEP 3: Behavioral anomaly (DB-backed, async) ─────────────────────
  const behavior = await getUserBehaviorProfile(supabase, userId)

  if (behavior.abuse_score >= 80) {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "behavioral_anomaly",
      severity:  "critical",
      details:   { abuse_score: behavior.abuse_score, ...behavior },
    })
    return {
      allowed:    false,
      code:       "BEHAVIORAL_ANOMALY",
      message:    "Unusual activity detected on your account. Contact support if this is unexpected.",
      httpStatus: 429,
    }
  }

  // ── STEP 4: Cost estimation ───────────────────────────────────────────
  const estimate = estimateExecutionCost({
    inputText,
    systemPrompt,
    modelName:     requestedModel,
    maxTokens:     requestedTokens,
    plan,
    creditBalance,
  })

  if (!estimate.within_credit_balance) {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "credits_exhausted",
      severity:  "info",
      details:   { balance: creditBalance, needed: estimate.estimated_credits_needed },
    })
    return {
      allowed:       false,
      code:          "INSUFFICIENT_CREDITS",
      message:       `Insufficient credits. Estimated cost: $${estimate.estimated_cost_usd.toFixed(4)}. Add credits to continue.`,
      httpStatus:    402,
      estimatedCost: estimate,
    }
  }

  // ── STEP 5: Execution guardrails ──────────────────────────────────────
  const guardrails = applyExecutionGuardrails({
    plan,
    inputText,
    requestedTokens,
    requestedModel,
    estimatedCost: estimate.estimated_cost_usd,
  })

  if (!guardrails.allowed) {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "cost_ceiling_hit",
      severity:  "warning",
      details:   { reason: guardrails.reason, plan, estimated_cost: estimate.estimated_cost_usd },
    })
    return {
      allowed:    false,
      code:       "COST_CEILING_EXCEEDED",
      message:    guardrails.reason ?? "Execution would exceed your plan's cost limit.",
      httpStatus: 402,
    }
  }

  if (!guardrails.modelAllowed && guardrails.fallbackModel) {
    await logAbuseEvent(supabase, {
      userId, agentId,
      eventType: "model_downgraded",
      severity:  "info",
      details:   { requested: requestedModel, fallback: guardrails.fallbackModel, plan },
    })
  }

  // ── All checks passed ─────────────────────────────────────────────────
  return {
    allowed:       true,
    code:          "OK",
    message:       "Pre-flight checks passed",
    httpStatus:    200,
    estimatedCost: estimate,
    guardrails,
  }
}
