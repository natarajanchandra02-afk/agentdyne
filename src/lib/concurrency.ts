/**
 * AgentDyne — Concurrency Enforcement
 *
 * Enforces per-user concurrent execution limits defined in PLAN_LIMITS.
 * Prevents one user from launching 100 parallel pipelines and starving others.
 *
 * Implementation: DB-backed (Supabase RPC) rather than in-memory.
 * Why: Cloudflare edge isolates are stateless — in-memory state doesn't
 * persist across requests, so it can't track concurrent executions reliably.
 *
 * The check is:
 *   SELECT COUNT(*) FROM executions
 *   WHERE user_id = ? AND status = 'running'
 *   AND created_at > NOW() - INTERVAL '10 minutes'  ← stale guard
 *
 * The 10-minute stale guard prevents "phantom running" executions from
 * permanently blocking users if a crash left a 'running' row un-updated.
 *
 * Edge-runtime safe.
 */

import { PLAN_LIMITS, type PlanName } from "@/lib/anti-abuse"

export interface ConcurrencyCheckResult {
  allowed:         boolean
  current:         number   // active executions right now
  limit:           number   // plan limit
  code:            string
  message:         string
  httpStatus:      number
  retryAfter?:     number   // seconds to wait
}

/**
 * checkConcurrencyLimit
 *
 * Returns { allowed: true } if the user can start another execution.
 * Returns { allowed: false, ... } with a 429 if limit is hit.
 *
 * Fail-open: if the DB RPC errors, we allow the request (UX > perfect enforcement).
 */
export async function checkConcurrencyLimit(
  supabase: any,
  userId:   string,
  plan:     PlanName
): Promise<ConcurrencyCheckResult> {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  const concurrentLimit = limits.concurrent_executions

  try {
    const { data, error } = await supabase
      .rpc("get_concurrent_executions", { user_id_param: userId })

    if (error) {
      // Fail-open — RPC error means we allow
      return { allowed: true, current: 0, limit: concurrentLimit, code: "OK", message: "ok", httpStatus: 200 }
    }

    const current = (data as number) ?? 0

    if (current >= concurrentLimit) {
      return {
        allowed:    false,
        current,
        limit:      concurrentLimit,
        code:       "CONCURRENCY_LIMIT",
        message:    `You have ${current} execution${current !== 1 ? "s" : ""} already running. ` +
                    `Your ${plan} plan allows ${concurrentLimit} concurrent execution${concurrentLimit !== 1 ? "s" : ""}. ` +
                    (plan !== "enterprise"
                      ? `Upgrade your plan for more concurrent executions.`
                      : `Wait for one to complete before starting another.`),
        httpStatus: 429,
        retryAfter: 30,  // conservative — tell client to wait 30s
      }
    }

    return {
      allowed:    true,
      current,
      limit:      concurrentLimit,
      code:       "OK",
      message:    `${current}/${concurrentLimit} concurrent executions`,
      httpStatus: 200,
    }

  } catch {
    // Fail-open
    return { allowed: true, current: 0, limit: concurrentLimit, code: "OK", message: "ok", httpStatus: 200 }
  }
}


/**
 * estimatePipelineCost
 *
 * Pre-flight cost estimation for pipelines before execution starts.
 * Prevents "bill shock" on expensive multi-node × premium-model pipelines.
 *
 * Formula: sum over nodes of (estimated_input_tokens × input_cost + max_tokens × output_cost)
 * Conservative: assumes max_tokens will be fully consumed (worst case).
 *
 * Returns { allowed, estimated_usd, per_node, warning }
 */

import { MODEL_COSTS } from "@/lib/anti-abuse"

export interface PipelineCostEstimate {
  allowed:       boolean
  estimated_usd: number
  per_node:      Array<{ node_id: string; agent_name: string; estimated_usd: number }>
  warning?:      string   // shown in UI if estimate is high
  block_reason?: string   // if blocked (credit balance too low)
}

export function estimatePipelineCost(params: {
  nodes: Array<{
    node_id:    string
    agent_id:   string
    agent_name: string
    model_name: string
    max_tokens: number
    system_prompt: string
  }>
  inputText:     string
  creditBalance: number
}): PipelineCostEstimate {
  const { nodes, inputText, creditBalance } = params

  const PLATFORM_MARGIN = 3  // users pay 3× actual LLM cost
  const perNode: PipelineCostEstimate["per_node"] = []
  let totalUsd = 0

  for (const node of nodes) {
    const rates = MODEL_COSTS[node.model_name] ?? MODEL_COSTS["default"]

    // Conservative: assume each node receives the full input + system prompt
    const estimatedInputTokens  = Math.ceil((inputText.length + node.system_prompt.length) / 3.5)
    // Assume max_tokens are fully consumed (worst case billing)
    const estimatedOutputTokens = node.max_tokens

    const llmCost =
      (estimatedInputTokens  / 1000) * rates.input +
      (estimatedOutputTokens / 1000) * rates.output

    const chargedCost = llmCost * PLATFORM_MARGIN

    perNode.push({
      node_id:       node.node_id,
      agent_name:    node.agent_name,
      estimated_usd: parseFloat(chargedCost.toFixed(6)),
    })

    totalUsd += chargedCost
  }

  const HIGH_COST_THRESHOLD    = 1.00   // warn at $1
  const BLOCK_IF_BALANCE_BELOW = 0.10   // block if balance < $0.10

  if (creditBalance < BLOCK_IF_BALANCE_BELOW && totalUsd > 0) {
    return {
      allowed:       false,
      estimated_usd: parseFloat(totalUsd.toFixed(6)),
      per_node:      perNode,
      block_reason:  `Your credit balance ($${creditBalance.toFixed(2)}) is too low. ` +
                     `This pipeline is estimated to cost $${totalUsd.toFixed(4)}. ` +
                     `Top up your credits to continue.`,
    }
  }

  if (creditBalance < totalUsd) {
    return {
      allowed:       false,
      estimated_usd: parseFloat(totalUsd.toFixed(6)),
      per_node:      perNode,
      block_reason:  `Insufficient credits. Estimated cost: $${totalUsd.toFixed(4)}, ` +
                     `balance: $${creditBalance.toFixed(4)}.`,
    }
  }

  return {
    allowed:       true,
    estimated_usd: parseFloat(totalUsd.toFixed(6)),
    per_node:      perNode,
    warning:       totalUsd > HIGH_COST_THRESHOLD
      ? `⚠️ This pipeline is estimated to cost $${totalUsd.toFixed(4)}. ` +
        `Your current balance is $${creditBalance.toFixed(4)}.`
      : undefined,
  }
}
