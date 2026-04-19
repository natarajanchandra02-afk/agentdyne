/**
 * @module agentEvaluator
 * @path   src/core/analytics/agentEvaluator.ts
 *
 * Agent scoring + efficiency ranking engine.
 *
 * Computes a composite_score [0–100] for each agent based on:
 *   - Reliability (success rate)        — 30% weight
 *   - Speed (average latency)           — 20% weight
 *   - Cost efficiency (cost per token)  — 20% weight
 *   - Popularity (execution volume)     — 15% weight
 *   - User rating (average review)      — 15% weight
 *
 * Also computes performance badges:
 *   is_top_rated    (rating ≥ 4.5 AND ≥ 10 reviews)
 *   is_fastest      (avg_latency ≤ 1500ms AND success_rate ≥ 0.9)
 *   is_cheapest     (cost_per_1k_tokens in bottom 10% of category)
 *   is_most_reliable (success_rate ≥ 0.98 AND ≥ 50 executions)
 *
 * Called by: scheduled pg_cron job + admin endpoint + post-execution trigger
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentStats {
  id:                     string
  name:                   string
  category:               string
  total_executions:       number
  successful_executions:  number
  average_latency_ms:     number
  average_rating:         number
  total_reviews:          number
  total_revenue:          number
  model_name:             string
  pricing_model:          string
  price_per_call:         number
}

export interface AgentScore {
  agentId:          string
  reliabilityScore: number   // 0–100
  latencyScore:     number   // 0–100
  costScore:        number   // 0–100
  popularityScore:  number   // 0–100
  ratingScore:      number   // 0–100
  compositeScore:   number   // 0–100 weighted
  categoryRank?:    number
  globalRank?:      number
  isTopRated:       boolean
  isFastest:        boolean
  isCheapest:       boolean
  isMostReliable:   boolean
  sampleSize:       number
}

// ─── Scoring functions ────────────────────────────────────────────────────────

const WEIGHTS = {
  reliability: 0.30,
  latency:     0.20,
  cost:        0.20,
  popularity:  0.15,
  rating:      0.15,
} as const

/** Score reliability: success_rate → 0–100 */
function scoreReliability(agent: AgentStats): number {
  if (agent.total_executions < 5) return 50  // not enough data — neutral
  const rate = agent.successful_executions / agent.total_executions
  return Math.round(rate * 100)
}

/**
 * Score latency: lower = better
 * < 500ms → 100, 500ms–2s → 70–100, 2s–5s → 40–70, > 5s → 0–40
 */
function scoreLatency(agent: AgentStats): number {
  const ms = agent.average_latency_ms
  if (ms <= 0)     return 50   // no data
  if (ms <= 500)   return 100
  if (ms <= 1000)  return 90
  if (ms <= 2000)  return 75
  if (ms <= 3000)  return 60
  if (ms <= 5000)  return 40
  if (ms <= 10000) return 20
  return 5
}

/**
 * Score cost: lower = better
 * free → 100, < $0.001/call → 90, < $0.01 → 70, < $0.1 → 50, > $0.1 → 20
 */
function scoreCost(agent: AgentStats): number {
  if (agent.pricing_model === "free") return 100
  const price = agent.price_per_call ?? 0
  if (price <= 0)      return 100
  if (price < 0.001)   return 90
  if (price < 0.005)   return 80
  if (price < 0.01)    return 70
  if (price < 0.05)    return 55
  if (price < 0.1)     return 40
  return 20
}

/**
 * Score popularity: log-scale, 1000 executions = 100
 * 1 exec → 10, 10 → 30, 100 → 60, 1000+ → 100
 */
function scorePopularity(agent: AgentStats): number {
  const n = agent.total_executions
  if (n <= 0)     return 0
  if (n < 5)      return 10
  if (n < 10)     return 20
  if (n < 50)     return 35
  if (n < 100)    return 50
  if (n < 500)    return 70
  if (n < 1000)   return 85
  return 100
}

/** Score rating: direct map 0–5 → 0–100 */
function scoreRating(agent: AgentStats): number {
  if (agent.total_reviews < 3) return 50  // neutral until enough reviews
  return Math.round((agent.average_rating / 5) * 100)
}

