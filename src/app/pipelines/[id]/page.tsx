export const runtime = 'edge'

"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CategoryIcon } from "@/components/ui/category-icon"
import { categoryLabel, formatNumber, cn } from "@/lib/utils"
import {
  ArrowLeft, Plus, Trash2, ChevronRight, Save, Play,
  Loader2, Search, X, Layers, Bot, Zap, Star,
  Globe, Lock, AlertCircle,
} from "lucide-react"
import Link from "next/link"
import toast from "react-hot-toast"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DagNode { id: string; agent_id: string; label: string }
interface DagEdge { from: string; to: string }
interface Dag { nodes: DagNode[]; edges: DagEdge[] }
interface Pipeline {
  id: string; name: string; description: string | null
  dag: Dag; is_public: boolean; timeout_seconds: number
  tags: string[]; run_count: number; status: string
}
interface Agent {
  id: string; name: string; description: string
  category: string; pricing_model: string; price_per_call: number
  average_rating: number; total_executions: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent search picker modal
// ─────────────────────────────────────────────────────────────────────────────

function AgentPicker({
  onSelect, onClose,
}: { onSelect: (agent: Agent) => void; onClose: () => void }) {
  const supabase = createClient()
  const [q,          setQ]       = useState("")
  const [agents,     setAgents]  = useState<Agent[]>([])
  const [loading,    setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const query = supabase
      .from("agents")
      .select("id, name, description, category, pricing_model, price_per_call, average_rating, total_executions")
      .eq("status", "active")
      .order("total_executions", { ascending: false })
      .limit(40)

    const fetcher = q
      ? query.textSearch("name", q, { type: "websearch", config: "english" })
      : query

    fetcher.then(({ data }) => {
      if (!cancelled) { setAgents(data || []); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [q])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-bold text-zinc-900 text-sm">Add Agent to Pipeline</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-zinc-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input
              autoFocus
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search active agents…"
              className="pl-9 h-9 rounded-xl border-zinc-200 text-sm"
            />
          </div>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))
          ) : agents.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm">
              No active agents found. Create and get an agent approved first.
            </div>
          ) : (
            agents.map(agent => (
              <button key={agent.id} type="button"
                onClick={() => { onSelect(agent); onClose() }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-zinc-50 border border-transparent hover:border-zinc-100 transition-all text-left">
                <div className="w-9 h-9 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                  <CategoryIcon category={agent.category} colored className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                  <p className="text-xs text-zinc-400 truncate">
                    {categoryLabel(agent.category)} · {agent.pricing_model === "free" ? "Free" : `$${agent.price_per_call}/call`}
                  </p>
                </div>
                <div className="text-xs text-zinc-400 flex items-center gap-1 flex-shrink-0">
                  <Zap className="h-3 w-3" /> {formatNumber(agent.total_executions || 0)}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-zinc-50 bg-zinc-50 rounded-b-2xl">
          <p className="text-xs text-zinc-400">
            Only <strong>active</strong> agents appear here. Submit a draft agent for review to make it available.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DAG node card
// ─────────────────────────────────────────────────────────────────────────────

function NodeCard({
  node, index, total, agentInfo, onRemove, onMoveUp, onMoveDown, onLabelChange,
}: {
  node: DagNode; index: number; total: number; agentInfo?: Agent
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void
  onLabelChange: (label: string) => void
}) {
  return (
    <div className="relative">
      {/* Connector line above (except first) */}
      {index > 0 && (
        <div className="flex items-center justify-center my-1">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-px h-4 bg-zinc-200" />
            <ChevronRight className="h-3 w-3 text-zinc-300 rotate-90" />
          </div>
        </div>
      )}

      <div className="bg-white border border-zinc-100 rounded-2xl p-4 hover:border-zinc-200 transition-all"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-start gap-3">
          {/* Step number */}
          <div className="w-6 h-6 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
            {index + 1}
          </div>

          {/* Agent icon */}
          <div className="w-9 h-9 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
            {agentInfo
              ? <CategoryIcon category={agentInfo.category} colored className="h-4 w-4" />
              : <Bot className="h-4 w-4 text-zinc-400" />}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-900 truncate">
              {agentInfo?.name || node.agent_id}
            </p>
            <p className="text-xs text-zinc-400 truncate">
              {agentInfo ? categoryLabel(agentInfo.category) : "Unknown agent"}
            </p>
            {/* Editable label */}
            <Input
              value={node.label}
              onChange={e => onLabelChange(e.target.value)}
              placeholder="Step label (optional)"
              className="mt-2 h-7 text-xs rounded-lg border-zinc-200"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1 flex-shrink-0">
            <button onClick={onMoveUp} disabled={index === 0}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-30 transition-all"
              title="Move up">
              <ChevronRight className="h-3.5 w-3.5 -rotate-90" />
            </button>
            <button onClick={onMoveDown} disabled={index === total - 1}
              className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-30 transition-all"
              title="Move down">
              <ChevronRight className="h-3.5 w-3.5 rotate-90" />
            </button>
            <button onClick={onRemove}
              className="p-1 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-all"
              title="Remove agent">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PipelineEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()
  const { user, loading: authLoading } = useUser()

  const [pipeline,    setPipeline]    = useState<Pipeline | null>(null)
  const [agentCache,  setAgentCache]  = useState<Record<string, Agent>>({})
  const [notFound,    setNotFound]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [running,     setRunning]     = useState(false)
  const [showPicker,  setShowPicker]  = useState(false)
  const [testInput,   setTestInput]   = useState('{"input": "Hello"}')
  const [testOutput,  setTestOutput]  = useState("")
  const [isDirty,     setIsDirty]     = useState(false)

  // Load pipeline
  useEffect(() => {
    if (authLoading) return
    if (!user) { router.push(`/login?next=/pipelines/${id}`); return }
    if (!id) return

    supabase.from("pipelines").select("*").eq("id", id).eq("owner_id", user.id).single()
      .then(({ data, error }) => {
        if (error || !data) { setNotFound(true); return }
        setPipeline(data as Pipeline)

        // Pre-fetch agent info for existing nodes
        const agentIds = (data.dag?.nodes || []).map((n: DagNode) => n.agent_id).filter(Boolean)
        if (agentIds.length > 0) {
          supabase.from("agents")
            .select("id, name, description, category, pricing_model, price_per_call, average_rating, total_executions")
            .in("id", agentIds)
            .then(({ data: agents }) => {
              const cache: Record<string, Agent> = {}
              for (const a of agents || []) cache[a.id] = a
              setAgentCache(cache)
            })
        }
      })
  }, [id, user, authLoading])

  const dag = pipeline?.dag ?? { nodes: [], edges: [] }

  // Rebuild edges as sequential chain whenever nodes change
  const buildEdges = (nodes: DagNode[]): DagEdge[] =>
    nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id }))

  const updateNodes = (newNodes: DagNode[]) => {
    if (!pipeline) return
    const newDag: Dag = { nodes: newNodes, edges: buildEdges(newNodes) }
    setPipeline({ ...pipeline, dag: newDag })
    setIsDirty(true)
  }

  const addAgent = (agent: Agent) => {
    const newNode: DagNode = {
      id:       `node_${Date.now()}`,
      agent_id: agent.id,
      label:    agent.name,
    }
    setAgentCache(c => ({ ...c, [agent.id]: agent }))
    updateNodes([...dag.nodes, newNode])
    toast.success(`Added: ${agent.name}`)
  }

  const removeNode = (idx: number) => {
    updateNodes(dag.nodes.filter((_, i) => i !== idx))
  }

  const moveNode = (idx: number, dir: -1 | 1) => {
    const nodes = [...dag.nodes]
    const tmp = nodes[idx]
    nodes[idx] = nodes[idx + dir]
    nodes[idx + dir] = tmp
    updateNodes(nodes)
  }

  const updateLabel = (idx: number, label: string) => {
    const nodes = [...dag.nodes]
    nodes[idx] = { ...nodes[idx], label }
    updateNodes(nodes)
  }

  const save = async () => {
    if (!pipeline) return
    setSaving(true)
    try {
      const { error } = await supabase.from("pipelines")
        .update({ dag: pipeline.dag, updated_at: new Date().toISOString() })
        .eq("id", pipeline.id)
      if (error) throw error
      setIsDirty(false)
      toast.success("Pipeline saved!")
    } catch (e: any) {
      toast.error(e.message)
    } finally { setSaving(false) }
  }

  const runPipeline = async () => {
    if (!pipeline || dag.nodes.length === 0) {
      toast.error("Add at least one agent before running")
      return
    }
    setRunning(true)
    setTestOutput("")
    try {
      let parsedInput: unknown
      try { parsedInput = JSON.parse(testInput) } catch { parsedInput = testInput }

      const res = await fetch(`/api/pipelines/${pipeline.id}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ input: parsedInput }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setTestOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (e: any) {
      toast.error(e.message)
      setTestOutput(`Error: ${e.message}`)
    } finally { setRunning(false) }
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (authLoading || (!pipeline && !notFound)) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 p-8 space-y-4">
          <Skeleton className="h-8 w-64 rounded-xl" />
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Layers className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-lg font-semibold text-zinc-900">Pipeline not found</p>
            <p className="text-sm text-zinc-400 mt-1">It may have been deleted or you don't have access.</p>
            <Button onClick={() => router.push("/pipelines")}
              className="mt-5 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700">
              Back to Pipelines
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {showPicker && (
        <AgentPicker
          onSelect={addAgent}
          onClose={() => setShowPicker(false)}
        />
      )}

      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />

        <div className="flex flex-1 overflow-hidden">
          {/* ── Main pipeline canvas ────────────────────────────────────── */}
          <div className="flex-1 overflow-auto">
            <div className="max-w-2xl mx-auto px-6 py-8">

              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Link href="/pipelines">
                    <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                  </Link>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-xl font-bold tracking-tight text-zinc-900">{pipeline!.name}</h1>
                      {pipeline!.is_public
                        ? <Globe className="h-4 w-4 text-zinc-400" />
                        : <Lock  className="h-4 w-4 text-zinc-400" />}
                    </div>
                    {pipeline!.description && (
                      <p className="text-xs text-zinc-400 mt-0.5">{pipeline!.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isDirty && (
                    <Button onClick={save} disabled={saving} variant="outline" size="sm"
                      className="gap-1.5 rounded-xl border-zinc-200">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  )}
                </div>
              </div>

              {/* How it works callout */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 flex items-start gap-3 mb-6">
                <AlertCircle className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-700 leading-relaxed">
                  <strong>How pipelines work:</strong> Each agent runs in sequence. The <strong>output</strong> of
                  agent N is automatically passed as the <strong>input</strong> to agent N+1.
                  Only <strong>active</strong> (approved) agents can be added.
                  Click Run to test the full chain.
                </div>
              </div>

              {/* Agent nodes */}
              <div className="space-y-0 mb-5">
                {dag.nodes.length === 0 ? (
                  <div className="text-center py-16 border-2 border-dashed border-zinc-100 rounded-2xl">
                    <Layers className="h-8 w-8 text-zinc-200 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-zinc-500 mb-1">No agents yet</p>
                    <p className="text-xs text-zinc-400 mb-5">
                      Add agents below to build your pipeline.
                      Output of each agent flows into the next.
                    </p>
                    <Button type="button" onClick={() => setShowPicker(true)}
                      className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
                      <Plus className="h-4 w-4" /> Add First Agent
                    </Button>
                  </div>
                ) : (
                  dag.nodes.map((node, i) => (
                    <NodeCard
                      key={node.id}
                      node={node}
                      index={i}
                      total={dag.nodes.length}
                      agentInfo={agentCache[node.agent_id]}
                      onRemove={() => removeNode(i)}
                      onMoveUp={() => moveNode(i, -1)}
                      onMoveDown={() => moveNode(i, 1)}
                      onLabelChange={label => updateLabel(i, label)}
                    />
                  ))
                )}
              </div>

              {/* Add agent button */}
              {dag.nodes.length > 0 && (
                <button type="button" onClick={() => setShowPicker(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-zinc-200 rounded-2xl text-zinc-400 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-all text-sm font-semibold mb-6">
                  <Plus className="h-4 w-4" /> Add next agent
                </button>
              )}

              {/* Pipeline summary */}
              {dag.nodes.length > 0 && (
                <div className="bg-zinc-50 border border-zinc-100 rounded-2xl p-4 text-xs text-zinc-500 space-y-1.5">
                  <p className="font-semibold text-zinc-700">Pipeline summary</p>
                  <p>{dag.nodes.length} agent{dag.nodes.length !== 1 ? "s" : ""} · {dag.edges.length} connections</p>
                  <p className="font-mono text-zinc-400">
                    {dag.nodes.map((n, i) => agentCache[n.agent_id]?.name || `Agent ${i+1}`).join(" → ")}
                  </p>
                  <p>Timeout: {pipeline!.timeout_seconds}s total</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Pinned test panel ────────────────────────────────────────── */}
          <div className="w-80 flex-shrink-0 border-l border-zinc-100 bg-zinc-50 flex flex-col sticky top-0 h-screen overflow-hidden">
            <div className="px-4 py-3.5 border-b border-zinc-100 bg-white">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-primary/8 flex items-center justify-center">
                  <Play className="h-3 w-3 text-primary" />
                </div>
                <p className="text-sm font-semibold text-zinc-900">Test Pipeline</p>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3">
              {dag.nodes.length === 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-xs text-amber-700">
                  Add at least one agent to test the pipeline.
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Input JSON</label>
                <textarea
                  value={testInput}
                  onChange={e => setTestInput(e.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 resize-none focus:outline-none focus:border-primary/40"
                />
              </div>

              <Button type="button" onClick={runPipeline} disabled={running || dag.nodes.length === 0}
                className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                {running
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                  : <><Play className="h-4 w-4" /> Run Pipeline</>}
              </Button>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Output</label>
                <div className={cn(
                  "min-h-[120px] max-h-[240px] overflow-auto rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 whitespace-pre-wrap text-zinc-600",
                  running && "animate-pulse bg-zinc-50"
                )}>
                  {running ? "Running…" : testOutput || <span className="text-zinc-300">Output will appear here…</span>}
                </div>
              </div>

              {/* API usage */}
              {dag.nodes.length > 0 && (
                <div className="rounded-xl border border-zinc-100 bg-white p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Execute via API</p>
                  <pre className="text-[10px] font-mono text-zinc-500 overflow-x-auto whitespace-pre">{`POST /api/pipelines/${id}/execute
Authorization: Bearer YOUR_API_KEY
{ "input": "your input" }`}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
