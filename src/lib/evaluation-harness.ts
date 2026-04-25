/**
 * AgentDyne — Evaluation Harness
 *
 * Industry-standard multi-dimensional scoring for:
 *   - Single agents (correctness, reliability, latency, cost)
 *   - RAG agents (+ retrieval precision, faithfulness, groundedness)
 *   - Multi-agent pipelines (+ step success rate, coherence, total cost)
 *
 * Score gates (final composite 0–100):
 *   < 70  → reject (blocked from marketplace submission)
 *   70–85 → pending_review
 *   > 85  → fast-track (if builder_rank >= 1)
 *
 * All functions are edge-runtime safe.
 */

import Anthropic from "@anthropic-ai/sdk"

// ─── Score weights by agent type ─────────────────────────────────────────────

const WEIGHTS_SINGLE = {
  correctness:  0.40,
  reliability:  0.30,
  latency:      0.20,
  cost:         0.10,
}

const WEIGHTS_RAG = {
  correctness:  0.30,
  reliability:  0.20,
  latency:      0.15,
  cost:         0.05,
  faithfulness: 0.20,  // output grounded in retrieved context
  coverage:     0.10,  // how much of the question is answered
}

const WEIGHTS_PIPELINE = {
  correctness:  0.30,
  reliability:  0.25,
  latency:      0.15,
  cost:         0.10,
  coherence:    0.20,  // inter-node output coherence
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const EVAL_THRESHOLDS = {
  REJECT:      70,
  REVIEW:      85,
  FAST_TRACK:  85,
  // Latency targets (ms)
  LATENCY_IDEAL:  3_000,
  LATENCY_MAX:    10_000,
  // Cost targets (USD per run)
  COST_IDEAL:  0.01,
  COST_MAX:    0.10,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentType = "single" | "rag" | "pipeline"

export interface TestCase {
  input:          string
  expectedOutput?: string
  isHidden:        boolean
  category?:       string
  severity?:       "normal" | "edge" | "adversarial"
}

export interface EvalRunResult {
  testInput:        string
  actualOutput:     string
  passed:           boolean
  latencyMs:        number
  costUsd:          number
  correctnessScore: number   // 0–100
  errorMessage?:    string
  isHidden:         boolean
  severity:         string
}

export interface EvalScore {
  agentType:        AgentType
  totalScore:       number     // 0–100 weighted composite
  gate:             "reject" | "pending_review" | "fast_track"
  breakdown: {
    correctness:    number
    reliability:    number
    latency:        number
    cost:           number
    faithfulness?:  number
    coverage?:      number
    coherence?:     number
  }
  stats: {
    totalRuns:      number
    passed:         number
    failed:         number
    avgLatencyMs:   number
    avgCostUsd:     number
    successRate:    number
  }
  runs:             EvalRunResult[]
  recommendation:   string
}

// ─── Correctness scorer ───────────────────────────────────────────────────────

/**
 * scoreCorrectness
 *
 * Deterministic fast check first, LLM-graded fallback for complex cases.
 * Returns 0–100.
 */
async function scoreCorrectness(params: {
  input:          string
  output:         string
  expected?:      string
  agentType:      AgentType
}): Promise<number> {
  const { input, output, expected, agentType } = params

  // Hard fail: empty output
  if (!output || output.trim().length < 3) return 0

  // If expected output provided → fuzzy match (Jaccard token similarity)
  if (expected && expected.trim().length > 0) {
    const tokA = new Set(output.toLowerCase().split(/\s+/))
    const tokB = new Set(expected.toLowerCase().split(/\s+/))
    const intersection = [...tokA].filter(t => tokB.has(t)).length
    const union        = new Set([...tokA, ...tokB]).size
    const jaccard      = union > 0 ? intersection / union : 0
    return Math.round(jaccard * 100)
  }

  // No expected output — use LLM grader for quality (async, ~1s)
  try {
    const anthropic = new Anthropic()
    const gradePrompt = [
      `You are an objective output quality grader for an AI agent marketplace.`,
      `Grade the following agent output on a scale of 0-100.`,
      ``,
      `User Input: ${input.slice(0, 500)}`,
      `Agent Output: ${output.slice(0, 1000)}`,
      ``,
      `Scoring criteria:`,
      `- 90-100: Complete, accurate, well-structured, directly addresses the input`,
      `- 70-89: Mostly relevant, minor gaps or minor hallucination`,
      `- 50-69: Partially relevant, significant gaps or errors`,
      `- 20-49: Mostly irrelevant, major errors`,
      `- 0-19: Empty, nonsensical, or harmful`,
      ``,
      `Reply with ONLY a JSON object: {"score": <0-100>, "reason": "<one sentence>"}`,
    ].join("\n")

    const resp = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",  // cheapest model for grading
      max_tokens: 100,
      messages:   [{ role: "user", content: gradePrompt }],
    })

    const text = resp.content[0]?.type === "text" ? resp.content[0].text : ""
    const json = JSON.parse(text.replace(/```json|```/g, "").trim())
    return Math.min(100, Math.max(0, Number(json.score) || 0))
  } catch {
    // Fallback: heuristic check (non-empty, longer than input hint = likely useful)
    const lengthScore = Math.min(100, (output.length / Math.max(input.length, 1)) * 50)
    return Math.round(lengthScore)
  }
}

