/**
 * @module executionEngine
 * @path   src/core/execution/executionEngine.ts
 *
 * Central Execution Coordinator — the single source of truth for running agents.
 *
 * This is the high-level orchestrator that wires together:
 *   costEstimator → budgetValidator → modelSelector → AI call → costReconciler
 *
 * Both the /api/agents/[id]/execute route AND the pipeline executor
 * should use this instead of duplicate logic.
 *
 * Kill switches (hard limits enforced regardless of plan):
 *   - MAX_EXECUTION_TOKENS: 32,768 tokens total (input + output)
 *   - MAX_EXECUTION_COST_USD: $10.00 per single execution
 *   - MAX_EXECUTION_TIMEOUT_MS: 120,000ms (2 minutes)
 *   - MAX_TOOL_LOOPS: 8 (MCP tool-use rounds)
 *
 * Edge-runtime safe: no Node.js APIs.
 */

import { estimateCost, reconcileActualCost, PLATFORM_MARGIN } from "./costEstimator"
import { validateBudget, type BudgetValidationInput } from "./budgetValidator"
import { selectModel, type ModelSelectionInput } from "@/core/router/modelSelector"
import { routeCompletion, routeStream, type LLMCallParams } from "@/lib/model-router"
import { checkInput, processOutput } from "@/lib/guardrails"
import { runInjectionPipeline } from "@/lib/injection-filter"
import { compressToTokenBudget } from "@/lib/context-compression"
import { thoughtGate } from "@/lib/thoughtgate"

// ─── Kill switches ────────────────────────────────────────────────────────────

export const KILL_SWITCHES = {
  MAX_EXECUTION_TOKENS:     32_768,   // total tokens (in + out)
  MAX_EXECUTION_COST_USD:   10.00,    // absolute ceiling regardless of plan
  MAX_EXECUTION_TIMEOUT_MS: 120_000,  // 2 minutes
  MAX_TOOL_LOOPS:           8,        // MCP tool-use rounds
  MAX_INPUT_CHARS:          120_000,  // ~30K tokens input hard cap
} as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  id:             string
  name:           string
  model_name:     string
  system_prompt:  string
  max_tokens:     number
  temperature:    number
  pricing_model:  string
  price_per_call: number
  output_schema?: Record<string, unknown>
  knowledge_base_id?: string
  mcp_server_ids?: string[]
}

export interface ExecutionRequest {
  agent:         AgentConfig
  userMessage:   string
  userId:        string
  plan:          string
  creditBalance: number
  profileRow: {
    is_banned:                  boolean
    subscription_plan:          string | null
    monthly_execution_quota:    number | null
    executions_used_this_month: number | null
  }
  creditsRow:    { balance_usd: number } | null
  stream?:       boolean
  // Enriched system prompt (RAG already injected)
  enrichedSystemPrompt?: string
}

export type ExecutionStatus =
  | "queued"
  | "validating"
  | "estimating"
  | "running"
  | "success"
  | "failed"
  | "killed"
  | "quota_exceeded"
  | "insufficient_credits"

export interface ExecutionResult {
  status:        ExecutionStatus
  output:        unknown
  outputText:    string
  inputTokens:   number
  outputTokens:  number
  latencyMs:     number
  rawCostUsd:    number
  userCostUsd:   number
  resolvedModel: string
  modelChanged:  boolean
  flagged:       boolean
  error?:        string
  errorCode?:    string
  httpStatus?:   number
}

// ─── Execution Engine ─────────────────────────────────────────────────────────

/**
 * executeAgent
 *
 * Full execution pipeline in one call:
 *   1. Input validation (guardrails + injection filter)
 *   2. Kill switch checks (size, cost)
 *   3. Budget validation (credits + plan)
 *   4. Model selection (downgrade if needed)
 *   5. Context compression (token budget)
 *   6. ThoughtGate (intent detection + token budget)
 *   7. AI call
 *   8. Output processing (scrub + validate)
 *   9. Cost reconciliation
 *
 * @example
 * const result = await executeAgent({ agent, userMessage, userId, ... })
 * if (result.status !== "success") {
 *   return NextResponse.json({ error: result.error, code: result.errorCode }, { status: result.httpStatus })
 * }
 */
