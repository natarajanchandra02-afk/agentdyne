export const runtime = "edge"

/**
 * GET  /api/pipelines/[id]/optimize — analyse, return suggestions + estimated savings
 * POST /api/pipelines/[id]/optimize — apply: action="parallelize" | "apply_all"
 *
 * Powers Workflow Evolution: "Current: 7 Steps → Recommended: 5 / -32% Cost / -41% Latency"
 * Data source: pipeline_step_checkpoints (already populated by execute route).
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Topological level detector — finds nodes that can run in parallel
function detectParallelGroups(
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>
): string[][] {
  const inDeg = new Map<string, number>()
  const adj   = new Map<string, string[]>()
  for (const n of nodes) { inDeg.set(n.id, 0); adj.set(n.id, []) }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to)
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
  }
  const queue  = [...inDeg.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const groups: string[][] = []
  while (queue.length) {
    const level = [...queue]; queue.length = 0
    if (level.length > 1) groups.push(level)
    for (const id of level)
      for (const nxt of (adj.get(id) ?? [])) {
        const d = (inDeg.get(nxt) ?? 0) - 1; inDeg.set(nxt, d)
        if (d === 0) queue.push(nxt)
      }
  }
  return groups
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: pipeline } = await supabase
    .from("pipelines").select("id, name, dag, owner_id, version").eq("id", id).single()
  if (!pipeline)                     return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (pipeline.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const dag = pipeline.dag as {
    nodes: Array<{ id: string; agent_id: string; label?: string; node_type?: string }>
    edges: Array<{ from: string; to: string }>
  }

  if (!dag?.nodes?.length) return NextResponse.json({ error: "Pipeline has no nodes" }, { status: 422 })

  const { data: checkpoints } = await supabase
    .from("pipeline_step_checkpoints")
    .select("node_id, agent_id, status, latency_ms, cost_usd, retry_count")
    .eq("pipeline_id", id).in("status", ["success","failed","skipped"])
    .order("started_at", { ascending: false }).limit(500)

  const agentIds = [...new Set(dag.nodes.map(n => n.agent_id).filter(Boolean))]
  const { data: agents } = await supabase.from("agents").select("id, name, model_name").in("id", agentIds)
  const agentMap = new Map((agents ?? []).map((a: any) => [a.id, { name: a.name, model: a.model_name }]))

  type Stat = { latencies: number[]; costs: number[]; successes: number; total: number }
  const stats = new Map<string, Stat>()
  for (const cp of checkpoints ?? []) {
    if (!stats.has(cp.node_id)) stats.set(cp.node_id, { latencies: [], costs: [], successes: 0, total: 0 })
    const s = stats.get(cp.node_id)!
    s.total++
    if (cp.latency_ms > 0) s.latencies.push(Number(cp.latency_ms))
    if (cp.cost_usd >= 0)  s.costs.push(parseFloat(String(cp.cost_usd)))
    if (cp.status === "success") s.successes++
  }

  const nodeAnalyses = dag.nodes.map(node => {
    const s    = stats.get(node.id)
    const info = agentMap.get(node.agent_id) as { name: string; model: string } | undefined
    const name = info?.name ?? node.label ?? node.id
    if (!s || s.total < 2)
      return { node_id: node.id, agent_name: name, run_count: s?.total ?? 0,
               avg_latency_ms: 0, p95_latency_ms: 0, avg_cost_usd: 0,
               success_rate: 1, is_bottleneck: false, is_expensive: false, is_unreliable: false, suggestion: null }
    const sorted  = [...s.latencies].sort((a, b) => a - b)
    const avgLat  = sorted.reduce((a, v) => a + v, 0) / sorted.length
    const p95     = sorted[Math.floor(sorted.length * 0.95)] ?? sorted.at(-1) ?? 0
    const avgCost = s.costs.length ? s.costs.reduce((a, v) => a + v, 0) / s.costs.length : 0
    const sr      = s.successes / s.total
    const isB     = avgLat  > 8000
    const isE     = avgCost > 0.04
    const isU     = sr      < 0.80
    let suggestion: string | null = null
    if (isB) suggestion = `Avg ${Math.round(avgLat/1000)}s — try a faster model or split into smaller steps`
    if (isE) suggestion = `$${avgCost.toFixed(4)}/run — consider Haiku for simpler subtasks`
    if (isU) suggestion = `${Math.round(sr*100)}% success rate — review prompt or add a fallback agent`
    return { node_id: node.id, agent_name: name, run_count: s.total,
             avg_latency_ms: Math.round(avgLat), p95_latency_ms: Math.round(p95),
             avg_cost_usd: avgCost, success_rate: sr,
             is_bottleneck: isB, is_expensive: isE, is_unreliable: isU, suggestion }
  })

  const parallelGroups = detectParallelGroups(dag.nodes, dag.edges)
  const suggestions: Array<{ type: string; node_ids: string[]; description: string; impact: { latency_pct: number; cost_pct: number }; auto_apply: boolean }> = []

  for (const group of parallelGroups) {
    const lats = group.map(gid => nodeAnalyses.find(n => n.node_id === gid)?.avg_latency_ms ?? 0)
    const sum  = lats.reduce((a, v) => a + v, 0)
    const save = sum > 0 ? Math.round(((sum - Math.max(...lats)) / sum) * 100) : 0
    if (save > 15)
      suggestions.push({ type: "parallelize", node_ids: group, auto_apply: true,
        description: `${group.length} nodes can run in parallel — est. ${save}% latency reduction`,
        impact: { latency_pct: save, cost_pct: 0 } })
  }

  const bottlenecks = nodeAnalyses.filter(n => n.is_bottleneck)
  const expensive   = nodeAnalyses.filter(n => n.is_expensive)
  const unreliable  = nodeAnalyses.filter(n => n.is_unreliable)

  if (bottlenecks.length)
    suggestions.push({ type: "replace_model", node_ids: bottlenecks.map(n => n.node_id), auto_apply: false,
      description: `${bottlenecks.length} slow node(s) — swap to faster models or add response caching`,
      impact: { latency_pct: 35, cost_pct: 0 } })
  if (expensive.length)
    suggestions.push({ type: "replace_model", node_ids: expensive.map(n => n.node_id), auto_apply: false,
      description: `${expensive.length} expensive node(s) — auto-routing to Haiku saves 40–80%`,
      impact: { latency_pct: -5, cost_pct: 55 } })
  if (unreliable.length)
    suggestions.push({ type: "add_fallback", node_ids: unreliable.map(n => n.node_id), auto_apply: false,
      description: `${unreliable.length} unreliable node(s) — add fallback agents`,
      impact: { latency_pct: 10, cost_pct: -5 } })

  const totalLat  = suggestions.filter(s => s.impact.latency_pct > 0).reduce((a, s) => a + s.impact.latency_pct, 0)
  const totalCost = suggestions.filter(s => s.impact.cost_pct   > 0).reduce((a, s) => a + s.impact.cost_pct,   0)

  return NextResponse.json({
    pipeline_id:                       id,
    current_steps:                     dag.nodes.length,
    data_points:                       checkpoints?.length ?? 0,
    estimated_latency_reduction_pct:   Math.min(Math.round(totalLat),  70),
    estimated_cost_reduction_pct:      Math.min(Math.round(totalCost), 80),
    recommendation: suggestions.length > 0
      ? { headline: `Recommended: ${dag.nodes.length} Steps → ${dag.nodes.length - (suggestions.filter(s => s.type === "remove_unused").length)} / -${Math.min(Math.round(totalCost), 80)}% Cost / -${Math.min(Math.round(totalLat), 70)}% Latency` }
      : { headline: "Pipeline is well optimised" },
    parallel_groups: parallelGroups,
    node_analyses:   nodeAnalyses,
    suggestions,
    has_enough_data: (checkpoints?.length ?? 0) >= 10,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid pipeline id" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { action?: string } = {}
  try { body = await req.json() } catch {}

  const { data: pipeline } = await supabase
    .from("pipelines").select("*").eq("id", id).single()
  if (!pipeline)                     return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (pipeline.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const dag = pipeline.dag as { nodes: Array<{ id: string; agent_id: string; node_type?: string }>; edges: Array<{ from: string; to: string }> }

  if (body.action === "parallelize" || body.action === "apply_all") {
    const groups      = detectParallelGroups(dag.nodes, dag.edges)
    const parallelSet = new Set(groups.flat())
    const newDag      = { ...dag, nodes: dag.nodes.map(n => ({ ...n, node_type: parallelSet.has(n.id) ? "parallel" : (n.node_type ?? "linear") })) }
    const newVer      = ((parseFloat(pipeline.version ?? "1.0")) + 0.1).toFixed(1)

    await supabase.from("pipeline_versions").insert({
      pipeline_id: id, version: pipeline.version ?? "1.0",
      dag_snapshot: pipeline.dag, node_count: dag.nodes.length,
      snapshot_at: new Date().toISOString(), created_by: user.id,
      change_reason: `Pre-optimization snapshot (auto-parallelize v${newVer})`,
    }).catch(() => {})

    await supabase.from("pipelines").update({ dag: newDag, version: newVer, updated_at: new Date().toISOString() }).eq("id", id)

    return NextResponse.json({ ok: true, new_version: newVer, parallelized: parallelSet.size,
      message: `${parallelSet.size} nodes marked parallel. Version bumped to ${newVer}.` })
  }

  return NextResponse.json({ error: "Unknown action. Use: parallelize | apply_all" }, { status: 400 })
}
