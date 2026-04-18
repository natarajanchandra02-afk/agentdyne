/**
 * ThoughtGate — Cognitive Execution Engine (CEE)
 *
 * The cognitive control layer that sits between user input and the LLM.
 * Optimises HOW the model thinks, not just what it processes.
 *
 * Pipeline:
 *   1. Intent Detection   — classify query type + reasoning depth
 *   2. Thought Reuse      — match against cached reasoning templates
 *   3. Token Budgeting    — allocate token budget per intent depth
 *   4. Context Structuring— build minimal effective context graph
 *
 * Result: faster, cheaper, more consistent agent responses.
 *
 * Edge-runtime safe: pure TypeScript, no Node.js APIs.
 * Zero external dependencies (uses cosine similarity in-process).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type IntentType =
  | "rag"         // Factual retrieval from knowledge base
  | "analysis"    // Deep reasoning — compare, evaluate, synthesise
  | "generation"  // Creative or structured content generation
  | "extraction"  // Extract structured data from unstructured input
  | "routing"     // Classify/route a request
  | "agent"       // Autonomous multi-step task (tool use)
  | "conversational" // Short Q&A or chat

export type IntentDepth = "low" | "medium" | "high"

export interface Intent {
  type:       IntentType
  depth:      IntentDepth
  confidence: number  // 0-1
}

export interface ThoughtTemplate {
  id:          string
  pattern:     string
  intentType:  IntentType
  steps:       string[]
  keywords:    string[]   // trigger words for fast matching
  successRate: number     // updated over time via feedback
}

export interface ThoughtGateResult {
  intent:          Intent
  templateId:      string | null
  systemAddendum:  string   // injected into system prompt
  tokenBudget:     number   // recommended max_tokens for this intent
  wasOptimised:    boolean
  savingsEstimate: number   // estimated token reduction %
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in reasoning templates
// Each template provides structured thinking steps for common task patterns.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES: ThoughtTemplate[] = [
  {
    id:          "compare_options",
    pattern:     "compare X vs Y",
    intentType:  "analysis",
    successRate: 0.92,
    keywords:    ["compare", "vs", "versus", "difference", "better", "pros cons", "trade-off"],
    steps: [
      "Define each option clearly",
      "Identify relevant comparison dimensions",
      "Evaluate each dimension per option",
      "Synthesise trade-offs",
      "Conclude with recommendation or summary",
    ],
  },
  {
    id:          "extract_structure",
    pattern:     "extract structured data from text",
    intentType:  "extraction",
    successRate: 0.95,
    keywords:    ["extract", "parse", "identify", "find", "get all", "list all"],
    steps: [
      "Identify the target entity or data type",
      "Scan input systematically for instances",
      "Normalize values to consistent format",
      "Return as structured JSON with null for missing fields",
    ],
  },
  {
    id:          "summarise_content",
    pattern:     "summarise a document or text",
    intentType:  "generation",
    successRate: 0.93,
    keywords:    ["summarise", "summarize", "summary", "tldr", "key points", "highlights"],
    steps: [
      "Identify the main topic and purpose",
      "Extract 3-5 key points",
      "Note critical data, decisions or actions",
      "Write concise summary (< 20% of original length)",
    ],
  },
  {
    id:          "classify_route",
    pattern:     "classify or categorise input",
    intentType:  "routing",
    successRate: 0.96,
    keywords:    ["classify", "categorise", "categorize", "which category", "type of", "determine"],
    steps: [
      "Read input fully",
      "Map features to defined categories",
      "Select best matching category",
      "Return category label with confidence",
    ],
  },
  {
    id:          "analyse_data",
    pattern:     "analyse data and produce insights",
    intentType:  "analysis",
    successRate: 0.88,
    keywords:    ["analyse", "analyze", "insights", "trends", "patterns", "statistics", "data"],
    steps: [
      "Understand the dataset structure and scope",
      "Identify key metrics to compute",
      "Detect trends, anomalies and patterns",
      "Generate actionable insights",
      "Recommend next steps or visualisations",
    ],
  },
  {
    id:          "answer_from_context",
    pattern:     "answer question using retrieved context",
    intentType:  "rag",
    successRate: 0.91,
    keywords:    ["based on", "according to", "from the document", "what does", "per the"],
    steps: [
      "Read the provided context carefully",
      "Identify which section(s) answer the question",
      "Cite sources by number [1], [2] etc.",
      "If context lacks the answer, say so explicitly",
    ],
  },
  {
    id:          "write_content",
    pattern:     "write or draft content",
    intentType:  "generation",
    successRate: 0.87,
    keywords:    ["write", "draft", "create", "generate", "compose", "author"],
    steps: [
      "Clarify target audience, tone and length",
      "Structure with clear opening, body, conclusion",
      "Use concrete examples where relevant",
      "Review for clarity and quality before outputting",
    ],
  },
  {
    id:          "code_review",
    pattern:     "review or analyse code",
    intentType:  "analysis",
    successRate: 0.90,
    keywords:    ["review", "code", "bug", "security", "refactor", "improve", "lint"],
    steps: [
      "Read the full code block",
      "Identify bugs and logic errors",
      "Flag security vulnerabilities",
      "Suggest performance improvements",
      "Recommend best practices",
    ],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Intent Detection
// Fast keyword + heuristic classifier — <0.5ms, no LLM call
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_SIGNALS: Record<IntentType, string[]> = {
  rag:           ["based on", "according to", "from the document", "from the knowledge", "context provided"],
  analysis:      ["compare", "analyse", "analyze", "evaluate", "assess", "pros cons", "trade-off", "review", "code"],
  generation:    ["write", "draft", "create", "generate", "compose", "author", "summarise", "summarize"],
  extraction:    ["extract", "parse", "identify all", "find all", "list all", "get all", "pull out"],
  routing:       ["classify", "categorise", "categorize", "which type", "determine if", "is this"],
  agent:         ["search", "browse", "fetch", "send", "update", "create task", "book", "schedule", "notify"],
  conversational:["what is", "how do", "explain", "tell me", "can you", "help me"],
}

const DEPTH_SIGNALS: Record<IntentDepth, string[]> = {
  low:    ["quick", "brief", "short", "one line", "tldr", "simple", "just"],
  medium: [],  // default
  high:   ["detailed", "comprehensive", "thorough", "deep dive", "in-depth", "step by step", "explain fully"],
}

function detectIntent(query: string): Intent {
  const q = query.toLowerCase()

  // Score each intent type
  const scores: Partial<Record<IntentType, number>> = {}
  for (const [type, signals] of Object.entries(INTENT_SIGNALS)) {
    const matches = signals.filter(s => q.includes(s)).length
    if (matches > 0) scores[type as IntentType] = matches
  }

  // Best match
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  const bestType = (sorted[0]?.[0] ?? "conversational") as IntentType
  const bestScore = sorted[0]?.[1] ?? 0

  // Depth detection
  let depth: IntentDepth = "medium"
  if (DEPTH_SIGNALS.high.some(s => q.includes(s))) depth = "high"
  else if (DEPTH_SIGNALS.low.some(s => q.includes(s))) depth = "low"

  // Confidence: 0.5 baseline + score contribution
  const confidence = Math.min(0.95, 0.5 + bestScore * 0.1)

  return { type: bestType, depth, confidence }
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Matching
// Keyword overlap scoring — fast, deterministic, no embeddings needed
// ─────────────────────────────────────────────────────────────────────────────

function matchTemplate(query: string, intent: Intent): ThoughtTemplate | null {
  const q = query.toLowerCase()

  const candidates = TEMPLATES
    .filter(t => t.intentType === intent.type || intent.confidence < 0.6)
    .map(t => {
      const keywordMatches = t.keywords.filter(k => q.includes(k)).length
      const score = keywordMatches * t.successRate
      return { template: t, score }
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)

  return candidates[0]?.template ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Budget Allocation
// Adaptive based on intent depth + type
// ─────────────────────────────────────────────────────────────────────────────

function allocateTokenBudget(intent: Intent, configuredMaxTokens: number): number {
  const BASE: Record<IntentType, number> = {
    rag:           1500,
    analysis:      3000,
    generation:    2500,
    extraction:    1200,
    routing:        400,
    agent:         4096,
    conversational: 800,
  }

  const DEPTH_MULT: Record<IntentDepth, number> = {
    low:    0.5,
    medium: 1.0,
    high:   1.5,
  }

  const base    = BASE[intent.type] ?? 2048
  const budget  = Math.round(base * DEPTH_MULT[intent.depth])

  // Never exceed what the agent was configured to allow
  return Math.min(budget, configuredMaxTokens)
}

// ─────────────────────────────────────────────────────────────────────────────
// System Addendum
// Structured thinking steps injected into the system prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildSystemAddendum(template: ThoughtTemplate | null, intent: Intent): string {
  if (!template && intent.depth === "low") return ""

  const lines: string[] = []

  if (template) {
    lines.push(`\n<thinking_framework>`)
    lines.push(`Follow these reasoning steps for this ${intent.type} task:`)
    template.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
    lines.push(`</thinking_framework>`)
  }

  if (intent.depth === "high") {
    lines.push(`\n<quality_requirement>`)
    lines.push(`This task requires comprehensive, detailed analysis. Take sufficient reasoning steps before concluding.`)
    lines.push(`</quality_requirement>`)
  }

  if (intent.type === "extraction") {
    lines.push(`\nAlways respond with valid JSON. Never include prose outside the JSON structure.`)
  }

  return lines.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ThoughtGateInput {
  query:             string
  configuredTokens:  number  // agent's configured max_tokens
}

/**
 * thoughtGate.process()
 *
 * Main entry point. Call before every agent LLM call.
 * Returns:
 *  - detected intent
 *  - matched thought template ID (for attribution)
 *  - system addendum to inject into system prompt
 *  - recommended token budget (often lower than configured)
 *  - wasOptimised flag
 */
