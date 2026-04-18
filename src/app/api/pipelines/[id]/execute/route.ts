export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"
import { runInjectionPipeline, sanitizeOutput } from "@/lib/injection-filter"
import { retrieveRAGContext, buildRAGSystemPrompt } from "@/lib/rag-retriever"

/**
 * POST /api/pipelines/[id]/execute
 *
 * Parallel DAG Execution Engine:
 * 1. Topological level grouping  (nodes in same level run concurrently)
 * 2. Injection filter on input
 * 3. RAG context injection per node (if agent has knowledge_base_id)
 * 4. Multi-provider LLM dispatch via model-router
 * 5. Full execution trace persisted
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await apiRateLimit(req)
  if (limited) return limited

  const startTotal = Date.now()

  try {
    const { id: pipelineId } = await params
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: pipeline } = await supabase
      .from("pipelines").select("*").eq("id", pipelineId).single()

    if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (pipeline.is_active === false) return NextResponse.json({ error: "Pipeline is inactive" }, { status: 404 })
    if (!pipeline.is_public && pipeline.owner_id !== user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan")
      .eq("id", user.id).single()

    const quota     = profile?.monthly_execution_quota ?? 100
    const used      = profile?.executions_used_this_month ?? 0
    const dag       = pipeline.dag as { nodes: DAGNode[]; edges: DAGEdge[] }
    const nodeCount = dag.nodes.length

    if (nodeCount === 0)
      return NextResponse.json({ error: "Pipeline has no agents configured" }, { status: 422 })

    if (quota !== -1 && used + nodeCount > quota)
      return NextResponse.json({ error: `Only ${quota - used} quota remaining`, code: "QUOTA_EXCEEDED" }, { status: 429 })

    const { data: credits } = await supabase
      .from("credits").select("balance_usd").eq("user_id", user.id).single()

    const agentIds = dag.nodes.map(n => n.agent_id).filter(Boolean)
    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, name, price_per_call, pricing_model, model_name, system_prompt, max_tokens, temperature, status, free_calls_per_month, knowledge_base_id")
      .in("id", agentIds)

    if (!agentRows || agentRows.length !== agentIds.length)
      return NextResponse.json({ error: "One or more agents not found" }, { status: 422 })

    const agentMap = new Map<string, any>(agentRows.map((a: any) => [a.id, a]))
    for (const a of agentRows) {
      if ((a as any).status !== "active")
        return NextResponse.json({ error: `Agent "${(a as any).name}" is not active` }, { status: 422 })
    }

    const body = await req.json()
    const { input = "", variables = {} } = body

    // Injection filter on initial input
    const { filterResult } = runInjectionPipeline(typeof input === "string" ? input : JSON.stringify(input), "user")
    if (!filterResult.allowed) {
      supabase.from("injection_attempts").insert({ user_id: user.id, agent_id: null, input: String(input).slice(0, 500), pattern: filterResult.pattern, action: "blocked" }).then(() => {})
      return NextResponse.json({ error: "Input rejected", code: "INJECTION_BLOCKED" }, { status: 400 })
    }

    const { data: pipelineExec } = await supabase
      .from("pipeline_executions")
      .insert({ pipeline_id: pipelineId, user_id: user.id, status: "running", input: { value: input, variables } })
      .select().single()

    // Topological level grouping — nodes in the same level run in parallel
    const { levels, cycle } = topologicalLevels(dag.nodes, dag.edges)
    if (cycle) {
      await failPipelineExec(supabase, pipelineExec!.id, "Pipeline DAG has a cycle")
      return NextResponse.json({ error: "Pipeline DAG contains a cycle" }, { status: 422 })
    }

    const nodeOutputs: Record<string, unknown> = {}
    const nodeResults: NodeResult[] = []
    let totalCost = 0, totalTokensIn = 0, totalTokensOut = 0
    let lastOutput: unknown = input

    const timeoutMs = (pipeline.timeout_seconds ?? 300) * 1000
    const deadline  = Date.now() + timeoutMs

    for (const level of levels) {
      if (Date.now() > deadline) {
        await failPipelineExec(supabase, pipelineExec!.id, "Pipeline timed out", nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({ error: "Pipeline timed out", executionId: pipelineExec!.id }, { status: 408 })
      }

      // Execute all nodes in this level concurrently
      const levelResults = await Promise.all(
        level.map(node => executeNode(node, dag.edges, agentMap, nodeOutputs, input, variables, user.id, supabase))
      )

      let levelFailed = false
      for (const result of levelResults) {
        nodeResults.push(result)
        nodeOutputs[result.node_id] = result.output
        if (result.status === "success") {
          totalCost      += result.cost
          totalTokensIn  += result.tokens?.input  ?? 0
          totalTokensOut += result.tokens?.output ?? 0
          lastOutput      = result.output
        } else {
          const node = dag.nodes.find(n => n.id === result.node_id)
          if (!node?.continue_on_failure) {
            levelFailed = true
          } else {
            nodeOutputs[result.node_id] = null
          }
        }
      }

      if (levelFailed) {
        const failedResult = levelResults.find(r => r.status === "failed")
        await failPipelineExec(supabase, pipelineExec!.id, `Node "${failedResult?.agent_name}" failed: ${failedResult?.error}`, nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({ error: `Pipeline failed at node "${failedResult?.node_id}"`, executionId: pipelineExec!.id, node_results: nodeResults }, { status: 500 })
      }
    }

    const totalLatency = Date.now() - startTotal

    if (totalCost > 0 && credits) {
      await supabase.rpc("deduct_credits", { user_id_param: user.id, amount_param: totalCost, description_param: `Pipeline: ${pipeline.name}`, reference_id_param: pipelineExec!.id })
    }

    await supabase.from("pipeline_executions").update({
      status: "success", output: lastOutput, node_results: nodeResults,
      total_latency_ms: totalLatency, total_cost: totalCost,
      total_tokens_in: totalTokensIn, total_tokens_out: totalTokensOut,
      completed_at: new Date().toISOString(),
    }).eq("id", pipelineExec!.id)

    return NextResponse.json({
      executionId: pipelineExec!.id, status: "success", output: lastOutput, node_results: nodeResults,
      summary: { nodes_executed: nodeResults.length, total_latency_ms: totalLatency, total_cost_usd: totalCost.toFixed(6), total_tokens: { input: totalTokensIn, output: totalTokensOut } },
    })
  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/execute:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

interface DAGNode {
  id:                      string
  agent_id:                string
  label?:                  string
  system_prompt_override?: string
  input_mapping?:          Record<string, string>
  continue_on_failure?:    boolean
  config?:                 Record<string, unknown>
}

interface DAGEdge { from: string; to: string; condition?: string }

interface NodeResult {
  node_id:    string
  agent_id:   string
  agent_name: string
  status:     "success" | "failed"
  input:      unknown
  output:     unknown
  latency_ms: number
  cost:       number
  tokens?:    { input: number; output: number }
  error?:     string
}

// ── topologicalLevels — groups nodes into parallel execution levels ────────
// Returns: { levels: DAGNode[][], cycle: boolean }
// Each level is a set of nodes with no dependency on each other.
// Nodes in the same level can safely run in parallel.
// If a cycle is detected, returns { levels: [], cycle: true }.

function topologicalLevels(
  nodes: DAGNode[],
  edges: DAGEdge[]
): { levels: DAGNode[][]; cycle: boolean } {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()
  const nodeMap  = new Map<string, DAGNode>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adj.set(node.id, [])
    nodeMap.set(node.id, node)
  }
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to)
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const levels: DAGNode[][] = []
  let processed = 0

  while (queue.length > 0) {
    // Everything currently in queue is at the same topological level
    const currentLevel = [...queue]
    queue.length = 0

    const levelNodes: DAGNode[] = []
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

  // Cycle detected if not all nodes were processed
  return { levels, cycle: processed !== nodes.length }
}

// ── executeNode — runs a single pipeline node with RAG + LLM ─────────────

async function executeNode(
  node:        DAGNode,
  edges:       DAGEdge[],
  agentMap:    Map<string, any>,
  nodeOutputs: Record<string, unknown>,
  pipelineInput: unknown,
  variables:   Record<string, string>,
  userId:      string,
  supabase:    any
): Promise<NodeResult> {
  const agent = agentMap.get(node.agent_id)
  if (!agent) {
    return { node_id: node.id, agent_id: node.agent_id, agent_name: node.label ?? node.agent_id, status: "failed", input: null, output: null, latency_ms: 0, cost: 0, error: "Agent not found" }
  }

  const startMs = Date.now()

  try {
    // Build node input from upstream edges
    const upstreamEdges = edges.filter(e => e.to === node.id)
    let nodeInput: unknown

    if (upstreamEdges.length === 0) {
      // Root node — use pipeline input
      nodeInput = typeof pipelineInput === "string"
        ? interpolate(pipelineInput, variables, nodeOutputs)
        : pipelineInput
    } else {
      const upstreamOutputs = upstreamEdges.map(e => nodeOutputs[e.from]).filter(v => v !== undefined)
      if (node.input_mapping) {
        nodeInput = applyInputMapping(node.input_mapping, upstreamOutputs, variables)
      } else {
        nodeInput = upstreamOutputs.length === 1 ? upstreamOutputs[0] : upstreamOutputs
      }
    }

    const userMessage = typeof nodeInput === "string" ? nodeInput : JSON.stringify(nodeInput)

    // Build system prompt — use override if provided, else agent default
    let systemPrompt = (node.system_prompt_override ?? agent.system_prompt ?? "").trim()

    // Inject RAG context if agent has a knowledge base
    if (agent.knowledge_base_id) {
      const ragResult = await retrieveRAGContext(supabase, agent.knowledge_base_id, userMessage, { topK: 5, threshold: 0.65 })
      systemPrompt = buildRAGSystemPrompt(systemPrompt, ragResult)
    }

    // Context compression: cap input to max_tokens budget to avoid over-spending
    const maxInputChars = Math.min(32000, (agent.max_tokens ?? 4096) * 3)
    const safeMessage   = userMessage.slice(0, maxInputChars)

    const { text: rawText, inputTokens, outputTokens, costUsd } = await routeCompletion({
      model:       agent.model_name || "claude-sonnet-4-20250514",
      system:      systemPrompt,
      userMessage: safeMessage,
      maxTokens:   agent.max_tokens || 4096,
      temperature: agent.temperature ?? 0.7,
    })

    const latencyMs = Date.now() - startMs
    const { text: safeText } = sanitizeOutput(rawText)
    let output: unknown = safeText
    try { output = JSON.parse(safeText) } catch {}

    // Persist individual execution record for observability
    await supabase.from("executions").insert({
      agent_id: node.agent_id, user_id: userId, status: "success",
      input: nodeInput, output, tokens_input: inputTokens, tokens_output: outputTokens,
      latency_ms: latencyMs, cost_usd: costUsd, completed_at: new Date().toISOString(),
    })
    await supabase.rpc("increment_executions_used", { user_id_param: userId })

    return { node_id: node.id, agent_id: node.agent_id, agent_name: agent.name ?? node.id, status: "success", input: nodeInput, output, latency_ms: latencyMs, cost: costUsd, tokens: { input: inputTokens, output: outputTokens } }

  } catch (err: any) {
    return { node_id: node.id, agent_id: node.agent_id, agent_name: agent.name ?? node.id, status: "failed", input: null, output: null, latency_ms: Date.now() - startMs, cost: 0, error: err.message }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function interpolate(template: string, variables: Record<string, string>, nodeOutputs: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in variables)   return String(variables[key])
    if (key in nodeOutputs) return JSON.stringify(nodeOutputs[key])
    return `{{${key}}}`
  })
}

function applyInputMapping(mapping: Record<string, string>, upstreamOutputs: unknown[], variables: Record<string, string>): unknown {
  const result: Record<string, unknown> = {}
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (sourceExpr.startsWith("node.") && upstreamOutputs.length > 0) {
      const parts = sourceExpr.split(".")
      let val: any = upstreamOutputs[parseInt(parts[1] ?? "0")]
      for (let i = 2; i < parts.length; i++) val = val?.[parts[i]!]
      result[targetKey] = val
    } else if (sourceExpr in variables) {
      result[targetKey] = variables[sourceExpr]
    } else {
      result[targetKey] = sourceExpr
    }
  }
  return result
}

async function failPipelineExec(supabase: any, execId: string, errorMsg: string, nodeResults: NodeResult[] = [], cost = 0, tokensIn = 0, tokensOut = 0, latency = 0) {
  await supabase.from("pipeline_executions").update({
    status: "failed", error_message: errorMsg, node_results: nodeResults,
    total_cost: cost, total_tokens_in: tokensIn, total_tokens_out: tokensOut,
    total_latency_ms: latency, completed_at: new Date().toISOString(),
  }).eq("id", execId)
}
