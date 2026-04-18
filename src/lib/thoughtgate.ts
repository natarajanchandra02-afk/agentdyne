/**
 * ThoughtGate — Cognitive Execution Engine for AgentDyne
 *
 * ThoughtGate is the cognition optimization layer that sits between the
 * user query and the LLM execution. It does NOT optimize tokens — it
 * optimizes HOW the LLM thinks, reducing redundant reasoning and cost.
 *
 * Core components (all pure functions, zero external deps, edge-native):
 *
 *   1. Intent Detector        — classifies query intent + depth
 *   2. Thought Reuse Engine   — matches query to cached reasoning patterns
 *   3. Token Budget Controller — allocates token budget based on intent
 *   4. Predictive Context Hints — suggests what context to preload
 *   5. Intent Preservation Score — post-execution quality signal
 *
 * Pipeline:
 *   query → Intent Detect → Pattern Match → Budget Allocate → Enhanced Prompt → LLM
 *
 * This is a Phase-1 implementation: pattern-based + heuristic matching.
 * No ML inference required — the reasoning reuse is structural, not semantic.
 * Phase 2 will add vector-based template matching once templates accumulate.
 *
 * Positioning: "We reduce LLM thinking cost, not just token cost."
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type IntentType =
  | "rag"          // Retrieval-augmented: answer from knowledge base
  | "analysis"     // Deep analysis: compare, evaluate, assess
  | "agent"        // Tool use / execution: do something, take action
  | "creative"     // Open-ended generation: write, create, draft
  | "quick"        // Simple fact / quick answer
  | "code"         // Code generation or debugging
  | "transform"    // Format conversion: summarize, translate, extract

export type IntentDepth = "low" | "medium" | "high"

export interface Intent {
  type:        IntentType
  depth:       IntentDepth
  confidence:  number       // 0–1
  signals:     string[]     // Which patterns triggered this classification
}

export interface ThoughtTemplate {
  id:           string
  name:         string
  intentType:   IntentType
  pattern:      string        // Natural language description of the query pattern
  steps:        string[]      // Ordered reasoning steps to inject
  successRate:  number        // 0–1 (starts at 0.8, updated via feedback)
  usageCount:   number
  domains:      string[]      // e.g. ["finance", "general", "code"]
  version:      number
  minSimilarity: number       // Minimum signal overlap to apply (0–1)
}

export interface TokenBudget {
  system:   number    // Tokens for system prompt (including injected steps)
  context:  number    // Tokens for RAG/memory context
  user:     number    // Tokens for user message
  output:   number    // Max tokens for LLM output
  total:    number    // system + context + user + output
}

export interface PredictiveHints {
  likelyFollowUps:    string[]    // Predicted next queries
  suggestedTools:     string[]    // MCP tools likely needed
  contextPriority:    string[]    // RAG queries to preload, ranked
  preloadKnowledge:   boolean     // Whether to trigger RAG before LLM call
}

export interface ThoughtGateResult {
  // Intent classification
  intent:          Intent

  // Thought template (if matched)
  template?:       ThoughtTemplate
  templateApplied: boolean

  // Enhanced system prompt (with reasoning steps injected)
  enhancedSystemPrompt: string

  // Token budget
  budget:          TokenBudget

  // Predictive hints for next turn
  hints:           PredictiveHints

  // Metrics
  estimatedSavingsRatio: number   // 0–1: estimated reduction in reasoning overhead
}

export interface ThoughtGateMetrics {
  intentType:           string
  intentDepth:          string
  templateUsed?:        string
  tokenBudgetUsed:      number
  tokenBudgetAllocated: number
  intentPreservation?:  number   // Filled in post-execution
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN THOUGHT TEMPLATES
// These encode common reasoning patterns so the LLM doesn't recompute from scratch
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_TEMPLATES: ThoughtTemplate[] = [
  {
    id: "compare_x_vs_y",
    name: "Compare two things",
    intentType: "analysis",
    pattern: "compare X vs Y",
    minSimilarity: 0.6,
    steps: [
      "Define the subject of comparison clearly",
      "Identify the key dimensions to compare (cost, performance, usability, etc.)",
      "Evaluate each option on each dimension objectively",
      "Summarise trade-offs: when to choose X vs Y",
      "State a clear conclusion based on the user's likely context",
    ],
    successRate: 0.88,
    usageCount: 0,
    domains: ["general", "technology", "finance", "products"],
    version: 1,
  },
  {
    id: "extract_structured",
    name: "Extract structured data",
    intentType: "transform",
    pattern: "extract or parse structured data from text",
    minSimilarity: 0.65,
    steps: [
      "Identify what entities, fields, or data points need to be extracted",
      "Scan the input systematically for each required field",
      "Normalize values to the expected format (dates, numbers, strings)",
      "Flag any fields that could not be extracted with a null or 'not found'",
      "Return the result as a structured JSON object",
    ],
    successRate: 0.92,
    usageCount: 0,
    domains: ["general", "data", "finance"],
    version: 1,
  },
  {
    id: "summarise_document",
    name: "Summarise a document",
    intentType: "transform",
    pattern: "summarize or condense a piece of text",
    minSimilarity: 0.7,
    steps: [
      "Identify the main topic and purpose of the document",
      "Extract the key points, arguments, or findings",
      "Note any important data, numbers, or conclusions",
      "Write a concise summary that preserves the essential meaning",
      "Optionally list bullet-point key takeaways",
    ],
    successRate: 0.91,
    usageCount: 0,
    domains: ["general", "research", "legal", "news"],
    version: 1,
  },
  {
    id: "debug_code",
    name: "Debug and fix code",
    intentType: "code",
    pattern: "debug, fix, or explain why code doesn't work",
    minSimilarity: 0.6,
    steps: [
      "Read and understand what the code is supposed to do",
      "Identify syntax errors or obvious logical mistakes",
      "Trace the execution flow to find where it breaks",
      "Determine the root cause (not just the symptom)",
      "Provide a corrected version with an explanation of the fix",
    ],
    successRate: 0.85,
    usageCount: 0,
    domains: ["code", "technology"],
    version: 1,
  },
  {
    id: "generate_code",
    name: "Generate code from specification",
    intentType: "code",
    pattern: "write code that does X",
    minSimilarity: 0.6,
    steps: [
      "Clarify the language, framework, and requirements",
      "Plan the structure (functions, classes, interfaces) before writing",
      "Implement the core logic first",
      "Add error handling and edge cases",
      "Return clean, documented code with usage examples",
    ],
    successRate: 0.83,
    usageCount: 0,
    domains: ["code"],
    version: 1,
  },
  {
    id: "answer_from_knowledge",
    name: "Answer from knowledge base",
    intentType: "rag",
    pattern: "answer a question using retrieved documents or context",
    minSimilarity: 0.7,
    steps: [
      "Review the provided context documents",
      "Identify which parts are directly relevant to the question",
      "Formulate an answer based strictly on the context",
      "Cite the source documents using [1], [2] notation",
      "Clearly state if the answer cannot be found in the provided context",
    ],
    successRate: 0.90,
    usageCount: 0,
    domains: ["general", "research", "support"],
    version: 1,
  },
  {
    id: "classify_input",
    name: "Classify or categorise input",
    intentType: "analysis",
    pattern: "classify, categorise, or label an input",
    minSimilarity: 0.65,
    steps: [
      "Review the available categories or labels",
      "Identify the key features of the input relevant to classification",
      "Match the input features to the closest category",
      "Provide a confidence score if applicable",
      "Explain the reasoning for the classification",
    ],
    successRate: 0.87,
    usageCount: 0,
    domains: ["general", "data", "content-moderation"],
    version: 1,
  },
  {
    id: "plan_and_execute",
    name: "Plan and execute a multi-step task",
    intentType: "agent",
    pattern: "plan and carry out a complex multi-step task using tools",
    minSimilarity: 0.55,
    steps: [
      "Break the goal into discrete, actionable steps",
      "Identify which tools are needed for each step",
      "Execute steps in order, checking output before proceeding",
      "Handle failures gracefully — retry or find alternatives",
      "Summarise what was accomplished and any items that need follow-up",
    ],
    successRate: 0.79,
    usageCount: 0,
    domains: ["agent", "automation"],
    version: 1,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// INTENT DETECTOR
// Pattern-based classification — no ML required, runs in <1ms
// ─────────────────────────────────────────────────────────────────────────────

interface IntentSignal {
  type:    IntentType
  depth:   IntentDepth
  pattern: RegExp
  weight:  number
  signal:  string
}

const INTENT_SIGNALS: IntentSignal[] = [
  // RAG / retrieval
  { type: "rag", depth: "medium", weight: 3, signal: "find_in_docs",
    pattern: /(?:according to|based on|from the|in the|find in|look up|search for|retrieve)/i },
  { type: "rag", depth: "medium", weight: 2, signal: "knowledge_query",
    pattern: /(?:what does .+ say about|what is written about|reference|cite)/i },

  // Analysis — high depth
  { type: "analysis", depth: "high", weight: 4, signal: "compare_vs",
    pattern: /\b(?:compare|versus|vs\.?|difference between|pros and cons|trade.?off|contrast)\b/i },
  { type: "analysis", depth: "high", weight: 3, signal: "evaluate",
    pattern: /\b(?:evaluate|assess|analyse|analyze|review|critique|audit|benchmark)\b/i },
  { type: "analysis", depth: "medium", weight: 2, signal: "explain_why",
    pattern: /\b(?:why|explain|reason|cause|because|how does)\b/i },

  // Agent / tool use
  { type: "agent", depth: "high", weight: 5, signal: "take_action",
    pattern: /\b(?:create|send|post|update|delete|deploy|run|execute|automate|trigger|schedule)\b/i },
  { type: "agent", depth: "medium", weight: 3, signal: "use_tool",
    pattern: /\b(?:using|via|through|with|call|invoke|integrate)\b.{0,40}\b(?:api|tool|service|webhook)\b/i },

  // Code
  { type: "code", depth: "high", weight: 5, signal: "write_code",
    pattern: /\b(?:write|generate|create|build|implement)\b.{0,30}\b(?:code|function|class|script|module|component|query|sql)\b/i },
  { type: "code", depth: "high", weight: 4, signal: "debug_code",
    pattern: /\b(?:debug|fix|error|bug|exception|crash|broken|doesn't work|not working)\b/i },
  { type: "code", depth: "medium", weight: 3, signal: "explain_code",
    pattern: /\b(?:explain|what does|how does)\b.{0,50}\b(?:code|function|snippet|line|method)\b/i },

  // Transform
  { type: "transform", depth: "medium", weight: 4, signal: "summarize",
    pattern: /\b(?:summarize|summarise|tldr|condense|shorten|brief|synopsis)\b/i },
  { type: "transform", depth: "medium", weight: 4, signal: "translate",
    pattern: /\b(?:translate|convert|transform|rewrite|reformat|extract|parse)\b/i },

  // Creative
  { type: "creative", depth: "medium", weight: 3, signal: "generate_content",
    pattern: /\b(?:write a|draft|compose|create a|generate)\b.{0,30}\b(?:email|post|article|blog|story|caption|tweet|message)\b/i },

  // Quick / simple
  { type: "quick", depth: "low", weight: 3, signal: "simple_fact",
    pattern: /^(?:what is|who is|when is|where is|how many|what are).{0,40}\??\s*$/i },
  { type: "quick", depth: "low", weight: 2, signal: "yes_no",
    pattern: /^(?:is|are|can|does|do|has|have|will|should|would)\b.{0,60}\??\s*$/i },
]

export function detectIntent(query: string): Intent {
  if (!query || typeof query !== "string") {
    return { type: "quick", depth: "low", confidence: 0.5, signals: [] }
  }

  const scores: Record<IntentType, number> = {
    rag: 0, analysis: 0, agent: 0, creative: 0, quick: 0, code: 0, transform: 0,
  }
  const firedSignals: string[] = []

  for (const sig of INTENT_SIGNALS) {
    if (sig.pattern.test(query)) {
      scores[sig.type] = (scores[sig.type] ?? 0) + sig.weight
      firedSignals.push(sig.signal)
    }
  }

  // Find winning intent
  let topType: IntentType = "quick"
  let topScore = 0
  for (const [type, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score
      topType  = type as IntentType
    }
  }

  // Compute depth from query length + complexity signals
  const depth = computeDepth(query, topType, topScore)

  // Confidence = winning score / sum of all scores (normalized)
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0)
  const confidence = totalScore > 0 ? Math.min(0.98, topScore / totalScore) : 0.5

  return { type: topType, depth, confidence, signals: firedSignals }
}

function computeDepth(query: string, type: IntentType, score: number): IntentDepth {
  const words = query.trim().split(/\s+/).length

  // Short queries are almost always quick
  if (words < 8 && type === "quick") return "low"

  // Complexity markers → high depth
  const highComplexity = /\b(?:comprehensive|detailed|in-depth|step.by.step|complete|thorough|multi.step|complex)\b/i
  if (highComplexity.test(query)) return "high"

  // Code and analysis default to medium/high
  if (type === "code" || type === "analysis") {
    return words > 20 || score >= 4 ? "high" : "medium"
  }

  // Agent tasks are always at least medium
  if (type === "agent") return score >= 5 ? "high" : "medium"

  // Default by word count
  if (words < 12) return "low"
  if (words < 40) return "medium"
  return "high"
}

// ─────────────────────────────────────────────────────────────────────────────
// THOUGHT TEMPLATE MATCHER
// Matches the query to a built-in reasoning template
// ─────────────────────────────────────────────────────────────────────────────

function computeSignalOverlap(query: string, template: ThoughtTemplate): number {
  // Count how many intent signals that fired are relevant to this template's type
  const typeSignals = INTENT_SIGNALS.filter(s => s.type === template.intentType)
  let matched = 0
  for (const sig of typeSignals) {
    if (sig.pattern.test(query)) matched++
  }
  return typeSignals.length > 0 ? matched / typeSignals.length : 0
}

function matchTemplate(
  query:  string,
  intent: Intent,
  customTemplates: ThoughtTemplate[] = []
): ThoughtTemplate | undefined {
  const allTemplates = [...BUILT_IN_TEMPLATES, ...customTemplates]

  // Filter to templates matching the detected intent type
  const candidates = allTemplates.filter(t => t.intentType === intent.type)
  if (candidates.length === 0) return undefined

  // Score each candidate by signal overlap
  let best: ThoughtTemplate | undefined
  let bestScore = 0

  for (const template of candidates) {
    const overlap = computeSignalOverlap(query, template)
    if (overlap >= template.minSimilarity && overlap > bestScore) {
      bestScore = overlap
      best      = template
    }
  }

  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN BUDGET CONTROLLER
// Intent-aware allocation — prevents over-compression on deep reasoning
// ─────────────────────────────────────────────────────────────────────────────

const BUDGET_PROFILES: Record<IntentType, Record<IntentDepth, Omit<TokenBudget, "total">>> = {
  quick:    { low: { system: 512,  context: 512,   user: 256,  output: 512   },
              medium: { system: 1024, context: 1024,  user: 512,  output: 1024  },
              high:   { system: 2048, context: 2048,  user: 1024, output: 2048  } },
  rag:      { low: { system: 1024, context: 2048,  user: 512,  output: 1024  },
              medium: { system: 1024, context: 4096,  user: 512,  output: 2048  },
              high:   { system: 2048, context: 6144,  user: 1024, output: 4096  } },
  analysis: { low: { system: 1024, context: 1024,  user: 512,  output: 2048  },
              medium: { system: 2048, context: 2048,  user: 1024, output: 3072  },
              high:   { system: 2048, context: 2048,  user: 2048, output: 4096  } },
  agent:    { low: { system: 2048, context: 1024,  user: 512,  output: 1024  },
              medium: { system: 2048, context: 2048,  user: 1024, output: 2048  },
              high:   { system: 4096, context: 2048,  user: 2048, output: 4096  } },
  creative: { low: { system: 512,  context: 256,   user: 512,  output: 1024  },
              medium: { system: 1024, context: 512,   user: 1024, output: 2048  },
              high:   { system: 1024, context: 512,   user: 2048, output: 4096  } },
  code:     { low: { system: 1024, context: 512,   user: 512,  output: 2048  },
              medium: { system: 2048, context: 1024,  user: 1024, output: 4096  },
              high:   { system: 2048, context: 2048,  user: 2048, output: 4096  } },
  transform:{ low: { system: 512,  context: 1024,  user: 1024, output: 1024  },
              medium: { system: 1024, context: 2048,  user: 2048, output: 2048  },
              high:   { system: 1024, context: 4096,  user: 4096, output: 3072  } },
}

function allocateBudget(intent: Intent, agentMaxTokens: number): TokenBudget {
  const profile = BUDGET_PROFILES[intent.type]?.[intent.depth]
    ?? BUDGET_PROFILES["quick"]!["medium"]!

  // Respect agent's configured max output tokens
  const outputTokens = Math.min(profile.output, agentMaxTokens)

  return {
    system:  profile.system,
    context: profile.context,
    user:    profile.user,
    output:  outputTokens,
    total:   profile.system + profile.context + profile.user + outputTokens,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTIVE CONTEXT HINTS
// Predicts what context and tools will be needed before they're requested
// ─────────────────────────────────────────────────────────────────────────────

function buildPredictiveHints(query: string, intent: Intent): PredictiveHints {
  const hints: PredictiveHints = {
    likelyFollowUps:  [],
    suggestedTools:   [],
    contextPriority:  [],
    preloadKnowledge: false,
  }

  switch (intent.type) {
    case "rag":
      hints.preloadKnowledge  = true
      hints.contextPriority   = [query]
      hints.likelyFollowUps   = ["tell me more", "explain in detail", "give me examples"]
      break

    case "analysis":
      hints.likelyFollowUps   = ["what are the trade-offs", "which should I choose", "give me a recommendation"]
      hints.suggestedTools    = ["web_navigate"]
      break

    case "agent":
      hints.suggestedTools    = ["supabase_query", "slack_post_message", "github_create_issue", "gmail_send"]
      hints.likelyFollowUps   = ["was it successful", "show me the result", "do it again for all items"]
      break

    case "code":
      hints.likelyFollowUps   = ["add tests", "optimize this", "explain the code", "add error handling"]
      hints.suggestedTools    = ["github_search_code"]
      break

    case "transform":
      hints.likelyFollowUps   = ["also extract X", "format as Y", "do the same for these items"]
      break

    case "creative":
      hints.likelyFollowUps   = ["make it shorter", "add more detail", "change the tone to X"]
      break

    case "quick":
      hints.likelyFollowUps   = ["explain more", "give examples", "how does this relate to Y"]
      break
  }

  return hints
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT ENHANCER
// Injects reasoning steps from the matched template into the system prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildEnhancedSystemPrompt(
  baseSystemPrompt: string,
  intent:           Intent,
  template?:        ThoughtTemplate,
): string {
  if (!template || intent.depth === "low") {
    // Quick queries: don't inject reasoning overhead — return base prompt
    return baseSystemPrompt
  }

  const stepsBlock = [
    "",
    "<reasoning_protocol>",
    `Intent: ${intent.type} | Depth: ${intent.depth}`,
    "Apply this structured reasoning approach:",
    ...template.steps.map((step, i) => `  ${i + 1}. ${step}`),
    "</reasoning_protocol>",
    "",
  ].join("\n")

  // Inject AFTER the base system prompt (so seller instructions take priority)
  return baseSystemPrompt + stepsBlock
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT PRESERVATION SCORE (post-execution quality signal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute how well the LLM output preserves the user's original intent.
 * Simple heuristic: keyword overlap + output length appropriateness.
 * Range: 0–1. Enterprise-grade: 0.85+.
 */