// ─── Badge computation ────────────────────────────────────────────────────────

function computeBadges(
  agent: AgentStats,
  allAgents: AgentStats[],
  category: string
): {
  isTopRated:      boolean
  isFastest:       boolean
  isCheapest:      boolean
  isMostReliable:  boolean
} {
  const successRate = agent.total_executions > 0
    ? agent.successful_executions / agent.total_executions
    : 0

  const isTopRated = (
    agent.average_rating >= 4.5 &&
    agent.total_reviews  >= 10
  )

  const isFastest = (
    agent.average_latency_ms <= 1500 &&
    successRate >= 0.90 &&
    agent.total_executions >= 20
  )

  // Cheapest in category: bottom 10% of price
  const categoryAgents = allAgents.filter(a => a.category === category)
  const prices         = categoryAgents
    .map(a => a.price_per_call ?? 0)
    .filter(p => p > 0)
    .sort((a, b) => a - b)
  const p10Threshold   = prices[Math.floor(prices.length * 0.1)] ?? 0
  const isCheapest     = prices.length > 0
    ? (agent.price_per_call ?? 0) <= p10Threshold
    : agent.pricing_model === "free"

  const isMostReliable = (
    successRate >= 0.98 &&
    agent.total_executions >= 50
  )

  return { isTopRated, isFastest, isCheapest, isMostReliable }
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * evaluateAgent
 * Compute the full score for a single agent given peer context.
 *
 * @param agent       The agent to score
 * @param allAgents   All agents in the same category (for relative ranking)
 */
export function evaluateAgent(
  agent:     AgentStats,
  allAgents: AgentStats[] = []
): AgentScore {
  const R = scoreReliability(agent)
  const L = scoreLatency(agent)
  const C = scoreCost(agent)
  const P = scorePopularity(agent)
  const T = scoreRating(agent)

  const composite = Math.round(
    R * WEIGHTS.reliability +
    L * WEIGHTS.latency     +
    C * WEIGHTS.cost        +
    P * WEIGHTS.popularity  +
    T * WEIGHTS.rating
  )

  const badges = computeBadges(agent, allAgents, agent.category)

  return {
    agentId:          agent.id,
    reliabilityScore: R,
    latencyScore:     L,
    costScore:        C,
    popularityScore:  P,
    ratingScore:      T,
    compositeScore:   composite,
    sampleSize:       agent.total_executions,
    ...badges,
  }
}

/**
 * rankAgents
 * Evaluate and rank all agents, returning sorted results with ranks.
 * This is what the leaderboard API uses.
 */
export function rankAgents(agents: AgentStats[]): (AgentScore & { agentId: string })[] {
  const scores = agents.map(a => evaluateAgent(a, agents))

  // Global rank
  const sorted = [...scores].sort((a, b) => b.compositeScore - a.compositeScore)
  const globalRanked = sorted.map((s, i) => ({ ...s, globalRank: i + 1 }))

  // Category rank
  const categories = [...new Set(agents.map(a => a.category))]
  for (const cat of categories) {
    const catAgents = globalRanked
      .filter(s => agents.find(a => a.id === s.agentId)?.category === cat)
      .sort((a, b) => b.compositeScore - a.compositeScore)
    catAgents.forEach((s, i) => { s.categoryRank = i + 1 })
  }

  return globalRanked
}

/**
 * computeEfficiencyScore
 * Returns tokens-per-dollar (higher = more efficient).
 * Used in marketplace sort and agent card display.
 */
export function computeEfficiencyScore(
  avgCostUsd:     number,
  avgTokensTotal: number
): number {
  if (avgCostUsd <= 0) return 0
  return Math.round(avgTokensTotal / avgCostUsd)
}

/**
 * computeValueScore
 * Composite quality/cost ratio: (composite_score / 100) / (avg_cost_usd + 0.001)
 * Penalises expensive agents unless their quality is proportionally higher.
 */
export function computeValueScore(compositeScore: number, avgCostUsd: number): number {
  return parseFloat((compositeScore / (avgCostUsd + 0.001)).toFixed(2))
}
