/**
 * @module llmComposer
 * @path   src/core/composer/llmComposer.ts
 *
 * AgentDyne — LLM-Driven Workflow Composer
 *
 * Turns a natural language GOAL into a runnable pipeline DAG.
 * Supports all multi-agent design patterns:
 *   LINEAR    — A → B → C
 *   PARALLEL  — A → (B ∥ C) → D
 *   BRANCH    — A → [condition] → B | C
 *   SUBAGENT  — nested pipeline reference
 *   MIXED     — combination
 */

import { routeCompletion } from "@/lib/model-router"

export type PatternType = "linear" | "parallel" | "branch" | "subagent" | "mixed"

export interface ComposerAgent {
  id:              string
  name:            string
  description:     string
  category:        string
  capability_tags: string[]
  pricing_model:   string
  price_per_call:  number
  average_rating:  number
  composite_score: number
}

export interface ComposedNode {
  id:                   string
  agent_id:             string
  label:                string
  continue_on_failure?: boolean
  condition?:           string
  parallel_group?:      string
  sub_pipeline_id?:     string
  output_field?:        string
}

export interface ComposedEdge {
  from:       string
  to:         string
  condition?: string
}

export interface ComposedDAG {
  nodes:           ComposedNode[]
  edges:           ComposedEdge[]
  pattern:         PatternType
  description:     string
  estimatedCost:   number
  estimatedSteps:  number
}

export interface ComposerResult {
  ok:          boolean
  dag?:        ComposedDAG
  reasoning:   string
  agentsUsed:  string[]
  patternUsed: PatternType
  confidence:  number
  error?:      string
}

function buildSystemPrompt(agents: ComposerAgent[]): string {
  const list = agents.map(a =>
    `ID:${a.id} | "${a.name}" | ${a.category} | tags:${a.capability_tags.slice(0,4).join(",")} | $${(a.price_per_call??0).toFixed(4)}/call | ⭐${a.average_rating}`
  ).join("\n")

  return `You are an expert AI workflow architect for AgentDyne marketplace.
Given a user GOAL, select agents and design an optimal DAG workflow.

AGENTS:
${list || "No agents available."}

PATTERNS:
linear: A→B→C | parallel: A→(B∥C)→D | branch: A→[cond]→B|C | mixed: combination

RULES:
- Minimum agents needed
- Max 10 nodes
- Parallel nodes share parallel_group field
- Branch edges have condition field
- If no agents fit, return {"error":"reason","confidence":0}

RESPOND IN JSON ONLY (no markdown):
{"pattern":"linear","description":"..","confidence":0.9,"reasoning":"..","nodes":[{"id":"node_1","agent_id":"uuid","label":"Verb phrase","continue_on_failure":false}],"edges":[{"from":"node_1","to":"node_2"}]}`
}

function estimateCost(nodes: ComposedNode[], agents: ComposerAgent[]): number {
  const map = new Map(agents.map(a => [a.id, a]))
  return parseFloat(nodes.reduce((s, n) => s + (map.get(n.agent_id)?.price_per_call ?? 0), 0).toFixed(6))
}

export async function composeWorkflow(input: {
  goal:             string
  availableAgents:  ComposerAgent[]
  preferredPattern?: PatternType
  maxBudgetUsd?:    number
}): Promise<ComposerResult> {
  const { goal, availableAgents, preferredPattern, maxBudgetUsd } = input

  if (!goal?.trim())
    return { ok: false, error: "Goal is required", reasoning: "", agentsUsed: [], patternUsed: "linear", confidence: 0 }
  if (!availableAgents.length)
    return { ok: false, error: "No agents available", reasoning: "", agentsUsed: [], patternUsed: "linear", confidence: 0 }

  const filteredAgents = maxBudgetUsd
    ? availableAgents.filter(a => (a.price_per_call ?? 0) <= maxBudgetUsd / 2)
    : availableAgents

  const userMsg = [
    `GOAL: ${goal.trim()}`,
    preferredPattern ? `PREFERRED PATTERN: ${preferredPattern}` : "",
    maxBudgetUsd     ? `MAX BUDGET PER RUN: $${maxBudgetUsd.toFixed(4)}` : "",
  ].filter(Boolean).join("\n")

  try {
    const { text } = await routeCompletion({
      model:       "claude-haiku-4-5-20251001",
      system:      buildSystemPrompt(filteredAgents.slice(0, 25)),
      userMessage: userMsg,
      maxTokens:   1500,
      temperature: 0.1,
    })

    let parsed: any
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\n?/i,"").replace(/\n?```$/,"").trim())
    } catch {
      return { ok: false, error: "Composer returned invalid JSON", reasoning: text.slice(0, 200), agentsUsed: [], patternUsed: "linear", confidence: 0 }
    }

    if (parsed.error)
      return { ok: false, error: parsed.error, reasoning: "", agentsUsed: [], patternUsed: "linear", confidence: parsed.confidence ?? 0 }

    if (!parsed.nodes?.length)
      return { ok: false, error: "No nodes generated", reasoning: parsed.reasoning ?? "", agentsUsed: [], patternUsed: "linear", confidence: 0 }

    const validIds = new Set(availableAgents.map(a => a.id))
    const invalid  = (parsed.nodes as any[]).filter(n => !validIds.has(n.agent_id))
    if (invalid.length)
      return { ok: false, error: `Invalid agent IDs: ${invalid.map((n:any)=>n.agent_id).slice(0,3).join(", ")}`, reasoning: parsed.reasoning ?? "", agentsUsed: [], patternUsed: "linear", confidence: 0 }

    const nodes: ComposedNode[] = (parsed.nodes as any[]).map((n, i) => ({
      id:                  n.id   ?? `node_${i+1}`,
      agent_id:            n.agent_id,
      label:               n.label ?? `Step ${i+1}`,
      continue_on_failure: n.continue_on_failure ?? false,
      parallel_group:      n.parallel_group,
      condition:           n.condition,
      output_field:        n.output_field,
    }))

    const edges: ComposedEdge[] = (parsed.edges as any[] ?? []).map(e => ({
      from: e.from, to: e.to, condition: e.condition,
    }))

    // Auto-build linear edges if none provided
    if (!edges.length && nodes.length > 1) {
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({ from: nodes[i]!.id, to: nodes[i+1]!.id })
      }
    }

    const dag: ComposedDAG = {
      nodes, edges,
      pattern:        (parsed.pattern ?? "linear") as PatternType,
      description:    parsed.description ?? goal.slice(0, 120),
      estimatedCost:  estimateCost(nodes, availableAgents),
      estimatedSteps: nodes.length,
    }

    return {
      ok: true, dag,
      reasoning:   parsed.reasoning ?? "",
      agentsUsed:  nodes.map(n => n.agent_id),
      patternUsed: dag.pattern,
      confidence:  Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
    }
  } catch (err: any) {
    return { ok: false, error: err.message ?? "Composition failed", reasoning: "", agentsUsed: [], patternUsed: "linear", confidence: 0 }
  }
}

export async function refineWorkflow(params: {
  existingDag:     ComposedDAG
  feedback:        string
  availableAgents: ComposerAgent[]
}): Promise<ComposerResult> {
  const goal = `Existing workflow: "${params.existingDag.description}"
Nodes: ${params.existingDag.nodes.map(n => `"${n.label}"`).join(" → ")}
Change request: ${params.feedback}
Please output a refined version incorporating the change. Reuse existing agent IDs where unchanged.`

  return composeWorkflow({ goal, availableAgents: params.availableAgents })
}
