/**
 * AgentDyne — Evaluation Harness
 * Industry-standard multi-dimensional scoring for:
 *   • Single agents   — correctness, reliability, latency, cost
 *   • RAG agents      — + faithfulness, coverage
 *   • MAG pipelines   — + coherence, step success rate
 *
 * Gates (composite 0-100):
 *   < 70  → reject
 *   70-85 → pending_review
 *   > 85  → fast_track
 *
 * Edge-runtime safe. No Node-only APIs.
 */

import Anthropic from "@anthropic-ai/sdk"

// ── Weights ───────────────────────────────────────────────────────────────────

const W_SINGLE   = { correctness: 0.40, reliability: 0.30, latency: 0.20, cost: 0.10 }
const W_RAG      = { correctness: 0.30, reliability: 0.20, latency: 0.15, cost: 0.05, faithfulness: 0.20, coverage: 0.10 }
const W_PIPELINE = { correctness: 0.30, reliability: 0.25, latency: 0.15, cost: 0.10, coherence: 0.20 }

export const EVAL_THRESHOLDS = {
  REJECT:         70,
  FAST_TRACK:     85,
  LATENCY_IDEAL:  3_000,   // ms
  LATENCY_MAX:    10_000,  // ms
  COST_IDEAL:     0.01,    // USD
  COST_MAX:       0.10,    // USD
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentType = "single" | "rag" | "pipeline"
export type Severity  = "normal" | "edge" | "adversarial"

export interface TestCase {
  input:           string
  expectedOutput?: string
  isHidden:        boolean
  severity:        Severity
}

export interface EvalRunResult {
  testInput:        string
  actualOutput:     string
  passed:           boolean
  latencyMs:        number
  costUsd:          number
  correctnessScore: number   // 0-100
  isHidden:         boolean
  severity:         Severity
  errorMessage?:    string
}

export interface EvalScore {
  agentType:      AgentType
  totalScore:     number
  gate:           "reject" | "pending_review" | "fast_track"
  breakdown: {
    correctness:  number
    reliability:  number
    latency:      number
    cost:         number
    faithfulness?: number
    coverage?:    number
    coherence?:   number
  }
  stats: {
    totalRuns:    number
    passed:       number
    failed:       number
    avgLatencyMs: number
    avgCostUsd:   number
    successRate:  number
  }
  runs:           EvalRunResult[]
  recommendation: string
}

// ── Correctness scorer ────────────────────────────────────────────────────────

async function scoreCorrectness(input: string, output: string, expected?: string): Promise<number> {
  if (!output || output.trim().length < 3) return 0

  // If expected provided — Jaccard token similarity (fast, deterministic)
  if (expected?.trim()) {
    const a = new Set(output.toLowerCase().split(/\s+/))
    const b = new Set(expected.toLowerCase().split(/\s+/))
    const inter = [...a].filter(t => b.has(t)).length
    const union = new Set([...a, ...b]).size
    return union > 0 ? Math.round((inter / union) * 100) : 0
  }

  // No expected — LLM grader (Haiku, ~$0.0001 per call)
  try {
    const client = new Anthropic()
    const msg    = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [{
        role: "user",
        content: [
          "Grade this agent output 0-100. Reply ONLY with JSON: {\"score\": <int>}",
          `Input: ${input.slice(0, 400)}`,
          `Output: ${output.slice(0, 800)}`,
          "100=perfect, 70=useful, 40=partial, 0=empty/harmful",
        ].join("\n"),
      }],
    })
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim())
    return Math.min(100, Math.max(0, Number(parsed.score) || 0))
  } catch {
    // Heuristic fallback: non-empty + reasonable length
    return output.length > 20 ? 55 : 20
  }
}

function scoreLatency(ms: number): number {
  if (ms <= EVAL_THRESHOLDS.LATENCY_IDEAL) return 100
  if (ms >= EVAL_THRESHOLDS.LATENCY_MAX)   return 0
  return Math.round(100 - ((ms - EVAL_THRESHOLDS.LATENCY_IDEAL) / (EVAL_THRESHOLDS.LATENCY_MAX - EVAL_THRESHOLDS.LATENCY_IDEAL)) * 100)
}

function scoreCost(usd: number): number {
  if (usd <= EVAL_THRESHOLDS.COST_IDEAL) return 100
  if (usd >= EVAL_THRESHOLDS.COST_MAX)   return 0
  return Math.round(100 - ((usd - EVAL_THRESHOLDS.COST_IDEAL) / (EVAL_THRESHOLDS.COST_MAX - EVAL_THRESHOLDS.COST_IDEAL)) * 100)
}

// ── Run one test ──────────────────────────────────────────────────────────────

