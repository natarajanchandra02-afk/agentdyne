export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"
import { runInjectionPipeline, sanitizeOutput } from "@/lib/injection-filter"

/**
 * POST /api/pipelines/[id]/execute
 *
 * DAG Execution Engine — executes a multi-agent workflow.
 *
 * Algorithm:
 *   1. Load pipeline + resolve agent nodes
 *   2. Topological sort of the DAG
 *   3. Execute each node in dependency order
 *      — Output of node A becomes input to node B (via edge mapping)
 *      — Parallel nodes (no shared dependency) run sequentially for edge safety
 *   4. Persist full pipeline_execution record with per-node results
 *   5. Return final output (last node's output in the DAG)
 *
 * Body:
 *   input       — initial input (passed to all root nodes)
 *   variables   — optional key-value map injected into any node's input template
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

    // ── Auth ────────────────────────────────────────────────────────────────
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // ── Load pipeline ───────────────────────────────────────────────────────
    const { data: pipeline } = await supabase
      .from("pipelines")
      .select("*")
      .eq("id", pipelineId)
      .single()

    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    }
    if (pipeline.is_active === false) {
      return NextResponse.json({ error: "Pipeline is inactive" }, { status: 404 })
    }

    // ── Auth: only owner can execute (or public pipelines by anyone) ─────────
    if (!pipeline.is_public && pipeline.owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // ── Quota check ─────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan")
      .eq("id", user.id)
      .single()

    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0
    const dag   = pipeline.dag as { nodes: DAGNode[]; edges: DAGEdge[] }
    const nodeCount = dag.nodes.length

    // Each node in the pipeline consumes 1 execution quota unit
    if (quota !== -1 && used + nodeCount > quota) {
      return NextResponse.json(
        { error: `Pipeline has ${nodeCount} nodes but only ${quota - used} quota remaining`, code: "QUOTA_EXCEEDED" },
        { status: 429 }
      )
    }

    // ── Credits check ───────────────────────────────────────────────────────
    const { data: credits } = await supabase
      .from("credits")
      .select("balance_usd, hard_limit_usd")
      .eq("user_id", user.id)
      .single()

    // Estimate max cost (all nodes at their per_call price)
    const agentIds = dag.nodes.map(n => n.agent_id).filter(Boolean)
    const { data: agentPrices } = await supabase
      .from("agents")
      .select("id, name, price_per_call, pricing_model, model_name, system_prompt, max_tokens, temperature, status, free_calls_per_month")
      .in("id", agentIds)

    if (!agentPrices || agentPrices.length !== agentIds.length) {
      return NextResponse.json(
        { error: "One or more agents in this pipeline are not found or inactive" },
        { status: 422 }
      )
    }

    const agentMap = new Map(agentPrices.map(a => [a.id, a]))
    for (const a of agentPrices) {
      if (a.status !== "active") {
        return NextResponse.json(
          { error: `Agent "${a.id}" is not active` },
          { status: 422 }
        )
      }
    }

    // ── Parse request ────────────────────────────────────────────────────────
    const body      = await req.json()
    const { input = "", variables = {} } = body

    // ── Create pipeline execution record ────────────────────────────────────
    const { data: pipelineExec } = await supabase
      .from("pipeline_executions")
      .insert({
        pipeline_id: pipelineId,
        user_id:     user.id,
        status:      "running",
        input:       { value: input, variables },
      })
      .select()
      .single()

    // ── Topological sort ─────────────────────────────────────────────────────
    const sorted = topologicalSort(dag.nodes, dag.edges)
    if (!sorted) {
      await failPipelineExec(supabase, pipelineExec!.id, "Pipeline DAG has a cycle — cannot execute")
      return NextResponse.json({ error: "Pipeline DAG contains a cycle" }, { status: 422 })
    }

    // ── Execute each node in order ───────────────────────────────────────────
    const nodeOutputs: Record<string, unknown> = {}
    const nodeResults: NodeResult[] = []
    let   totalCost      = 0
    let   totalTokensIn  = 0
    let   totalTokensOut = 0
    let   lastOutput: unknown = input

    const timeoutMs = (pipeline.timeout_seconds ?? 300) * 1000
    const deadline  = Date.now() + timeoutMs

    for (const node of sorted) {
      if (Date.now() > deadline) {
        await failPipelineExec(supabase, pipelineExec!.id, "Pipeline execution timed out")
        return NextResponse.json({ error: "Pipeline timed out", executionId: pipelineExec!.id }, { status: 408 })
      }

      const agent     = agentMap.get(node.agent_id)
      if (!agent) continue

      // Build input for this node:
      // 1. If node has upstream edges, use output of predecessor
      // 2. Otherwise use the original pipeline input
      const upstreamEdges = dag.edges.filter(e => e.to === node.id)
      let nodeInput: unknown

      if (upstreamEdges.length === 0) {
        // Root node — use pipeline input
        nodeInput = interpolate(
          typeof input === "string" ? input : JSON.stringify(input),
          variables,
          nodeOutputs
        )
      } else {
        // Merge outputs from all upstream nodes
        const upstreamOutputs = upstreamEdges
          .map(e => nodeOutputs[e.from])
          .filter(Boolean)

        nodeInput = upstreamOutputs.length === 1
          ? upstreamOutputs[0]
          : upstreamOutputs

        // Apply node-specific input mapping if configured
        if (node.input_mapping) {
          nodeInput = applyInputMapping(node.input_mapping, upstreamOutputs, variables)
        }
      }

      const nodeStart = Date.now()

      try {
        const userMessage = typeof nodeInput === "string"
          ? nodeInput
          : JSON.stringify(nodeInput)

        // Injection filter on each node's input
        const { filterResult } = runInjectionPipeline(userMessage, "user")
        if (!filterResult.allowed) {
          throw new Error("Input rejected by injection filter")
        }

        // Prepend node-specific prompt override if set
        const systemPrompt = node.system_prompt_override ?? agent.system_prompt ?? ""

        // Route to correct LLM provider based on model_name
        const { text: rawText, inputTokens, outputTokens, costUsd: nodeCost } =
          await routeCompletion({
            model:       agent.model_name || "claude-sonnet-4-20250514",
            system:      systemPrompt,
            userMessage,
            maxTokens:   agent.max_tokens || 4096,
            temperature: agent.temperature ?? 0.7,
          })

        const nodeLatency = Date.now() - nodeStart
        const { text: safeText } = sanitizeOutput(rawText)

        let nodeOutput: unknown = safeText
        try { nodeOutput = JSON.parse(safeText) } catch {}

        nodeOutputs[node.id] = nodeOutput
        lastOutput            = nodeOutput
        totalCost            += nodeCost
        totalTokensIn        += inputTokens
        totalTokensOut       += outputTokens

        nodeResults.push({
          node_id:    node.id,
          agent_id:   node.agent_id,
          agent_name: agent.name ?? node.id,
          status:     "success",
          input:      nodeInput,
          output:     nodeOutput,
          latency_ms: nodeLatency,
          cost:       nodeCost,
          tokens: {
            input:  inputTokens,
            output: outputTokens,
          },
        })

        // Persist individual execution record per node
        await supabase.from("executions").insert({
          agent_id: node.agent_id,
          user_id:  user.id,
          status:   "success",
          input:    nodeInput,
          output:   nodeOutput,
          tokens_input:  response.usage.input_tokens,
          tokens_output: response.usage.output_tokens,
          latency_ms:    nodeLatency,
          cost_usd:      nodeCost,
          completed_at:  new Date().toISOString(),
        })

        // Increment quota per node
        await supabase.rpc("increment_executions_used", { user_id_param: user.id })

      } catch (nodeErr: any) {
        const nodeLatency = Date.now() - nodeStart

        nodeResults.push({
          node_id:    node.id,
          agent_id:   node.agent_id,
          agent_name: agentMap.get(node.agent_id)?.name ?? node.id,
          status:     "failed",
          input:      nodeInput,
          output:     null,
          latency_ms: nodeLatency,
          cost:       0,
          error:      nodeErr.message,
        })

        // Decide whether to abort or continue
        if (!node.continue_on_failure) {
          // Fail the whole pipeline
          await failPipelineExec(
            supabase,
            pipelineExec!.id,
            `Node "${node.id}" failed: ${nodeErr.message}`,
            nodeResults,
            totalCost,
            totalTokensIn,
            totalTokensOut,
            Date.now() - startTotal
          )
          return NextResponse.json({
            error:          `Pipeline failed at node "${node.id}"`,
            failed_node:    node.id,
            executionId:    pipelineExec!.id,
            node_results:   nodeResults,
            partial_output: lastOutput,
          }, { status: 500 })
        }

        // continue_on_failure=true: pass null downstream
        nodeOutputs[node.id] = null
      }
    }

    const totalLatency = Date.now() - startTotal

    // ── Deduct credits ───────────────────────────────────────────────────────
    if (totalCost > 0 && credits) {
      await supabase.rpc("deduct_credits", {
        user_id_param:     user.id,
        amount_param:      totalCost,
        description_param: `Pipeline: ${pipeline.name}`,
        reference_id_param: pipelineExec!.id,
      })
    }

    // ── Finalise pipeline execution record ───────────────────────────────────
    await supabase.from("pipeline_executions").update({
      status:           "success",
      output:           lastOutput,
      node_results:     nodeResults,
      total_latency_ms: totalLatency,
      total_cost:       totalCost,
      total_tokens_in:  totalTokensIn,
      total_tokens_out: totalTokensOut,
      completed_at:     new Date().toISOString(),
    }).eq("id", pipelineExec!.id)

    return NextResponse.json({
      executionId:  pipelineExec!.id,
      status:       "success",
      output:       lastOutput,
      node_results: nodeResults,
      summary: {
        nodes_executed:  nodeResults.length,
        total_latency_ms: totalLatency,
        total_cost_usd:  totalCost.toFixed(6),
        total_tokens:    { input: totalTokensIn, output: totalTokensOut },
      },
    })

  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/execute:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

interface DAGNode {
  id:                     string
  agent_id:               string
  label?:                 string
  system_prompt_override?: string
  input_mapping?:         Record<string, string>
  continue_on_failure?:   boolean
  config?:                Record<string, unknown>
}

interface DAGEdge {
  from:       string
  to:         string
  condition?: string
}

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

// ── Topological sort (Kahn's algorithm) ──────────────────────────────────

function topologicalSort(
  nodes: DAGNode[],
  edges: DAGEdge[]
): DAGNode[] | null {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adj.set(node.id, [])
  }

  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to)
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
  }

  const queue:  string[]   = []
  const result: DAGNode[]  = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  while (queue.length > 0) {
    const cur = queue.shift()!
    const node = nodeMap.get(cur)
    if (node) result.push(node)

    for (const next of adj.get(cur) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }

  // Cycle detected
  if (result.length !== nodes.length) return null
  return result
}

// ── Template variable interpolation ──────────────────────────────────────

function interpolate(
  template: string,
  variables: Record<string, string>,
  nodeOutputs: Record<string, unknown>
): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key in variables)    return String(variables[key])
      if (key in nodeOutputs)  return JSON.stringify(nodeOutputs[key])
      return `{{${key}}}`
    })
}

function applyInputMapping(
  mapping: Record<string, string>,
  upstreamOutputs: unknown[],
  variables: Record<string, string>
): unknown {
  const result: Record<string, unknown> = {}
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (sourceExpr.startsWith("node.") && upstreamOutputs.length > 0) {
      // e.g. "node.0.summary" → upstreamOutputs[0].summary
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

// ── Persist pipeline failure ──────────────────────────────────────────────

async function failPipelineExec(
  supabase: any,
  execId: string,
  errorMsg: string,
  nodeResults: NodeResult[] = [],
  cost = 0,
  tokensIn = 0,
  tokensOut = 0,
  latency = 0
) {
  await supabase.from("pipeline_executions").update({
    status:           "failed",
    error_message:    errorMsg,
    node_results:     nodeResults,
    total_cost:       cost,
    total_tokens_in:  tokensIn,
    total_tokens_out: tokensOut,
    total_latency_ms: latency,
    completed_at:     new Date().toISOString(),
  }).eq("id", execId)
}
