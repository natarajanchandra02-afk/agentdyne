export const runtime = 'edge'

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { apiRateLimit } from "@/lib/rate-limit"
import { routeCompletion } from "@/lib/model-router"
import { runInjectionPipeline, sanitizeOutput } from "@/lib/injection-filter"
import { retrieveRAGContext, buildRAGSystemPrompt } from "@/lib/rag-retriever"
import { estimatePipelineCost, checkConcurrencyLimit } from "@/lib/concurrency"
import { evaluateSafeCondition } from "@/lib/safe-condition-evaluator"

/**
 * POST /api/pipelines/[id]/execute
 *
 * Production-grade parallel DAG Execution Engine.
 *
 * Features:
 * ✅ Per-node retry policy (max_retries, retry_delay_ms, retry_on_errors)
 * ✅ Per-node fallback agent (fallback_agent_id)
 * ✅ Shared pipeline state (__state key flows through all nodes)
 * ✅ Pipeline version snapshot (pinning after each successful run)
 * ✅ Schema strict mode — fails pipeline on schema mismatch when enabled
 * ✅ Node-level timing + retry count in results
 * ✅ Agent pipeline usage tracking (powers "used in X pipelines" badge)
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

    // ── Auth ──────────────────────────────────────────────────────────────────
    let userId: string | undefined
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id

    // ─ Share key internal call: verified via HMAC (replaces plain service key header) ───────
    // /api/run/[shareKey] signs: shareKey.pipelineId.timestamp with SUPABASE_SERVICE_ROLE_KEY
    // We verify the signature here. Timestamp must be < 30s old to prevent replay attacks.
    if (!userId) {
      const hmacHeader   = req.headers.get("x-internal-hmac")
      const shareOwnerId = req.headers.get("x-share-owner-id")
      const shareKeyHdr  = req.headers.get("x-pipeline-share-key")

      if (hmacHeader && shareOwnerId && shareKeyHdr) {
        try {
          const [tsStr, sig] = hmacHeader.split(".")
          const ts           = parseInt(tsStr ?? "0")
          // Reject if token is older than 30 seconds (prevents replay)
          if (Date.now() - ts < 30_000) {
            const secret      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
            const sigPayload  = new TextEncoder().encode(`${shareKeyHdr}.${id}.${ts}`)
            const keyMaterial = await crypto.subtle.importKey(
              "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
            )
            const sigBytes = new Uint8Array((sig ?? "").match(/.{2}/g)?.map(h => parseInt(h, 16)) ?? [])
            const valid    = await crypto.subtle.verify("HMAC", keyMaterial, sigBytes, sigPayload)
            if (valid) userId = shareOwnerId
          }
        } catch { /* HMAC verify failed — fall through to 401 */ }
      }
    }

    if (!userId) {
      const rawKey =
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
        req.headers.get("x-api-key")
      if (rawKey && rawKey.length <= 200) {
        const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey))
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("")
        const { data: keyRow } = await supabase
          .from("api_keys").select("user_id, is_active, expires_at").eq("key_hash", hash).single()
        if (keyRow?.is_active && !(keyRow.expires_at && new Date(keyRow.expires_at) < new Date()))
          userId = keyRow.user_id
      }
    }
    if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

    // ── Profile ───────────────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("executions_used_this_month, monthly_execution_quota, subscription_plan, is_banned")
      .eq("id", userId).single()

    if (profile?.is_banned)
      return NextResponse.json({ error: "Your account has been suspended." }, { status: 403 })

    // ── Concurrency limit ────────────────────────────────────────────────────
    const plan = (profile?.subscription_plan ?? "free") as any
    const concurrency = await checkConcurrencyLimit(supabase, userId!, plan)
    if (!concurrency.allowed) {
      const res = NextResponse.json({
        error: concurrency.message, code: concurrency.code,
        current: concurrency.current, limit: concurrency.limit,
      }, { status: 429 })
      if (concurrency.retryAfter) res.headers.set("Retry-After", String(concurrency.retryAfter))
      return res
    }

    // ── Load pipeline ─────────────────────────────────────────────────────────
    const { data: pipeline } = await supabase
      .from("pipelines").select("*").eq("id", pipelineId).single()

    if (!pipeline)
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 })
    if (!pipeline.is_active)
      return NextResponse.json({ error: "Pipeline is inactive" }, { status: 404 })
    if (!pipeline.is_public && pipeline.owner_id !== userId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const dag = pipeline.dag as {
      nodes:             DAGNode[]
      edges:             DAGEdge[]
      strict_schema_mode?: boolean
    }
    const strictSchemaMode = dag.strict_schema_mode ?? false
    const nodeCount        = dag.nodes.length

    if (nodeCount === 0)
      return NextResponse.json({ error: "Pipeline has no agents" }, { status: 422 })
    if (nodeCount > 50)
      return NextResponse.json({ error: "Pipeline exceeds 50 node limit" }, { status: 400 })

    // ── Quota ─────────────────────────────────────────────────────────────────
    const quota = profile?.monthly_execution_quota ?? 100
    const used  = profile?.executions_used_this_month ?? 0
    if (quota !== -1 && used + nodeCount > quota)
      return NextResponse.json({
        error: `Pipeline needs ${nodeCount} quota units but only ${Math.max(0, quota - used)} remaining`,
        code: "QUOTA_EXCEEDED",
      }, { status: 429 })

    // ── Load agents FIRST (needed for cost estimation) ───────────────────────
    const allAgentIds = [
      ...new Set([
        ...dag.nodes.map(n => n.agent_id),
        ...dag.nodes.map(n => n.fallback_agent_id).filter(Boolean) as string[],
      ].filter(Boolean))
    ]

    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, name, price_per_call, pricing_model, model_name, system_prompt, max_tokens, temperature, status, free_calls_per_month, knowledge_base_id, security_config, input_schema, output_schema")
      .in("id", allAgentIds)

    // ── Credits + pre-flight reservation ─────────────────────────────────────
    // Reserve credits BEFORE execution so $0-balance users can't run for free.
    // Post-execution: commit with actual cost (releases diff) or release on failure.
    const { data: credits } = await supabase
      .from("credits").select("balance_usd").eq("user_id", userId).single()

    const MODEL_COSTS: Record<string, { input: number; output: number }> = {
      "claude-haiku-4-5-20251001": { input: 0.00025, output: 0.00125 },
      "claude-sonnet-4-6":         { input: 0.003,   output: 0.015   },
      "claude-opus-4-6":           { input: 0.015,   output: 0.075   },
    }
    const estimatedCost = (agentRows ?? []).reduce((sum: number, a: any) => {
      const m   = MODEL_COSTS[a.model_name as string] ?? { input: 0.003, output: 0.015 }
      const tok = Math.min((a.max_tokens as number || 4096), 4096)
      return sum + (500 / 1000) * m.input + (tok * 0.7 / 1000) * m.output
    }, 0) * 3.3  // 3.3× platform margin covers failure overhead + infra

    const creditBalance = Number(credits?.balance_usd ?? 0)
    let pipelineCreditReservationId: string | null = null

    if (estimatedCost > 0.000_01) {
      if (creditBalance < estimatedCost) {
        return NextResponse.json({
          error:    "Insufficient credits for pipeline execution.",
          code:     "INSUFFICIENT_CREDITS",
          balance:  creditBalance,
          required: +estimatedCost.toFixed(6),
        }, { status: 402 })
      }
      const { data: reservation } = await supabase.rpc("reserve_credits", {
        user_id_param:      userId,
        amount_param:       estimatedCost,
        execution_id_param: null,
      })
      if (reservation?.success) {
        pipelineCreditReservationId = reservation.reservation_id as string
      }
    }

    const agentMap = new Map<string, any>((agentRows ?? []).map((a: any) => [a.id, a]))

    for (const node of dag.nodes) {
      const a = agentMap.get(node.agent_id)
      if (!a) return NextResponse.json({ error: `Agent "${node.agent_id}" not found` }, { status: 422 })
      if (a.status !== "active") return NextResponse.json({ error: `Agent "${a.name}" is not active` }, { status: 422 })
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body: { input?: unknown; variables?: Record<string, string>; state?: Record<string, unknown> }
    try { body = await req.json() }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }

    const { input = "", variables = {}, state: initialState = {} } = body
    const inputStr = typeof input === "string" ? input : JSON.stringify(input)

    const { filterResult } = runInjectionPipeline(inputStr, "user")
    if (!filterResult.allowed) {
      supabase.from("injection_attempts").insert({
        user_id: userId, agent_id: null,
        input: inputStr.slice(0, 500), pattern: (filterResult as any).pattern, action: "blocked",
      }).then(() => {})
      return NextResponse.json({ error: "Input rejected by security filter", code: "INJECTION_BLOCKED" }, { status: 400 })
    }

    // ── Create execution record ───────────────────────────────────────────────
    const { data: pipelineExec } = await supabase
      .from("pipeline_executions")
      .insert({ pipeline_id: pipelineId, user_id: userId, status: "running", input: { value: inputStr, variables } })
      .select("id").single()

    if (!pipelineExec?.id)
      return NextResponse.json({ error: "Failed to create execution record" }, { status: 500 })

    // ── Topological sort ──────────────────────────────────────────────────────
    const { levels, cycle } = topologicalLevels(dag.nodes, dag.edges)
    if (cycle) {
      await failPipelineExec(supabase, pipelineExec.id, "Pipeline DAG has a cycle")
      return NextResponse.json({ error: "Pipeline DAG contains a cycle" }, { status: 422 })
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const nodeOutputs:   Record<string, unknown> = {}
    const nodeResults:   NodeResult[]            = []
    const pipelineState: Record<string, unknown> = { ...initialState }
    let totalCost = 0, totalTokensIn = 0, totalTokensOut = 0
    let lastOutput: unknown = inputStr

    const timeoutMs = Math.min((pipeline.timeout_seconds ?? 300) * 1000, 600_000)
    const deadline  = Date.now() + timeoutMs

    for (const level of levels) {
      // Timeout guard
      if (Date.now() > deadline) {
        await failPipelineExec(supabase, pipelineExec.id, "Pipeline timed out",
          nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({ error: "Pipeline execution timed out", executionId: pipelineExec.id }, { status: 408 })
      }

      // Credit kill switch — abort if spend approaches available balance
      if (totalCost > 0 && totalCost >= creditBalance * 0.95) {
        if (pipelineCreditReservationId) {
          await supabase.rpc("release_credit_reservation", { reservation_id_param: pipelineCreditReservationId }).catch(() => {})
        }
        await failPipelineExec(supabase, pipelineExec.id,
          `Cost kill switch: ${totalCost.toFixed(6)} / ${creditBalance.toFixed(6)}`,
          nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({
          error: "Pipeline aborted: would exceed credit balance.", code: "COST_KILL_SWITCH",
          executionId: pipelineExec.id, node_results: nodeResults,
          partial_output: lastOutput, cost_so_far: totalCost.toFixed(6),
        }, { status: 402 })
      }

      // Filter branch nodes by condition evaluation
      const nodesToRun = level.filter(node => {
        if (node.node_type !== "branch" || !node.condition) return true
        const upEdge   = dag.edges.find(e => e.to === node.id)
        const upOutput = upEdge ? nodeOutputs[upEdge.from] : lastOutput
        const shouldRun = evaluateCondition(node.condition, upOutput, pipelineState)
        if (!shouldRun) {
          nodeResults.push({ node_id: node.id, agent_id: node.agent_id,
            agent_name: agentMap.get(node.agent_id)?.name ?? node.label ?? node.id,
            status: "skipped", input: null, output: null, latency_ms: 0, cost: 0, retry_count: 0 })
          nodeOutputs[node.id] = upOutput
        }
        return shouldRun
      })

      // ── Schema strict mode check (before executing the level) ────────────
      if (strictSchemaMode) {
        for (const node of nodesToRun) {
          const agent = agentMap.get(node.agent_id)
          if (!agent?.input_schema) continue

          const upEdges = dag.edges.filter(e => e.to === node.id)
          if (upEdges.length === 0) continue  // root node — skip (schema checked against pipeline input would be overly strict)

          // Determine what upstream output looks like
          const upstreamOutput = upEdges.length === 1
            ? nodeOutputs[upEdges[0]!.from]
            : upEdges.map(e => nodeOutputs[e.from])

          const required = (agent.input_schema as any).required ?? []
          if (required.length === 0) continue

          const upObj = typeof upstreamOutput === "object" && upstreamOutput !== null
            ? upstreamOutput as Record<string, unknown>
            : null

          if (upObj) {
            const missing = required.filter((k: string) => !(k in upObj))
            if (missing.length > 0) {
              const errMsg = `Schema strict mode: agent "${agent.name}" requires fields [${missing.join(", ")}] but upstream output does not provide them`
              await failPipelineExec(supabase, pipelineExec.id, errMsg,
                nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
              return NextResponse.json({
                error: errMsg,
                code: "SCHEMA_MISMATCH",
                executionId: pipelineExec.id,
                node_id: node.id,
                missing_fields: missing,
              }, { status: 422 })
            }
          }
        }
      }

      // Run level concurrently
      const levelResults = await Promise.all(
        nodesToRun.map(node =>
          executeNodeWithRetry(node, dag.edges, agentMap, nodeOutputs, input, variables,
            pipelineState, userId!, supabase)
        )
      )

      let levelFailed = false
      for (const result of levelResults) {
        nodeResults.push(result)
        if (result.status === "success") {
          const node     = dag.nodes.find(n => n.id === result.node_id)
          const extracted = extractOutputField(result.output, node?.output_field)
          nodeOutputs[result.node_id] = extracted

          if (typeof result.output === "object" && result.output !== null && "__state" in (result.output as any)) {
            Object.assign(pipelineState, (result.output as any).__state)
          }

          totalCost      += result.cost
          totalTokensIn  += result.tokens?.input  ?? 0
          totalTokensOut += result.tokens?.output ?? 0
          if (extracted !== null && extracted !== undefined) lastOutput = extracted
        } else if (result.status === "failed") {
          const node = dag.nodes.find(n => n.id === result.node_id)
          if (!node?.continue_on_failure) levelFailed = true
          else                            nodeOutputs[result.node_id] = null
        }
      }

      if (levelFailed) {
        const failedResult = levelResults.find(r => r.status === "failed")
        if (pipelineCreditReservationId) {
          await supabase.rpc("release_credit_reservation", { reservation_id_param: pipelineCreditReservationId }).catch(() => {})
        }
        await failPipelineExec(supabase, pipelineExec.id,
          `Node "${failedResult?.agent_name}" failed: ${failedResult?.error}`,
          nodeResults, totalCost, totalTokensIn, totalTokensOut, Date.now() - startTotal)
        return NextResponse.json({
          error: `Pipeline failed at node "${failedResult?.node_id}"`,
          executionId: pipelineExec.id,
          failed_node: failedResult?.node_id,
          node_results: nodeResults,
        }, { status: 500 })
      }
    }

    const totalLatency = Date.now() - startTotal

    if (totalCost > 0) {
      if (pipelineCreditReservationId) {
        // Commit reservation with actual cost (refunds the difference)
        await supabase.rpc("commit_credit_reservation", {
          reservation_id_param: pipelineCreditReservationId,
          actual_cost_param:    totalCost,
        }).catch(() => {})
      } else {
        // Fallback: direct deduction (for free agents where no reservation was made)
        await supabase.rpc("deduct_credits", {
          user_id_param: userId, amount_param: totalCost,
          description_param: `Pipeline: ${pipeline.name}`, reference_id_param: pipelineExec.id,
        })
      }
    } else if (pipelineCreditReservationId) {
      // Free run — release the reservation
      await supabase.rpc("release_credit_reservation", {
        reservation_id_param: pipelineCreditReservationId,
      }).catch(() => {})
    }

    const outputObj = typeof lastOutput === "object" ? lastOutput : { text: String(lastOutput) }

    await supabase.from("pipeline_executions").update({
      status: "success", output: outputObj, node_results: nodeResults,
      total_latency_ms: totalLatency, total_cost: totalCost,
      total_tokens_in: totalTokensIn, total_tokens_out: totalTokensOut,
      completed_at: new Date().toISOString(),
    }).eq("id", pipelineExec.id)

    // ── Post-run fire-and-forget ──────────────────────────────────────────────
    Promise.allSettled([
      // Version snapshot
      supabase.from("pipeline_versions").upsert({
        pipeline_id: pipelineId,
        version:     pipeline.version ?? "1.0.0",
        dag_snapshot: pipeline.dag,
        node_count:  nodeCount,
        snapshot_at: new Date().toISOString(),
      }, { onConflict: "pipeline_id,version" }),

      // Track which agents are used in this pipeline
      ...dag.nodes.map(node =>
        supabase.from("agent_pipeline_usage").upsert({
          agent_id: node.agent_id, pipeline_id: pipelineId, user_id: userId,
        }, { onConflict: "agent_id,pipeline_id" })
      ),
    ]).catch(() => {})

    return NextResponse.json({
      executionId:  pipelineExec.id,
      status:       "success",
      output:       lastOutput,
      state:        pipelineState,
      node_results: nodeResults,
      summary: {
        nodes_executed:   nodeResults.filter(r => r.status === "success").length,
        nodes_skipped:    nodeResults.filter(r => r.status === "skipped").length,
        nodes_failed:     nodeResults.filter(r => r.status === "failed").length,
        total_retries:    nodeResults.reduce((s, r) => s + (r.retry_count ?? 0), 0),
        total_latency_ms: totalLatency,
        total_cost_usd:   totalCost.toFixed(6),
        total_tokens:     { input: totalTokensIn, output: totalTokensOut },
        strict_schema:    strictSchemaMode,
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
  node_type?:              "linear" | "parallel" | "branch" | "subagent"
  system_prompt_override?: string
  input_mapping?:          Record<string, string>
  continue_on_failure?:    boolean
  condition?:              string
  output_field?:           string
  max_retries?:            number
  retry_delay_ms?:         number
  retry_on_errors?:        string[]
  fallback_agent_id?:      string
}

interface DAGEdge { from: string; to: string; condition?: string }

interface NodeResult {
  node_id:       string
  agent_id:      string
  agent_name:    string
  status:        "success" | "failed" | "skipped"
  input:         unknown
  output:        unknown
  latency_ms:    number
  cost:          number
  tokens?:       { input: number; output: number }
  error?:        string
  retry_count:   number
  used_fallback?: boolean
}

// ─── Condition evaluator (delegates to safe evaluator — no eval/Function) ────

function evaluateCondition(condition: string | undefined, output: unknown, state: Record<string, unknown>): boolean {
  return evaluateSafeCondition(condition, output, state)
}

// ─── Output field extractor ───────────────────────────────────────────────────

function extractOutputField(output: unknown, field?: string): unknown {
  if (!field?.trim()) return output
  try {
    let val: any = output
    for (const part of field.split(".")) {
      const arr = part.match(/^(\w+)\[(\d+)\]$/)
      val = arr ? val?.[arr[1]!]?.[parseInt(arr[2]!)] : val?.[part]
      if (val === undefined) return output
    }
    return val ?? output
  } catch { return output }
}

// ─── Topological levels ───────────────────────────────────────────────────────

function topologicalLevels(nodes: DAGNode[], edges: DAGEdge[]): { levels: DAGNode[][]; cycle: boolean } {
  const inDegree = new Map<string, number>()
  const adj      = new Map<string, string[]>()
  const nodeMap  = new Map<string, DAGNode>()

  for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); nodeMap.set(n.id, n) }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id) }

  const levels: DAGNode[][] = []
  let processed = 0

  while (queue.length > 0) {
    const current = [...queue]; queue.length = 0
    const level: DAGNode[] = []
    for (const id of current) {
      const n = nodeMap.get(id); if (n) level.push(n)
      processed++
      for (const next of adj.get(id) ?? []) {
        const d = (inDegree.get(next) ?? 0) - 1
        inDegree.set(next, d)
        if (d === 0) queue.push(next)
      }
    }
    if (level.length > 0) levels.push(level)
  }
  return { levels, cycle: processed !== nodes.length }
}

// ─── Node executor with retry + fallback ─────────────────────────────────────

async function executeNodeWithRetry(
  node: DAGNode, edges: DAGEdge[], agentMap: Map<string, any>,
  nodeOutputs: Record<string, unknown>, pipelineInput: unknown,
  variables: Record<string, string>, pipelineState: Record<string, unknown>,
  userId: string, supabase: any
): Promise<NodeResult> {
  const maxRetries = Math.min(node.max_retries ?? 0, 3)
  const retryDelay = Math.min(node.retry_delay_ms ?? 500, 5000)
  const shouldRetry = (err: string) => {
    if (!node.retry_on_errors?.length) return true
    return node.retry_on_errors.some(p => err.toLowerCase().includes(p.toLowerCase()))
  }

  let lastError = ""
  let retryCount = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      retryCount = attempt
      await new Promise(r => setTimeout(r, retryDelay * Math.pow(2, attempt - 1)))
    }
    const result = await executeNode(node, edges, agentMap, nodeOutputs, pipelineInput, variables, pipelineState, userId, supabase)
    if (result.status === "success") return { ...result, retry_count: retryCount }
    lastError = result.error ?? "Unknown"
    if (!shouldRetry(lastError)) break
  }

  // Try fallback
  if (node.fallback_agent_id) {
    const fallback = agentMap.get(node.fallback_agent_id)
    if (fallback?.status === "active") {
      const fbResult = await executeNode(
        { ...node, agent_id: node.fallback_agent_id, max_retries: 0, fallback_agent_id: undefined },
        edges, agentMap, nodeOutputs, pipelineInput, variables, pipelineState, userId, supabase
      )
      if (fbResult.status === "success") return { ...fbResult, retry_count: retryCount, used_fallback: true }
    }
  }

  return {
    node_id: node.id, agent_id: node.agent_id,
    agent_name: agentMap.get(node.agent_id)?.name ?? node.label ?? node.id,
    status: "failed", input: null, output: null, latency_ms: 0, cost: 0,
    error: `Failed after ${retryCount + 1} attempt(s): ${lastError}`,
    retry_count: retryCount,
  }
}

// ─── Core node executor ───────────────────────────────────────────────────────

async function executeNode(
  node: DAGNode, edges: DAGEdge[], agentMap: Map<string, any>,
  nodeOutputs: Record<string, unknown>, pipelineInput: unknown,
  variables: Record<string, string>, pipelineState: Record<string, unknown>,
  userId: string, supabase: any
): Promise<Omit<NodeResult, "retry_count">> {
  const agent = agentMap.get(node.agent_id)
  if (!agent) return { node_id: node.id, agent_id: node.agent_id, agent_name: node.label ?? "Unknown",
    status: "failed", input: null, output: null, latency_ms: 0, cost: 0, error: "Agent not found" }

  const startMs = Date.now()
  try {
    const upEdges = edges.filter(e => e.to === node.id)
    let nodeInput: unknown

    if (upEdges.length === 0) {
      nodeInput = typeof pipelineInput === "string"
        ? pipelineInput.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? `{{${k}}}`)
        : pipelineInput
    } else {
      const ups = upEdges.map(e => nodeOutputs[e.from]).filter(v => v !== undefined && v !== null)
      nodeInput = node.input_mapping
        ? applyInputMapping(node.input_mapping, ups, variables)
        : (ups.length === 1 ? ups[0] : ups)
    }

    const withState = typeof nodeInput === "object" && nodeInput !== null
      ? { ...(nodeInput as object), __state: pipelineState }
      : { input: nodeInput, __state: pipelineState }

    const userMessage = typeof withState === "string" ? withState : JSON.stringify(withState)

    const { filterResult } = runInjectionPipeline(userMessage.slice(0, 2000), "user")
    if (!filterResult.allowed) throw new Error("Node input rejected by injection filter")

    let systemPrompt = (node.system_prompt_override ?? agent.system_prompt ?? "").trim()
    if (!systemPrompt) throw new Error("Agent has no system prompt configured")

    if (agent.knowledge_base_id) {
      const rag = await retrieveRAGContext(supabase, agent.knowledge_base_id, userMessage, { topK: 4, threshold: 0.65 })
      systemPrompt = buildRAGSystemPrompt(systemPrompt, rag)
    }

    const maxChars = Math.min(32_000, agent.security_config?.maxInputChars ?? 32_000)
    const { text: rawText, inputTokens, outputTokens, costUsd } = await routeCompletion({
      model:       agent.model_name || "claude-sonnet-4-20250514",
      system:      systemPrompt,
      userMessage: userMessage.slice(0, maxChars),
      maxTokens:   Math.min(agent.max_tokens || 4096, 8192),
      temperature: agent.temperature ?? 0.7,
    })

    const latencyMs = Date.now() - startMs
    const { text: safeText } = sanitizeOutput(rawText)
    let outputParsed: unknown = safeText
    try {
      const stripped = safeText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim()
      outputParsed = JSON.parse(stripped)
    } catch {}

    const outputJson = typeof outputParsed === "object" && outputParsed !== null
      ? outputParsed as Record<string, unknown>
      : { text: safeText }

    Promise.all([
      supabase.from("executions").insert({
        agent_id: node.agent_id, user_id: userId, status: "success",
        input:    typeof nodeInput === "object" ? nodeInput : { text: String(nodeInput) },
        output:   outputJson, tokens_input: inputTokens, tokens_output: outputTokens,
        latency_ms: latencyMs, cost_usd: costUsd, completed_at: new Date().toISOString(),
      }),
      supabase.rpc("increment_executions_used", { user_id_param: userId }),
    ]).catch(() => {})

    return {
      node_id: node.id, agent_id: node.agent_id, agent_name: agent.name ?? node.label ?? node.id,
      status: "success", input: nodeInput, output: outputParsed,
      latency_ms: latencyMs, cost: costUsd,
      tokens: { input: inputTokens, output: outputTokens },
    }
  } catch (err: any) {
    return {
      node_id: node.id, agent_id: node.agent_id,
      agent_name: agent.name ?? node.label ?? node.id,
      status: "failed", input: null, output: null,
      latency_ms: Date.now() - startMs, cost: 0,
      error: err.message ?? "Unknown error",
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function applyInputMapping(mapping: Record<string, string>, ups: unknown[], variables: Record<string, string>): unknown {
  const result: Record<string, unknown> = {}
  for (const [k, src] of Object.entries(mapping)) {
    if (src.startsWith("node.")) {
      const parts = src.split(".")
      let val: any = ups[parseInt(parts[1] ?? "0")]
      for (let i = 2; i < parts.length; i++) val = val?.[parts[i]!]
      result[k] = val
    } else if (src in variables) {
      result[k] = variables[src]
    } else {
      result[k] = src
    }
  }
  return result
}

async function failPipelineExec(
  supabase: any, execId: string, errorMsg: string,
  nodeResults: NodeResult[] = [], cost = 0, tokensIn = 0, tokensOut = 0, latency = 0
) {
  await supabase.from("pipeline_executions").update({
    status: "failed", error_message: errorMsg.slice(0, 500),
    node_results: nodeResults, total_cost: cost,
    total_tokens_in: tokensIn, total_tokens_out: tokensOut,
    total_latency_ms: latency, completed_at: new Date().toISOString(),
  }).eq("id", execId)
}