export const thoughtGate = {
  process(input: ThoughtGateInput): ThoughtGateResult {
    const { query, configuredTokens } = input

    const intent    = detectIntent(query)
    const template  = matchTemplate(query, intent)
    const addendum  = buildSystemAddendum(template, intent)
    const budget    = allocateTokenBudget(intent, configuredTokens)

    // Savings estimate: how much less we're budgeting vs configured
    const savings   = configuredTokens > 0
      ? Math.max(0, Math.round(((configuredTokens - budget) / configuredTokens) * 100))
      : 0

    return {
      intent,
      templateId:      template?.id ?? null,
      systemAddendum:  addendum,
      tokenBudget:     budget,
      wasOptimised:    !!template || budget < configuredTokens,
      savingsEstimate: savings,
    }
  },

  /** Return all built-in templates (for registry API) */
  getTemplates(): ThoughtTemplate[] {
    return TEMPLATES
  },

  /** Update template success rate (called by RLHF feedback) */
  updateTemplateSuccessRate(templateId: string, success: boolean): void {
    const t = TEMPLATES.find(t => t.id === templateId)
    if (!t) return
    // Exponential moving average: alpha = 0.05 (slow adaptation)
    t.successRate = t.successRate * 0.95 + (success ? 1 : 0) * 0.05
  },
}
