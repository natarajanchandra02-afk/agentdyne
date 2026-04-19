/**
 * @module costReconciler
 * @path   src/core/execution/costReconciler.ts
 *
 * Post-execution cost reconciliation.
 *
 * Problem: We charge users an ESTIMATE upfront (worst-case) but actual usage
 * is usually lower. The reconciler:
 *   1. Computes actual cost from real token counts
 *   2. Calculates the delta (over-charged or under-charged)
 *   3. Issues a credit refund for over-charges above the minimum threshold
 *   4. Logs the reconciliation event for financial audit
 *   5. Updates agent analytics with true cost data
 *
 * This builds user trust — they only pay what they actually used.
 * Minimum refund threshold: $0.0001 (avoid noise transactions)
 */

import { reconcileActualCost } from "./costEstimator"

export const MIN_REFUND_THRESHOLD_USD = 0.0001

export interface ReconcileInput {
  executionId:      string
  userId:           string
  agentId:          string
  model:            string
  estimatedCostUsd: number   // what we pre-charged
  actualInputTokens:  number
  actualOutputTokens: number
  supabase:         any      // SupabaseClient — injected to keep this module testable
}

export interface ReconcileResult {
  actualRawCostUsd:  number
  actualUserCostUsd: number
  estimatedCostUsd:  number
  deltaUsd:          number   // positive = over-charged (refund), negative = under-charged
  refundIssued:      boolean
  refundAmountUsd:   number
}

/**
 * reconcileExecution
 *
 * Call after every successful execution completion.
 * Fire-and-forget safe — all errors are caught internally.
 *
 * @example
 * // In execute route after getting actual token counts:
 * reconcileExecution({ executionId, userId, agentId, model,
 *   estimatedCostUsd, actualInputTokens, actualOutputTokens, supabase
 * }).catch(() => {}) // never blocks response
 */
export async function reconcileExecution(input: ReconcileInput): Promise<ReconcileResult> {
  const {
    executionId,
    userId,
    agentId,
    model,
    estimatedCostUsd,
    actualInputTokens,
    actualOutputTokens,
    supabase,
  } = input

  const actual    = reconcileActualCost(model, actualInputTokens, actualOutputTokens)
  const delta     = estimatedCostUsd - actual.userCostUsd
  const isRefund  = delta > MIN_REFUND_THRESHOLD_USD

  // If we over-charged significantly, issue a credit refund
  let refundIssued = false
  if (isRefund) {
    try {
      // Credit back the difference
      await supabase.rpc("add_credits", {
        user_id_param:     userId,
        amount_param:      delta,
        description_param: `Reconciliation refund for execution ${executionId.slice(0, 8)}`,
        reference_id_param: executionId,
      })
      refundIssued = true
    } catch {
      // Non-fatal — log but don't fail execution
    }
  }

  // Update execution record with actual cost
  try {
    await supabase.from("executions").update({
      cost_usd:       actual.rawCostUsd,
      cost:           actual.userCostUsd,
      tokens_input:   actualInputTokens,
      tokens_output:  actualOutputTokens,
    }).eq("id", executionId)
  } catch { /* non-fatal */ }

  // Update agent analytics (actual cost for efficiency scoring)
  try {
    await supabase.rpc("update_agent_cost_analytics", {
      agent_id_param:     agentId,
      actual_cost_param:  actual.rawCostUsd,
      tokens_in_param:    actualInputTokens,
      tokens_out_param:   actualOutputTokens,
    })
  } catch { /* non-fatal */ }

  // Audit log
  try {
    await supabase.from("credit_transactions").insert({
      user_id:      userId,
      type:         "reconciliation",
      amount_usd:   -actual.userCostUsd,   // negative = debit
      balance_after: 0,                     // DB trigger recomputes
      description:  `Actual cost for execution ${executionId.slice(0, 8)}`,
      reference_id: executionId,
    })
  } catch { /* non-fatal */ }

  return {
    actualRawCostUsd:  actual.rawCostUsd,
    actualUserCostUsd: actual.userCostUsd,
    estimatedCostUsd,
    deltaUsd:          parseFloat(delta.toFixed(8)),
    refundIssued,
    refundAmountUsd:   isRefund ? parseFloat(delta.toFixed(8)) : 0,
  }
}