export async function executeAgent(req: ExecutionRequest): Promise<ExecutionResult> {
  const startMs = Date.now()

  const {
    agent,
    userMessage,
    userId,
    plan,
    creditBalance,
    profileRow,
    creditsRow,
    enrichedSystemPrompt,
  } = req

  // ── STEP 1: Input validation ────────────────────────────────────────────

  // Hard size kill switch (before any DB calls)
  if (new TextEncoder().encode(userMessage).length > KILL_SWITCHES.MAX_INPUT_CHARS) {
    return fail("Input exceeds maximum size limit.", "INPUT_TOO_LARGE", 413, "killed", startMs)
  }

  const guardrailResult = checkInput(userMessage)
  const { filterResult, score } = runInjectionPipeline(userMessage, "user")

  if (!guardrailResult.allowed || !filterResult.allowed) {
    return fail(
      "Input was rejected by content policy.",
      "GUARDRAIL_BLOCKED", 400, "failed", startMs
    )
  }

  // ── STEP 2: Cost estimation ────────────────────────────────────────────

  const systemPrompt = enrichedSystemPrompt ?? agent.system_prompt
  const estimate = estimateCost({
    inputText:    userMessage,
    systemPrompt,
    model:        agent.model_name,
    maxTokens:    agent.max_tokens,
  })

  // Absolute cost kill switch
  if (estimate.worstCaseCostUsd > KILL_SWITCHES.MAX_EXECUTION_COST_USD) {
    return fail(
      `Execution cost ($${estimate.worstCaseCostUsd.toFixed(2)}) exceeds platform maximum.`,
      "COST_KILL_SWITCH", 402, "killed", startMs
    )
  }

  // ── STEP 3: Budget validation ──────────────────────────────────────────

  const budgetInput: BudgetValidationInput = {
    profile:          profileRow,
    credits:          creditsRow,
    worstCaseCostUsd: estimate.worstCaseCostUsd,
    requestedModel:   agent.model_name,
  }

  const budgetResult = validateBudget(budgetInput)
  if (!budgetResult.ok) {
    return fail(budgetResult.message, budgetResult.code, budgetResult.httpStatus, budgetResult.code as ExecutionStatus, startMs)
  }

  // ── STEP 4: Model selection ────────────────────────────────────────────

  const modelSelection = selectModel({
    requestedModel:  agent.model_name,
    plan:            plan as any,
    estimatedTokens: estimate.tokensInputEst,
    creditBalance,
    taskComplexity:  estimate.modelTier === "premium" ? "high" : estimate.modelTier === "standard" ? "medium" : "low",
  })

  const resolvedModel = budgetResult.fallbackModel ?? modelSelection.model
  const modelChanged  = resolvedModel !== agent.model_name

  // ── STEP 5: Context compression ────────────────────────────────────────

  const { systemPrompt: compressedSystem, userMessage: compressedUser } =
    compressToTokenBudget(systemPrompt, userMessage, 14_000)

  // ── STEP 6: ThoughtGate ────────────────────────────────────────────────

  const tg = thoughtGate.process({
    query:            compressedUser,
    configuredTokens: Math.min(agent.max_tokens, KILL_SWITCHES.MAX_EXECUTION_TOKENS),
  })

  const finalSystem = compressedSystem + (tg.systemAddendum ?? "")
  const finalTokens = tg.tokenBudget

  // ── STEP 7: AI call ────────────────────────────────────────────────────

  const params: LLMCallParams = {
    model:       resolvedModel,
    system:      finalSystem,
    userMessage: compressedUser,
    maxTokens:   finalTokens,
    temperature: agent.temperature ?? 0.7,
  }

  let rawText = "", inputTok = 0, outputTok = 0

  try {
    const result = await routeCompletion(params)
    rawText  = result.text
    inputTok = result.inputTokens
    outputTok = result.outputTokens
  } catch (err: any) {
    return fail(
      `AI provider error: ${err.message ?? "Unknown"}`,
      "AI_PROVIDER_ERROR", 502, "failed", startMs
    )
  }

  // ── STEP 8: Output processing ──────────────────────────────────────────

  const { safe: safeText, scrub, parsed } = processOutput(rawText, agent.output_schema)
  const output = parsed.isJSON ? parsed.parsed : safeText

  // ── STEP 9: Cost reconciliation ────────────────────────────────────────

  const actual = reconcileActualCost(resolvedModel, inputTok, outputTok)

  return {
    status:        "success",
    output,
    outputText:    safeText,
    inputTokens:   inputTok,
    outputTokens:  outputTok,
    latencyMs:     Date.now() - startMs,
    rawCostUsd:    actual.rawCostUsd,
    userCostUsd:   actual.userCostUsd,
    resolvedModel,
    modelChanged,
    flagged:       scrub.flagged,
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function fail(
  message:    string,
  errorCode:  string,
  httpStatus: number,
  status:     ExecutionStatus,
  startMs:    number
): ExecutionResult {
  return {
    status,
    output:        null,
    outputText:    "",
    inputTokens:   0,
    outputTokens:  0,
    latencyMs:     Date.now() - startMs,
    rawCostUsd:    0,
    userCostUsd:   0,
    resolvedModel: "",
    modelChanged:  false,
    flagged:       false,
    error:         message,
    errorCode,
    httpStatus,
  }
}
