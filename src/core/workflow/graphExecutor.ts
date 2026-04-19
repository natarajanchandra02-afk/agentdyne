/**
 * @module graphExecutor
 * @path   src/core/workflow/graphExecutor.ts
 *
 * Reusable, graph-aware DAG execution engine.
 *
 * Used by:
 *   - /api/pipelines/[id]/execute (multi-agent workflows)
 *   - Future: /api/agents/[id]/execute with tool-use graphs
 *
 * Features:
 *   - Topological sort → concurrent level execution (nodes in same
 *     level run in parallel via Promise.all)
 *   - Per-node cost + latency tracking
 *   - continue_on_failure semantics (pass null downstream)
 *   - Pipeline timeout kill switch
 *   - Input variable interpolation ({{varName}})
 *   - Input mapping (route specific upstream outputs to specific inputs)
 *   - Cycle detection (prevents infinite loops)
 *   - Max steps enforcement per plan
 */

import { PLAN_LIMITS, type PlanName } from "@/lib/anti-abuse"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id:                     string
  agent_id:               string
  label?:                 string
  system_prompt_override?: string
  /** Maps {targetKey: "node.0.outputField" | "varName" | "literal"} */
  input_mapping?:          Record<string, string>
  continue_on_failure?:    boolean
}

export interface GraphEdge {
  from: string
  to:   string
}

export interface DAG {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface NodeExecutionResult {
  nodeId:    string
  agentId:   string
  agentName: string
  status:    "success" | "failed" | "skipped"
  input:     unknown
  output:    unknown
  latencyMs: number
  costUsd:   number
  tokens:    { input: number; output: number }
  error?:    string
}

export interface GraphExecutionResult {
  status:          "success" | "failed" | "timeout" | "cycle_detected" | "step_limit"
  output:          unknown     // output of the final node
  nodeResults:     NodeExecutionResult[]
  totalCostUsd:    number
  totalTokensIn:   number
  totalTokensOut:  number
  totalLatencyMs:  number
  error?:          string
}

export type NodeExecutorFn = (
  node:        GraphNode,
  input:       unknown,
  variables:   Record<string, string>
) => Promise<{
  output:    unknown
  text:      string
  costUsd:   number
  tokensIn:  number
  tokensOut: number
}>

// ─── Topological sort ─────────────────────────────────────────────────────────

export function buildTopologicalLevels(dag: DAG): {
  levels:     GraphNode[][]
  hasCycle:   boolean
  nodeCount:  number
} {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()
  const nodeMap  = new Map<string, GraphNode>()

  for (const n of dag.nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
    nodeMap.set(n.id, n)
  }
  for (const e of dag.edges) {
    adj.get(e.from)?.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const levels: GraphNode[][] = []
  let processed = 0

  while (queue.length > 0) {
    const currentLevel = [...queue]
    queue.length = 0
    const levelNodes: GraphNode[] = []

    for (const id of currentLevel) {
      const node = nodeMap.get(id)
      if (node) levelNodes.push(node)
      processed++
      for (const next of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(next) ?? 0) - 1
        inDegree.set(next, newDeg)
        if (newDeg === 0) queue.push(next)
      }
    }

    if (levelNodes.length > 0) levels.push(levelNodes)
  }

  return {
    levels,
    hasCycle:  processed !== dag.nodes.length,
    nodeCount: dag.nodes.length,
  }
}

// ─── Input resolution ─────────────────────────────────────────────────────────

export function resolveNodeInput(
  node:          GraphNode,
  dag:           DAG,
  nodeOutputs:   Record<string, unknown>,
  pipelineInput: unknown,
  variables:     Record<string, string>
): unknown {
  const upstreamEdges = dag.edges.filter(e => e.to === node.id)

  if (upstreamEdges.length === 0) {
    // Root node: use pipeline input with variable interpolation
    return typeof pipelineInput === "string"
      ? interpolate(pipelineInput, variables, nodeOutputs)
      : pipelineInput
  }

  const upstreamOutputs = upstreamEdges
    .map(e => nodeOutputs[e.from])
    .filter(v => v !== undefined && v !== null)

  if (node.input_mapping) {
    return applyInputMapping(node.input_mapping, upstreamOutputs, variables)
  }

  return upstreamOutputs.length === 1 ? upstreamOutputs[0] : upstreamOutputs
}

function interpolate(
  template:    string,
  variables:   Record<string, string>,
  nodeOutputs: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in variables)   return String(variables[key] ?? "")
    if (key in nodeOutputs) return JSON.stringify(nodeOutputs[key])
    return `{{${key}}}`
  })
}

function applyInputMapping(
  mapping:         Record<string, string>,
  upstreamOutputs: unknown[],
  variables:       Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (sourceExpr.startsWith("node.")) {
      const parts = sourceExpr.split(".")
      let val: any = upstreamOutputs[parseInt(parts[1] ?? "0")]
      for (let i = 2; i < parts.length; i++) {
        val = val?.[parts[i]!]
      }
      result[targetKey] = val
    } else if (sourceExpr in variables) {
      result[targetKey] = variables[sourceExpr]
    } else {
      result[targetKey] = sourceExpr
    }
  }
  return result
}

// ─── Graph executor ───────────────────────────────────────────────────────────

