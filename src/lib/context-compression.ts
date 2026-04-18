/**
 * Context Compression + Cost-Optimal Model Selection
 *
 * Two utilities wired into the agent execute route:
 *
 * 1. compressToTokenBudget — trims system prompt + user message to fit
 *    within a token budget, preventing over-spend and context overflow.
 *
 * 2. cheapestModelForTask — given the preferred model and estimated
 *    input tokens, downgrades to a cheaper model when the task is simple
 *    enough that the premium model adds no value.
 *
 * Edge-runtime safe: pure TypeScript, no Node.js APIs.
 */

export interface CompressedContext {
  systemPrompt: string
  userMessage:  string
  wasCompressed: boolean
  estimatedTokens: number
}

/**
 * compressToTokenBudget
 *
 * Fits system prompt + user message within a total character budget
 * (proxy for token budget at ~4 chars/token).
 *
 * Priority: preserve userMessage over systemPrompt, since the user
 * message is the actual task. System prompt is trimmed last.
 *
 * Strategy:
 *   1. Strip leading/trailing whitespace and collapse runs of blank lines
 *   2. If still over budget, truncate the knowledge-base context block first
 *      (it's injected between <knowledge_base_context> tags)
 *   3. If still over budget, truncate the user message
 *   4. As last resort, truncate the system prompt
 */
export function compressToTokenBudget(
  systemPrompt: string,
  userMessage:  string,
  maxTokens:    number = 14_000   // safe budget leaving ~2k tokens for output
): CompressedContext {
  const maxChars = maxTokens * 4  // ~4 chars per token (rough but safe)

  // Step 1: basic whitespace normalisation
  let sys  = normalise(systemPrompt)
  let user = normalise(userMessage)

  const totalChars = sys.length + user.length
  if (totalChars <= maxChars) {
    return { systemPrompt: sys, userMessage: user, wasCompressed: false, estimatedTokens: Math.ceil(totalChars / 4) }
  }

  // Step 2: truncate knowledge_base_context block first — it's the most expendable
  if (sys.includes("<knowledge_base_context>")) {
    const kbStart = sys.indexOf("<knowledge_base_context>")
    const kbEnd   = sys.indexOf("</knowledge_base_context>") + "</knowledge_base_context>".length
    if (kbEnd > kbStart) {
      const budget  = Math.max(2000, maxChars - user.length - (sys.length - (kbEnd - kbStart)))
      const kbBlock = sys.slice(kbStart, kbEnd)
      const truncated = kbBlock.slice(0, budget) + "\n[Context truncated for token budget]\n</knowledge_base_context>"
      sys = sys.slice(0, kbStart) + truncated + sys.slice(kbEnd)
    }
  }

  if (sys.length + user.length <= maxChars) {
    return { systemPrompt: sys, userMessage: user, wasCompressed: true, estimatedTokens: Math.ceil((sys.length + user.length) / 4) }
  }

  // Step 3: truncate user message (keep at least 1000 chars)
  const userBudget = Math.max(1000, maxChars - sys.length)
  if (user.length > userBudget) {
    user = user.slice(0, userBudget) + "\n[Input truncated]"
  }

  if (sys.length + user.length <= maxChars) {
    return { systemPrompt: sys, userMessage: user, wasCompressed: true, estimatedTokens: Math.ceil((sys.length + user.length) / 4) }
  }

  // Step 4: truncate system prompt as last resort (keep at least 500 chars)
  const sysBudget = Math.max(500, maxChars - user.length)
  sys = sys.slice(0, sysBudget) + "\n[System prompt truncated]"

  const finalChars = sys.length + user.length
  return { systemPrompt: sys, userMessage: user, wasCompressed: true, estimatedTokens: Math.ceil(finalChars / 4) }
}

function normalise(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/**
 * cheapestModelForTask
 *
 * Returns the cost-optimal model based on:
 *   - The seller's chosen model (their explicit quality choice)
 *   - Estimated input token count
 *
 * Policy (April 2026):
 *   - For very small inputs (<500 tokens) where quality difference is negligible,
 *     downgrade Sonnet→Haiku (~10x cheaper per token).
 *   - Never downgrade Opus (sellers paid for it explicitly).
 *   - Never downgrade non-Anthropic models (no equivalent cheaper option in router).
 *   - Threshold is conservative: only downgrade when we're highly confident
 *     the cheaper model is sufficient.
 */
export function cheapestModelForTask(
  preferredModel: string,
  estimatedInputTokens: number
): string {
  // Only auto-downgrade Sonnet on tiny tasks
  if (
    preferredModel === "claude-sonnet-4-20250514" &&
    estimatedInputTokens < 500
  ) {
    return "claude-haiku-4-5-20251001"
  }

  // All other models: respect seller's choice
  return preferredModel
}

/**
 * estimateTokens — quick token count estimate from character length.
 * Rule of thumb: 1 token ≈ 4 English chars, 2 code chars.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)  // slightly conservative
}
