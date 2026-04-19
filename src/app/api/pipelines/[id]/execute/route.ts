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
 * Parallel DAG Execution Engine — production hardened:
 *
 * Security:
 * ✅ Auth (session or API key)
 * ✅ Banned-user check
 * ✅ Quota enforcement (per-node)
 * ✅ Injection filter on pipeline input
 * ✅ Per-node input sanitisation
 * ✅ Credits deduction after success
 * ✅ Timeout enforcement per pipeline
 * ✅ Cycle detection via topological sort
 *
 * Performance:
 * ✅ Nodes in same topological level run in parallel (Promise.all)
 * ✅ RAG context injected per-node when knowledge_base_id set
 * ✅ Per-node output stored as jsonb (never bare string)
 * ✅ Partial failure recovery via continue_on_failure flag
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
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    if (!UUID_RE.test(pipelineId))
      return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })

    const supabase = await createClient()

    // ── Auth ────────────────────────────────────────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")
      if (rawKey && rawKey.length <= 200) {
        const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
        const { data: keyRow } = await supabase
          .from("api_keys").select("user_id, is_active, expires_at").eq("key_hash", hash).single()
        if (keyRow?.is_active && !(keyRow.expires_at && new Date(keyRow.expires_at) < new Date())) {
          userId = keyRow.user_id
        }
      }
    }

    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── Profile: ban check + quota ───────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan, is_banned")
      .eq("id", userId)
      .single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 })

    // ── Load pipeline ────────────────────────────────────────────────────────
    const { data: pipeline } = await supabase
      .from("pipelines").select("*").eq("id", pipelineId).single()

    if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (pipeline.is_active === false) return NextResponse.json({ error: "Pipeline is inactive" }, { status: 404 })
    if (!pipeline.is_public && pipeline.owner_id !== userId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const dag: { nodes: DAGNode[]; edges: DAGEdge[] } = pipeline.dag ?? { nodes: [], edges: [] }
    const nodeCount = dag.nodes.length

    if (nodeCount === 0)
      return NextResponse.json({ error: "Pipeline has no agents configured" }, { status: 422 })
    if (nodeCount > 50)
      return NextResponse.json({ error: "Pipeline exceeds 50 node limit" }, { status: 400 })

    // ── Quota check (nodes × 1 execution each) ───────────────────────────────
    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0

    if (quota !== -1 && used + nodeCount > quota)
      return NextResponse.json({
        error: `Pipeline needs ${nodeCount} quota units but only ${Math.max(0, quota - used)} remaining`,
        code:  "QUOTA_EXCEEDED",
      }, { status: 429 })

    // ── Load credits ─────────────────────────────────────────────────────────
    const { data: credits } = await supabase
      .from("credits").select("balance_usd").eq("user_id", userId).single()

    // ── Validate all agents ──────────────────────────────────────────────────
    const agentIds = [...new Set(dag.nodes.map(n => n.agent_id).filter(Boolean))]
    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, name, price_per_call, pricing_model, model_name, system_prompt, max_tokens, temperature, status, free_calls_per_month, knowledge_base_id")
      .in("id", agentIds)

    if (!agentRows || agentRows.length !== agentIds.length) {
      const foundIds = new Set(agentRows?.map((a: any) => a.id))
      const missing  = agentIds.filter(id => !foundIds.has(id))
      return NextResponse.json({ error: `Agents not found: ${missing.join(", ")}` }, { status: 422 })
    }

    const agentMap = new Map<string, any>(agentRows.map((a: any) => [a.id, a]))
    for (const a of agentRows) {
      if ((a as any).status !== "active")
        return NextResponse.json({ error: `Agent "${(a as any).name}" is not active` }, { status: 422 })
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    let body: { input?: unknown; variables?: Record<string, string> }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input = "", variables = {} } = body

    // Validate variables object
    if (typeof variables !== "object" || Array.isArray(variables))
      return NextResponse.json({ error: "variables must be a JSON object" }, { status: 400 })

    const inputStr = typeof input === "string" ? input : JSON.stringify(input)

    // ── Injection filter on pipeline input ────────────────────────────────────
    const { filterResult } = runInjectionPipeline(inputStr, "user")
    if (!filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: null,
        input:   inputStr.slice(0, 500),
        pattern: (filterResult as any).pattern,
        action:  "blocked",
      }).then(() => {})
      return NextResponse.json({ error: "Input rejected by security filter", code: "INJECTION_BLOCKED" }, { status: 400 })
    }

    // ── Create pipeline execution record ─────────────────────────────────────
    const { data: pipelineExec } = await supabase
      .from("pipeline_executions")
      .insert({
        pipeline_id: pipelineId,
        user_id:     userId,
        status:      "running",
        input:       { value: inputStr, variables },
      })
      .select("id")
      .single()

    if (!pipelineExec?.id)
      return NextResponse.json({ error: "Failed to create execution record" }, { status: 500 })

    // ── Topological level grouping ────────────────────────────────────────────
    const { levels, cycle } = topologicalLevels(dag.nodes, dag.edges)
    if (cycle) {
      await failPipelineExec(supabase, pipelineExec.id, "Pipeline DAG has a cycle")
      return NextResponse.json({ error: "Pipeline DAG contains a cycle — cannot execute" }, { status: 422 })
    }

    // ── Execute levels ────────────────────────────────────────────────────────
    const nodeOutputs: Record<string, unknown> = {}
    const nodeResults: NodeResult[] = []
    let totalCost      = 0
    let totalTokensIn  = 0
    let totalTokensOut = 0
    let lastOutput: unknown = inputStr

    const timeoutMs = Math.min((pipeline.timeout_seconds ?? 300) * 1000, 600_000) // max 10 min
    const deadline  = Date.now() + timeoutMs

    for (const level of levels) {
      if (Date.now() > deadline) {
        await failPipelineExec(supabase, pipelineExec.id, "Pipeline timed out",
          nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({ error: "Pipeline execution timed out", executionId: pipelineExec.id }, { status: 408 })
      }

      // Run all nodes in this level concurrently
      const levelResults = await Promise.all(
        level.map(node =>
          executeNode(node, dag.edges, agentMap, nodeOutputs, input, variables, userId!, supabase)
        )
      )

      let levelFailed = false
      for (const result of levelResults) {
        nodeResults.push(result)
        nodeOutputs[result.node_id] = result.output

        if (result.status === "success") {
          totalCost      += result.cost
          totalTokensIn  += result.tokens?.input  ?? 0
          totalTokensOut += result.tokens?.output ?? 0
          if (result.output !== null && result.output !== undefined) {
            lastOutput = result.output
          }
        } else {
          const node = dag.nodes.find(n => n.id === result.node_id)
          if (!node?.continue_on_failure) {
            levelFailed = true
          } else {
            nodeOutputs[result.node_id] = null  // pass null downstream
          }
        }
      }

      if (levelFailed) {
        const failedResult = levelResults.find(r => r.status === "failed")
        await failPipelineExec(
          supabase, pipelineExec.id,
          `Node "${failedResult?.agent_name}" (${failedResult?.node_id}) failed: ${failedResult?.error}`,
          nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal
        )
        return NextResponse.json({
          error:         `Pipeline failed at node "${failedResult?.node_id}"`,
          executionId:   pipelineExec.id,
          failed_node:   failedResult?.node_id,
          node_results:  nodeResults,
        }, { status: 500 })
      }
    }

    const totalLatency = Date.now() - startTotal

    // ── Deduct credits ────────────────────────────────────────────────────────
    if (totalCost > 0) {
      await supabase.rpc("deduct_credits", {
        user_id_param:      userId,
        amount_param:       totalCost,
        description_param:  `Pipeline: ${pipeline.name}`,
        reference_id_param: pipelineExec.id,
      })
    }

    // ── Finalise ──────────────────────────────────────────────────────────────
    await supabase.from("pipeline_executions").update({
      status:           "success",
      output:           typeof lastOutput === "object" ? lastOutput : { text: String(lastOutput) },
      node_results:     nodeResults,
      total_latency_ms: totalLatency,
      total_cost:       totalCost,
      total_tokens_in:  totalTokensIn,
      total_tokens_out: totalTokensOut,
      completed_at:     new Date().toISOString(),
    }).eq("id", pipelineExec.id)

    return NextResponse.json({
      executionId:  pipelineExec.id,
      status:       "success",
      output:       lastOutput,
      node_results: nodeResults,
      summary: {
        nodes_executed:   nodeResults.filter(r => r.status === "success").length,
        nodes_failed:     nodeResults.filter(r => r.status === "failed").length,
        total_latency_ms: totalLatency,
        total_cost_usd:   totalCost.toFixed(6),
        total_tokens:     { input: totalTokensIn, output: totalTokensOut },
      },
    })

  } catch (err: any) {
    console.error("POST /api/pipelines/[id]/execute:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DAGNode {
  id:                      string
  agent_id:                string
  label?:                  string
  system_prompt_override?: string
  input_mapping?:          Record<string, string>
  continue_on_failure?:    boolean
}

interface DAGEdge { from: string; to: string }

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

// ─── Topological level grouping ───────────────────────────────────────────────
// Groups nodes into levels where nodes within a level have no dependency on
// each other and can execute concurrently.

function topologicalLevels(
  nodes: DAGNode[],
  edges: DAGEdge[]
): { levels: DAGNode[][]; cycle: boolean } {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()
  const nodeMap  = new Map<string, DAGNode>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
    nodeMap.set(n.id, n)
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const levels: DAGNode[][] = []
  let processed = 0

  while (queue.length > 0) {
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

  return { levels, cycle: processed !== nodes.length }
}

// ─── Node executor ────────────────────────────────────────────────────────────

async function executeNode(
  node:          DAGNode,
  edges:         DAGEdge[],
  agentMap:      Map<string, any>,
  nodeOutputs:   Record<string, unknown>,
  pipelineInput: unknown,
  variables:     Record<string, string>,
  userId:        string,
  supabase:      any
): Promise<NodeResult> {
  const agent = agentMap.get(node.agent_id)
  if (!agent) {
    return { node_id: node.id, agent_id: node.agent_id, agent_name: node.label ?? "Unknown",
      status: "failed", input: null, output: null, latency_ms: 0, cost: 0, error: "Agent not found" }
  }

  const startMs = Date.now()

  try {
    // Build this node's input from upstream edges (or pipeline root)
    const upstreamEdges = edges.filter(e => e.to === node.id)
    let nodeInput: unknown

    if (upstreamEdges.length === 0) {
      // Root node
      nodeInput = typeof pipelineInput === "string"
        ? interpolate(pipelineInput, variables, nodeOutputs)
        : pipelineInput
    } else {
      const upstreamOutputs = upstreamEdges
        .map(e => nodeOutputs[e.from])
        .filter(v => v !== undefined && v !== null)

      if (node.input_mapping) {
        nodeInput = applyInputMapping(node.input_mapping, upstreamOutputs, variables)
      } else {
        nodeInput = upstreamOutputs.length === 1 ? upstreamOutputs[0] : upstreamOutputs
      }
    }

    const userMessage = typeof nodeInput === "string"
      ? nodeInput
      : JSON.stringify(nodeInput)

    // Input sanitisation for each node
    const { filterResult } = runInjectionPipeline(userMessage.slice(0, 2000), "user")
    if (!filterResult.allowed) {
      throw new Error("Node input rejected by injection filter")
    }

    // System prompt
    let systemPrompt = (node.system_prompt_override ?? agent.system_prompt ?? "").trim()
    if (!systemPrompt) throw new Error("Agent has no system prompt configured")

    // RAG injection
    if (agent.knowledge_base_id) {
      const ragResult = await retrieveRAGContext(supabase, agent.knowledge_base_id, userMessage, {
        topK: 4, threshold: 0.65,
      })
      systemPrompt = buildRAGSystemPrompt(systemPrompt, ragResult)
    }

    // Input size cap
    const maxInputChars = Math.min(32_000, (agent.max_tokens ?? 4096) * 3)
    const safeMessage   = userMessage.slice(0, maxInputChars)

    const { text: rawText, inputTokens, outputTokens, costUsd } = await routeCompletion({
      model:       agent.model_name || "claude-sonnet-4-20250514",
      system:      systemPrompt,
      userMessage: safeMessage,
      maxTokens:   Math.min(agent.max_tokens || 4096, 8192),
      temperature: agent.temperature ?? 0.7,
    })

    const latencyMs = Date.now() - startMs
    const { text: safeText } = sanitizeOutput(rawText)

    // Parse output — store as jsonb in executions table
    let outputParsed: unknown = safeText
    try { outputParsed = JSON.parse(safeText) } catch {}
    const outputJson: Record<string, unknown> = typeof outputParsed === "object" && outputParsed !== null
      ? outputParsed as Record<string, unknown>
      : { text: safeText }

    // Persist per-node execution record (fire-and-forget, don't block pipeline)
    Promise.all([
      supabase.from("executions").insert({
        agent_id:     node.agent_id,
        user_id:      userId,
        status:       "success",
        input:        typeof nodeInput === "object" ? nodeInput : { text: userMessage },
        output:       outputJson,
        tokens_input: inputTokens,
        tokens_output: outputTokens,
        latency_ms:   latencyMs,
        cost_usd:     costUsd,
        completed_at: new Date().toISOString(),
      }),
      supabase.rpc("increment_executions_used", { user_id_param: userId }),
    ]).catch(() => {})  // don't let observability writes block execution

    return {
      node_id:    node.id,
      agent_id:   node.agent_id,
      agent_name: agent.name ?? node.label ?? node.id,
      status:     "success",
      input:      nodeInput,
      output:     outputParsed,
      latency_ms: latencyMs,
      cost:       costUsd,
      tokens:     { input: inputTokens, output: outputTokens },
    }

  } catch (err: any) {
    return {
      node_id:    node.id,
      agent_id:   node.agent_id,
      agent_name: agent.name ?? node.label ?? node.id,
      status:     "failed",
      input:      null,
      output:     null,
      latency_ms: Date.now() - startMs,
      cost:       0,
      error:      err.message ?? "Unknown error",
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(
  template:    string,
  variables:   Record<string, string>,
  nodeOutputs: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in variables)   return String(variables[key])
    if (key in nodeOutputs) return JSON.stringify(nodeOutputs[key])
    return `{{${key}}}`
  })
}

function applyInputMapping(
  mapping:         Record<string, string>,
  upstreamOutputs: unknown[],
  variables:       Record<string, string>
): unknown {
  const result: Record<string, unknown> = {}
  for (const [targetKey, sourceExpr] of Object.entries(mapping)) {
    if (sourceExpr.startsWith("node.")) {
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

async function failPipelineExec(
  supabase:    any,
  execId:      string,
  errorMsg:    string,
  nodeResults: NodeResult[] = [],
  cost         = 0,
  tokensIn     = 0,
  tokensOut    = 0,
  latency      = 0
) {
  await supabase.from("pipeline_executions").update({
    status:           "failed",
    error_message:    errorMsg.slice(0, 500),
    node_results:     nodeResults,
    total_cost:       cost,
    total_tokens_in:  tokensIn,
    total_tokens_out: tokensOut,
    total_latency_ms: latency,
    completed_at:     new Date().toISOString(),
  }).eq("id", execId)
}