export interface GraphExecutorConfig {
  dag:               DAG
  pipelineInput:     unknown
  variables:         Record<string, string>
  timeoutMs:         number
  plan:              PlanName
  executor:          NodeExecutorFn
  getAgentName?:     (agentId: string) => string
}

/**
 * executeGraph
 *
 * Runs a DAG of agents concurrently per topological level.
 * Returns detailed per-node results and aggregate stats.
 *
 * @example
 * const result = await executeGraph({
 *   dag:           pipeline.dag,
 *   pipelineInput: body.input,
 *   variables:     body.variables ?? {},
 *   timeoutMs:     pipeline.timeout_seconds * 1000,
 *   plan:          "pro",
 *   executor:      async (node, input, vars) => { ... return { output, text, costUsd, tokensIn, tokensOut } }
 * })
 */
export async function executeGraph(config: GraphExecutorConfig): Promise<GraphExecutionResult> {
  const { dag, pipelineInput, variables, timeoutMs, plan, executor, getAgentName } = config
  const startMs = Date.now()

  // Validate step limit for plan
  const limits  = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
  if (dag.nodes.length > limits.max_pipeline_steps) {
    return {
      status:         "step_limit",
      output:         null,
      nodeResults:    [],
      totalCostUsd:   0,
      totalTokensIn:  0,
      totalTokensOut: 0,
      totalLatencyMs: 0,
      error: `Pipeline has ${dag.nodes.length} steps but your plan allows ${limits.max_pipeline_steps}. Upgrade to run larger pipelines.`,
    }
  }

  const { levels, hasCycle } = buildTopologicalLevels(dag)

  if (hasCycle) {
    return {
      status:         "cycle_detected",
      output:         null,
      nodeResults:    [],
      totalCostUsd:   0,
      totalTokensIn:  0,
      totalTokensOut: 0,
      totalLatencyMs: 0,
      error:          "Pipeline DAG contains a cycle — execution aborted.",
    }
  }

  const nodeOutputs:  Record<string, unknown> = {}
  const nodeResults:  NodeExecutionResult[]   = []
  let totalCostUsd    = 0
  let totalTokensIn   = 0
  let totalTokensOut  = 0
  let lastOutput:     unknown = pipelineInput
  const deadline      = Date.now() + timeoutMs

  for (const level of levels) {
    // Timeout check between levels
    if (Date.now() > deadline) {
      return {
        status:         "timeout",
        output:         lastOutput,
        nodeResults,
        totalCostUsd,
        totalTokensIn,
        totalTokensOut,
        totalLatencyMs: Date.now() - startMs,
        error:          "Pipeline timed out.",
      }
    }

    // Run all nodes in this level concurrently
    const levelResults = await Promise.allSettled(
      level.map(async (node): Promise<NodeExecutionResult> => {
        const nodeStart = Date.now()
        const nodeInput = resolveNodeInput(node, dag, nodeOutputs, pipelineInput, variables)
        const agentName = getAgentName?.(node.agent_id) ?? node.label ?? node.agent_id

        try {
          const { output, text: _, costUsd, tokensIn, tokensOut } =
            await executor(node, nodeInput, variables)

          return {
            nodeId:    node.id,
            agentId:   node.agent_id,
            agentName,
            status:    "success",
            input:     nodeInput,
            output,
            latencyMs: Date.now() - nodeStart,
            costUsd,
            tokens:    { input: tokensIn, output: tokensOut },
          }
        } catch (err: any) {
          return {
            nodeId:    node.id,
            agentId:   node.agent_id,
            agentName,
            status:    "failed",
            input:     nodeInput,
            output:    null,
            latencyMs: Date.now() - nodeStart,
            costUsd:   0,
            tokens:    { input: 0, output: 0 },
            error:     err.message ?? "Node execution failed",
          }
        }
      })
    )

    // Process level results
    let levelFailed = false
    let failedResult: NodeExecutionResult | null = null

    for (const settled of levelResults) {
      const result = settled.status === "fulfilled"
        ? settled.value
        : {
            nodeId:    "unknown", agentId: "unknown", agentName: "unknown",
            status:    "failed" as const,
            input:     null, output: null, latencyMs: 0, costUsd: 0,
            tokens:    { input: 0, output: 0 },
            error:     settled.reason?.message ?? "Unexpected error",
          }

      nodeResults.push(result)

      if (result.status === "success") {
        nodeOutputs[result.nodeId] = result.output
        totalCostUsd    += result.costUsd
        totalTokensIn   += result.tokens.input
        totalTokensOut  += result.tokens.output
        if (result.output != null) lastOutput = result.output
      } else {
        const node = dag.nodes.find(n => n.id === result.nodeId)
        if (node?.continue_on_failure) {
          nodeOutputs[result.nodeId] = null  // pass null downstream gracefully
        } else {
          levelFailed  = true
          failedResult = result
        }
      }
    }

    if (levelFailed && failedResult) {
      return {
        status:         "failed",
        output:         lastOutput,
        nodeResults,
        totalCostUsd,
        totalTokensIn,
        totalTokensOut,
        totalLatencyMs: Date.now() - startMs,
        error:          `Node "${failedResult.agentName}" failed: ${failedResult.error}`,
      }
    }
  }

  return {
    status:         "success",
    output:         lastOutput,
    nodeResults,
    totalCostUsd,
    totalTokensIn,
    totalTokensOut,
    totalLatencyMs: Date.now() - startMs,
  }
}