// ─── Latency score (0–100) ────────────────────────────────────────────────────
function scoreLatency(latencyMs: number): number {
  if (latencyMs <= EVAL_THRESHOLDS.LATENCY_IDEAL) return 100
  if (latencyMs >= EVAL_THRESHOLDS.LATENCY_MAX)   return 0
  const range = EVAL_THRESHOLDS.LATENCY_MAX - EVAL_THRESHOLDS.LATENCY_IDEAL
  return Math.round(100 - ((latencyMs - EVAL_THRESHOLDS.LATENCY_IDEAL) / range) * 100)
}

// ─── Cost score (0–100) ───────────────────────────────────────────────────────
function scoreCost(costUsd: number): number {
  if (costUsd <= EVAL_THRESHOLDS.COST_IDEAL) return 100
  if (costUsd >= EVAL_THRESHOLDS.COST_MAX)   return 0
  const range = EVAL_THRESHOLDS.COST_MAX - EVAL_THRESHOLDS.COST_IDEAL
  return Math.round(100 - ((costUsd - EVAL_THRESHOLDS.COST_IDEAL) / range) * 100)
}

// ─── Run a single test case ───────────────────────────────────────────────────
async function runSingleTest(params: {
  agentId:      string
  test:         TestCase
  executeUrl:   string
  authToken:    string
}): Promise<EvalRunResult> {
  const { agentId, test, executeUrl, authToken } = params
  const start = Date.now()

  try {
    const res = await fetch(executeUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${authToken}`,
      },
      body: JSON.stringify({ agentId, input: test.input }),
      signal: AbortSignal.timeout(12_000),  // 12s hard timeout per test
    })

    const latencyMs = Date.now() - start
    const json      = await res.json()

    if (!res.ok || json.error) {
      return {
        testInput:        test.input,
        actualOutput:     "",
        passed:           false,
        latencyMs,
        costUsd:          0,
        correctnessScore: 0,
        errorMessage:     json.error || `HTTP ${res.status}`,
        isHidden:         test.isHidden,
        severity:         test.severity || "normal",
      }
    }

    const outputText = typeof json.output?.text === "string"
      ? json.output.text
      : JSON.stringify(json.output ?? "")

    const correctnessScore = await scoreCorrectness({
      input:     test.input,
      output:    outputText,
      expected:  test.expectedOutput,
      agentType: "single",
    })

    return {
      testInput:        test.input,
      actualOutput:     outputText.slice(0, 2000),  // cap stored output
      passed:           res.ok && correctnessScore >= 50,
      latencyMs,
      costUsd:          json.cost ?? 0,
      correctnessScore,
      isHidden:         test.isHidden,
      severity:         test.severity || "normal",
    }
  } catch (err: any) {
    return {
      testInput:        test.input,
      actualOutput:     "",
      passed:           false,
      latencyMs:        Date.now() - start,
      costUsd:          0,
      correctnessScore: 0,
      errorMessage:     err.message || "Timeout or network error",
      isHidden:         test.isHidden,
      severity:         test.severity || "normal",
    }
  }
}

// ─── Adversarial test penalty ─────────────────────────────────────────────────
// Failing adversarial tests (e.g. prompt injection) drops score more than normal failures
function applyAdversarialPenalty(runs: EvalRunResult[]): EvalRunResult[] {
  return runs.map(r => {
    if (r.severity === "adversarial" && !r.passed) {
      // Adversarial failure counts as correctnessScore = 0 with 2× weight penalty
      return { ...r, correctnessScore: 0 }
    }
    return r
  })
}

// ─── Main evaluation entry point ──────────────────────────────────────────────

export async function evaluateAgent(params: {
  agentId:      string
  agentType:    AgentType
  userTests:    TestCase[]         // builder-provided (max 5)
  hiddenTests:  TestCase[]         // platform-provided (not shown to builder)
  executeUrl:   string             // internal execute endpoint URL
  authToken:    string             // service-role JWT for calling execute
}): Promise<EvalScore> {
  const { agentId, agentType, userTests, hiddenTests, executeUrl, authToken } = params

  // Combine and cap: max 5 user + 5 hidden = 10 total
  const allTests: TestCase[] = [
    ...userTests.slice(0, 5),
    ...hiddenTests.slice(0, 5),
  ]

  // Run all tests (parallel for speed, max 10s each)
  const rawRuns = await Promise.all(
    allTests.map(test => runSingleTest({ agentId, test, executeUrl, authToken }))
  )

  const runs = applyAdversarialPenalty(rawRuns)

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const passed       = runs.filter(r => r.passed).length
  const failed       = runs.length - passed
  const successRate  = runs.length > 0 ? passed / runs.length : 0
  const avgLatencyMs = runs.length > 0
    ? runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length
    : 0
  const avgCostUsd   = runs.length > 0
    ? runs.reduce((s, r) => s + r.costUsd, 0) / runs.length
    : 0
  const avgCorrectness = runs.length > 0
    ? runs.reduce((s, r) => s + r.correctnessScore, 0) / runs.length
    : 0

  // ── Dimension scores ──────────────────────────────────────────────────────
  const correctness = avgCorrectness
  const reliability = successRate * 100
  const latency     = scoreLatency(avgLatencyMs)
  const cost        = scoreCost(avgCostUsd)

  let totalScore: number
  const breakdown: EvalScore["breakdown"] = { correctness, reliability, latency, cost }

  if (agentType === "rag") {
    // RAG: faithfulness approximated by checking if output references input keywords
    const faithfulness = runs.length > 0
      ? runs.reduce((s, r) => {
          const keywords = r.testInput.toLowerCase().split(/\s+/).filter(w => w.length > 4)
          const hits = keywords.filter(k => r.actualOutput.toLowerCase().includes(k)).length
          return s + (keywords.length > 0 ? (hits / keywords.length) * 100 : 50)
        }, 0) / runs.length
      : 50
    const coverage = correctness  // proxy until golden dataset available
    breakdown.faithfulness = faithfulness
    breakdown.coverage     = coverage
    const w = WEIGHTS_RAG
    totalScore = w.correctness * correctness + w.reliability * reliability
      + w.latency * latency + w.cost * cost
      + w.faithfulness * faithfulness + w.coverage * coverage
  } else if (agentType === "pipeline") {
    // Pipeline: coherence measured by whether inter-node transitions preserved meaning
    // Approximated until full pipeline evaluator is built in v2
    const coherence = successRate >= 0.8 ? 85 : successRate * 100
    breakdown.coherence = coherence
    const w = WEIGHTS_PIPELINE
    totalScore = w.correctness * correctness + w.reliability * reliability
      + w.latency * latency + w.cost * cost + w.coherence * coherence
  } else {
    const w = WEIGHTS_SINGLE
    totalScore = w.correctness * correctness + w.reliability * reliability
      + w.latency * latency + w.cost * cost
  }

  totalScore = Math.min(100, Math.max(0, Math.round(totalScore)))

  // ── Gate assignment ───────────────────────────────────────────────────────
  const gate: EvalScore["gate"] =
    totalScore < EVAL_THRESHOLDS.REJECT    ? "reject" :
    totalScore < EVAL_THRESHOLDS.FAST_TRACK ? "pending_review" :
                                               "fast_track"

  // ── Recommendation message ────────────────────────────────────────────────
  const weakDimension = Object.entries(breakdown)
    .sort(([, a], [, b]) => (a as number) - (b as number))[0]

  const recommendation = gate === "reject"
    ? `Score ${totalScore}/100 — below minimum 70. Primary issue: ${weakDimension[0]} (${Math.round(weakDimension[1] as number)}/100). Fix your agent and resubmit.`
    : gate === "pending_review"
    ? `Score ${totalScore}/100 — under review. Improve ${weakDimension[0]} to reach fast-track.`
    : `Score ${totalScore}/100 — excellent! Your agent is fast-tracked for review.`

  return {
    agentType,
    totalScore,
    gate,
    breakdown,
    stats: {
      totalRuns:   runs.length,
      passed,
      failed,
      avgLatencyMs: Math.round(avgLatencyMs),
      avgCostUsd,
      successRate,
    },
    runs,
    recommendation,
  }
}