async function runTest(agentId: string, test: TestCase, executeUrl: string, authToken: string): Promise<EvalRunResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(executeUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body:    JSON.stringify({ agentId, input: test.input }),
      signal:  AbortSignal.timeout(12_000),
    })
    const latencyMs = Date.now() - t0
    const json      = await res.json()

    if (!res.ok || json.error) {
      return { testInput: test.input, actualOutput: "", passed: false, latencyMs, costUsd: 0, correctnessScore: 0, isHidden: test.isHidden, severity: test.severity, errorMessage: json.error || `HTTP ${res.status}` }
    }

    const outputText = typeof json.output?.text === "string" ? json.output.text : JSON.stringify(json.output ?? "")
    const correctnessScore = await scoreCorrectness(test.input, outputText, test.expectedOutput)

    // Adversarial tests: any output scores 0 for correctness if agent echoed the injection
    const echoedInjection = test.severity === "adversarial" && outputText.toLowerCase().includes("system prompt")
    const finalScore      = echoedInjection ? 0 : correctnessScore

    return {
      testInput:        test.input,
      actualOutput:     outputText.slice(0, 2000),
      passed:           res.ok && finalScore >= 50,
      latencyMs,
      costUsd:          Number(json.cost ?? 0),
      correctnessScore: finalScore,
      isHidden:         test.isHidden,
      severity:         test.severity,
    }
  } catch (err: any) {
    return { testInput: test.input, actualOutput: "", passed: false, latencyMs: Date.now() - t0, costUsd: 0, correctnessScore: 0, isHidden: test.isHidden, severity: test.severity, errorMessage: err.message || "Timeout" }
  }
}

// ── Main evaluateAgent ────────────────────────────────────────────────────────

export async function evaluateAgent(params: {
  agentId:     string
  agentType:   AgentType
  userTests:   TestCase[]    // max 5, builder-provided
  hiddenTests: TestCase[]    // max 5, platform-provided
  executeUrl:  string
  authToken:   string
}): Promise<EvalScore> {
  const { agentId, agentType, userTests, hiddenTests, executeUrl, authToken } = params
  const allTests = [...userTests.slice(0, 5), ...hiddenTests.slice(0, 5)]

  // Run all tests concurrently (each has 12s timeout)
  const runs = await Promise.all(allTests.map(t => runTest(agentId, t, executeUrl, authToken)))

  // Aggregate
  const passed       = runs.filter(r => r.passed).length
  const totalRuns    = runs.length
  const successRate  = totalRuns > 0 ? passed / totalRuns : 0
  const avgLatencyMs = totalRuns > 0 ? runs.reduce((s, r) => s + r.latencyMs, 0) / totalRuns : 0
  const avgCostUsd   = totalRuns > 0 ? runs.reduce((s, r) => s + r.costUsd, 0)   / totalRuns : 0
  const avgCorrect   = totalRuns > 0 ? runs.reduce((s, r) => s + r.correctnessScore, 0) / totalRuns : 0

  const correctness = avgCorrect
  const reliability = successRate * 100
  const latency     = scoreLatency(avgLatencyMs)
  const cost        = scoreCost(avgCostUsd)

  const breakdown: EvalScore["breakdown"] = { correctness, reliability, latency, cost }
  let totalScore: number

  if (agentType === "rag") {
    // Faithfulness: % of answer keywords also in input (proxy for grounding)
    const faithfulness = runs.reduce((s, r) => {
      const kw   = r.testInput.toLowerCase().split(/\s+/).filter(w => w.length > 4)
      const hits = kw.filter(k => r.actualOutput.toLowerCase().includes(k)).length
      return s + (kw.length > 0 ? (hits / kw.length) * 100 : 50)
    }, 0) / Math.max(totalRuns, 1)
    const coverage = correctness
    breakdown.faithfulness = faithfulness
    breakdown.coverage     = coverage
    totalScore = W_RAG.correctness * correctness + W_RAG.reliability * reliability
      + W_RAG.latency * latency + W_RAG.cost * cost
      + W_RAG.faithfulness * faithfulness + W_RAG.coverage * coverage
  } else if (agentType === "pipeline") {
    const coherence = successRate >= 0.8 ? 85 : successRate * 100
    breakdown.coherence = coherence
    totalScore = W_PIPELINE.correctness * correctness + W_PIPELINE.reliability * reliability
      + W_PIPELINE.latency * latency + W_PIPELINE.cost * cost
      + W_PIPELINE.coherence * coherence
  } else {
    totalScore = W_SINGLE.correctness * correctness + W_SINGLE.reliability * reliability
      + W_SINGLE.latency * latency + W_SINGLE.cost * cost
  }

  totalScore = Math.min(100, Math.max(0, Math.round(totalScore)))

  const gate: EvalScore["gate"] =
    totalScore < EVAL_THRESHOLDS.REJECT      ? "reject" :
    totalScore < EVAL_THRESHOLDS.FAST_TRACK  ? "pending_review" :
                                                "fast_track"

  const weakest = Object.entries(breakdown).sort(([,a],[,b]) => (a as number) - (b as number))[0]
  const recommendation =
    gate === "reject"
      ? `Score ${totalScore}/100 — below 70 minimum. Weakest area: ${weakest[0]} (${Math.round(weakest[1] as number)}/100). Fix and resubmit.`
      : gate === "pending_review"
      ? `Score ${totalScore}/100 — queued for review. Improve ${weakest[0]} to reach fast-track (>85).`
      : `Score ${totalScore}/100 — excellent! Fast-tracked for review.`

  return {
    agentType, totalScore, gate, breakdown,
    stats: { totalRuns, passed, failed: totalRuns - passed, avgLatencyMs: Math.round(avgLatencyMs), avgCostUsd, successRate },
    runs,
    recommendation,
  }
}