export function computeIntentPreservation(
  query:  string,
  output: string,
  intent: Intent
): number {
  if (!output || !query) return 0

  const queryWords = new Set(
    query.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  )
  const outputWords = new Set(
    output.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  )

  // Keyword coverage: what fraction of query concepts appear in output
  let covered = 0
  for (const word of queryWords) {
    if (outputWords.has(word)) covered++
  }
  const keywordScore = queryWords.size > 0 ? covered / queryWords.size : 1.0

  // Length appropriateness: penalize very short outputs on deep queries
  const outputWords_count = output.trim().split(/\s+/).length
  let lengthScore = 1.0
  if (intent.depth === "high"  && outputWords_count < 50)  lengthScore = 0.6
  if (intent.depth === "medium"&& outputWords_count < 20)  lengthScore = 0.7
  if (intent.depth === "low"   && outputWords_count > 500) lengthScore = 0.9 // not a penalty, just discount

  // Weighted combination
  const score = keywordScore * 0.6 + lengthScore * 0.4
  return parseFloat(Math.min(1, score).toFixed(3))
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export interface ThoughtGateInput {
  query:            string
  baseSystemPrompt: string
  agentMaxTokens?:  number        // Agent's configured max_tokens
  customTemplates?: ThoughtTemplate[]  // Agent-specific templates (from DB)
  ragEnabled?:      boolean       // Whether this agent has RAG configured
  disabled?:        boolean       // Pass true to bypass ThoughtGate entirely
}

/**
 * process — the main ThoughtGate pipeline.
 *
 * Call this BEFORE the LLM execution.
 * Returns an enhanced system prompt + token budget + hints.
 *
 * Example:
 *   const tg = thoughtgate.process({ query, baseSystemPrompt, agentMaxTokens: 4096 })
 *   const result = await routeCompletion({ ..., system: tg.enhancedSystemPrompt, maxTokens: tg.budget.output })
 *   tg.metrics.intentPreservation = computeIntentPreservation(query, result.text, tg.intent)
 */
export function process(input: ThoughtGateInput): ThoughtGateResult {
  const {
    query,
    baseSystemPrompt,
    agentMaxTokens   = 4096,
    customTemplates  = [],
    ragEnabled       = false,
    disabled         = false,
  } = input

  // Bypass — used for very short queries or when seller disables ThoughtGate
  if (disabled || !query?.trim()) {
    return bypassResult(baseSystemPrompt, agentMaxTokens)
  }

  // 1. Detect intent
  const intent = detectIntent(query)

  // 2. Match thought template
  const template       = matchTemplate(query, intent, customTemplates)
  const templateApplied = !!template

  // 3. Allocate token budget based on intent
  const budget = allocateBudget(intent, agentMaxTokens)

  // 4. Build enhanced system prompt
  const enhancedSystemPrompt = buildEnhancedSystemPrompt(baseSystemPrompt, intent, template)

  // 5. Predictive hints
  const hints = buildPredictiveHints(query, intent)

  // If RAG is not enabled, don't suggest preloading
  if (!ragEnabled) hints.preloadKnowledge = false

  // 6. Estimated savings (heuristic)
  const estimatedSavingsRatio = template
    ? Math.min(0.6, template.successRate * 0.4 + (intent.depth === "high" ? 0.2 : 0.1))
    : 0

  return {
    intent,
    template,
    templateApplied,
    enhancedSystemPrompt,
    budget,
    hints,
    estimatedSavingsRatio,
  }
}

function bypassResult(baseSystemPrompt: string, agentMaxTokens: number): ThoughtGateResult {
  const intent: Intent = { type: "quick", depth: "low", confidence: 1, signals: [] }
  return {
    intent,
    template: undefined,
    templateApplied: false,
    enhancedSystemPrompt: baseSystemPrompt,
    budget: {
      system: 1024, context: 1024, user: 512,
      output: agentMaxTokens,
      total:  1024 + 1024 + 512 + agentMaxTokens,
    },
    hints: { likelyFollowUps: [], suggestedTools: [], contextPriority: [], preloadKnowledge: false },
    estimatedSavingsRatio: 0,
  }
}

/** Build the ThoughtGate metrics object to include in ExecutionResult */
export function buildMetrics(tg: ThoughtGateResult, tokenBudgetUsed: number): ThoughtGateMetrics {
  return {
    intentType:           tg.intent.type,
    intentDepth:          tg.intent.depth,
    templateUsed:         tg.template?.id,
    tokenBudgetUsed,
    tokenBudgetAllocated: tg.budget.output,
  }
}
