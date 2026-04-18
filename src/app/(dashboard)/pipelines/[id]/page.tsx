// ✅ CANONICAL PIPELINE EDITOR — served at /pipelines/[id]
// Layout from (dashboard)/layout.tsx applies automatically (DashboardSidebar + main wrapper).
// This file replaces the redirect stub. export const runtime = 'edge' satisfies CF Pages.

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Plus, Trash2, Play, Save, Loader2, Search,
  AlertCircle, ChevronRight, Zap, Bot, ArrowRight,
  Settings2, Globe, Lock, Info, X,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatCurrency, formatNumber } from "@/lib/utils"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"
import { CategoryIcon } from "@/components/ui/category-icon"

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agent {
  id:             string
  name:           string
  description:    string
  category:       string
  model_name:     string
  pricing_model:  string
  price_per_call: number | null
  average_rating: number
  total_executions: number
  status:         string
}

interface DAGNode {
  id:                      string
  agent_id:                string
  label:                   string
  system_prompt_override?: string
  continue_on_failure?:    boolean
}

interface DAGEdge { from: string; to: string }

interface Pipeline {
  id:              string
  name:            string
  description:     string | null
  is_public:       boolean
  timeout_seconds: number
  dag:             { nodes: DAGNode[]; edges: DAGEdge[] }
  run_count?:      number
  status?:         string
}

// ── Agent Picker Modal ────────────────────────────────────────────────────────

function AgentPickerModal({
  onAdd, onClose, existingIds,
}: { onAdd: (a: Agent) => void; onClose: () => void; existingIds: string[] }) {
  const supabase = useRef(createClient()).current
  const [q, setQ]           = useState("")
  const [agents, setAgents]  = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const base = supabase.from("agents")
      .select("id, name, description, category, model_name, pricing_model, price_per_call, average_rating, total_executions, status")
      .eq("status", "active")
      .order("total_executions", { ascending: false })
      .limit(30)
    const query = q.trim() ? base.textSearch("name", q.trim(), { type: "websearch", config: "english" }) : base
    query.then(({ data }) => { if (!cancelled) { setAgents(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [q])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-bold text-zinc-900 text-sm">Add Agent to Pipeline</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-zinc-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search active agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {loading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-zinc-50 animate-pulse" />)
          ) : agents.length === 0 ? (
            <div className="text-center py-10 text-zinc-400 text-sm">
              No active agents found.
              <Link href="/builder" className="block text-primary hover:underline text-xs mt-1">Create one in Builder →</Link>
            </div>
          ) : agents.map(agent => {
            const already = existingIds.includes(agent.id)
            return (
              <button key={agent.id} type="button"
                disabled={already}
                onClick={() => { if (!already) { onAdd(agent); onClose() } }}
                className={cn("w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                  already ? "opacity-40 cursor-default border-zinc-100 bg-zinc-50" : "border-zinc-100 hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer bg-white")}>
                <div className="w-9 h-9 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center flex-shrink-0">
                  <CategoryIcon category={agent.category} colored className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                  <p className="text-xs text-zinc-400 truncate">
                    {agent.pricing_model === "free" ? "Free" : `${formatCurrency(agent.price_per_call ?? 0)}/call`} · {formatNumber(agent.total_executions)} runs
                  </p>
                </div>
                {already ? <span className="text-[10px] text-zinc-400 font-medium">Added</span> : <Plus className="h-4 w-4 text-zinc-300 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-zinc-50 bg-zinc-50 rounded-b-2xl">
          <p className="text-xs text-zinc-400">Only <strong>active</strong> (approved) agents appear here.</p>
        </div>
      </div>
    </div>
  )
}

// ── Node Card ─────────────────────────────────────────────────────────────────

function NodeCard({
  node, index, total, agentName,
  onRemove, onMoveUp, onMoveDown, onToggleContinue,
}: {
  node: DAGNode; index: number; total: number; agentName: string
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void; onToggleContinue: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden shadow-sm">
      {index > 0 && (
        <div className="flex justify-center py-1 bg-zinc-50/50">
          <ChevronRight className="h-4 w-4 text-zinc-300 rotate-90" />
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-primary/8 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">{index + 1}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 truncate">{node.label || agentName}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp}        disabled={index === 0}         className="p-1 text-zinc-300 hover:text-zinc-700 disabled:opacity-20 rounded-lg transition-colors">▲</button>
          <button onClick={onMoveDown}      disabled={index === total - 1} className="p-1 text-zinc-300 hover:text-zinc-700 disabled:opacity-20 rounded-lg transition-colors">▼</button>
          <button onClick={() => setExpanded(v => !v)}                     className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg transition-colors"><Settings2 className="h-3.5 w-3.5" /></button>
          <button onClick={onRemove}                                        className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-zinc-50 px-4 py-3 bg-zinc-50/50 space-y-2">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={onToggleContinue}
              className={cn("w-8 h-4 rounded-full relative flex-shrink-0 transition-colors", node.continue_on_failure ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", node.continue_on_failure ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-700">Continue on failure</p>
              <p className="text-[11px] text-zinc-400">Pass null to next step instead of aborting.</p>
            </div>
          </label>
        </div>
      )}
    </div>
  )
}

// ── Test Panel ────────────────────────────────────────────────────────────────

function TestPanel({ pipelineId, disabled }: { pipelineId: string; disabled: boolean }) {
  const [input,   setInput]   = useState('{"input": "Test this pipeline"}')
  const [output,  setOutput]  = useState("")
  const [running, setRunning] = useState(false)
  const [trace,   setTrace]   = useState<any>(null)

  const run = async () => {
    if (disabled) { toast.error("Add agents and save before running"); return }
    setRunning(true); setOutput(""); setTrace(null)
    try {
      let parsed: unknown; try { parsed = JSON.parse(input) } catch { parsed = input }
      const res  = await fetch(`/api/pipelines/${pipelineId}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: parsed }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      setTrace(data.summary)
      toast.success(`Done in ${data.summary?.total_latency_ms}ms`)
    } catch (err: any) { toast.error(err.message); setOutput(`Error: ${err.message}`) }
    finally { setRunning(false) }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Input</label>
        <Textarea value={input} onChange={e => setInput(e.target.value)} rows={5}
          className="rounded-xl border-zinc-200 bg-white font-mono text-xs resize-none" />
      </div>
      <Button onClick={run} disabled={running || disabled}
        className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
        {running ? <><Loader2 className="h-4 w-4 animate-spin" />Running…</> : <><Play className="h-4 w-4" />Run Pipeline</>}
      </Button>
      {output && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Output</label>
          <pre className="min-h-[80px] max-h-[200px] overflow-auto rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 whitespace-pre-wrap text-zinc-700">{output}</pre>
        </div>
      )}
      {trace && (
        <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2.5 space-y-1">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Summary</p>
          {[["Nodes run", trace.nodes_executed], ["Latency", `${trace.total_latency_ms}ms`], ["Cost", `$${trace.total_cost_usd}`]].map(([l, v]) => (
            <div key={l as string} className="flex justify-between text-xs">
              <span className="text-zinc-400">{l}</span>
              <span className="font-mono font-semibold text-zinc-700">{v}</span>
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">API</p>
          <code className="text-[10px] font-mono text-zinc-500 break-all">POST /api/pipelines/{pipelineId}/execute</code>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelineEditPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = useRef(createClient()).current

  const [pipeline,   setPipeline]  = useState<Pipeline | null>(null)
  const [nodes,      setNodes]     = useState<DAGNode[]>([])
  const [agentMap,   setAgentMap]  = useState<Record<string, Agent>>({})
  const [loading,    setLoading]   = useState(true)
  const [saving,     setSaving]    = useState(false)
  const [error,      setError]     = useState("")
  const [showPicker, setShowPicker] = useState(false)
  const [activeTab,  setActiveTab]  = useState<"builder" | "test">("builder")
  const [isDirty,    setIsDirty]    = useState(false)

  // Pipeline meta fields
  const [name,       setName]       = useState("")
  const [description,setDesc]       = useState("")
  const [isPublic,   setIsPublic]   = useState(false)
  const [timeout,    setTimeout_]   = useState(300)

  // Load pipeline
  useEffect(() => {
    if (!id) return
    const load = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const { data: p, error: err } = await supabase.from("pipelines").select("*").eq("id", id).single()
      if (err || !p) { setError("Pipeline not found or you don't have access."); setLoading(false); return }

      // Verify ownership
      if (p.owner_id !== user.id) { setError("You don't have permission to edit this pipeline."); setLoading(false); return }

      setPipeline(p as Pipeline)
      setName(p.name); setDesc(p.description ?? ""); setIsPublic(p.is_public); setTimeout_(p.timeout_seconds ?? 300)

      const dagNodes: DAGNode[] = p.dag?.nodes ?? []
      setNodes(dagNodes)

      const agentIds = [...new Set(dagNodes.map(n => n.agent_id).filter(Boolean))]
      if (agentIds.length > 0) {
        const { data: agents } = await supabase.from("agents")
          .select("id, name, description, category, model_name, pricing_model, price_per_call, average_rating, total_executions, status")
          .in("id", agentIds)
        const map: Record<string, Agent> = {}
        for (const a of agents ?? []) map[a.id] = a
        setAgentMap(map)
      }
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const buildEdges = (ns: DAGNode[]): DAGEdge[] =>
    ns.slice(0, -1).map((n, i) => ({ from: n.id, to: ns[i + 1]!.id }))

  const addAgent = (agent: Agent) => {
    const newNode: DAGNode = { id: `node_${Date.now()}`, agent_id: agent.id, label: agent.name, continue_on_failure: false }
    setNodes(prev => [...prev, newNode])
    setAgentMap(prev => ({ ...prev, [agent.id]: agent }))
    setIsDirty(true)
  }

  const removeNode     = (i: number)  => { setNodes(prev => prev.filter((_, idx) => idx !== i)); setIsDirty(true) }
  const moveNode       = (i: number, dir: -1 | 1) => {
    setNodes(prev => { const arr = [...prev]; const j = i + dir; if (j < 0 || j >= arr.length) return prev; [arr[i], arr[j]] = [arr[j]!, arr[i]!]; return arr })
    setIsDirty(true)
  }
  const toggleContinue = (i: number)  => { setNodes(prev => prev.map((n, idx) => idx === i ? { ...n, continue_on_failure: !n.continue_on_failure } : n)); setIsDirty(true) }

  const save = async () => {
    if (!pipeline) return
    if (nodes.length === 0) { toast.error("Add at least one agent before saving"); return }
    setSaving(true)
    try {
      const dag = { nodes, edges: buildEdges(nodes) }
      const { error: err } = await supabase.from("pipelines").update({
        name: name.trim() || pipeline.name,
        description: description.trim() || null,
        is_public: isPublic,
        timeout_seconds: timeout,
        dag,
        updated_at: new Date().toISOString(),
      }).eq("id", pipeline.id)
      if (err) throw err
      toast.success("Pipeline saved!")
      setIsDirty(false)
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-zinc-100 rounded-xl" />
        <div className="h-48 bg-zinc-50 border border-zinc-100 rounded-2xl" />
        <div className="h-32 bg-zinc-50 border border-zinc-100 rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
        <p className="text-zinc-700 font-medium mb-1">{error}</p>
        <Link href="/pipelines"><Button variant="outline" className="rounded-xl mt-4">← Back to Pipelines</Button></Link>
      </div>
    )
  }

  if (!pipeline) return null

  return (
    <>
      {showPicker && <AgentPickerModal onAdd={addAgent} onClose={() => setShowPicker(false)} existingIds={nodes.map(n => n.agent_id)} />}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/pipelines">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-zinc-900">{pipeline.name}</h1>
              <p className="text-xs text-zinc-400 mt-0.5">{nodes.length} {nodes.length === 1 ? "agent" : "agents"} · Pipeline editor</p>
            </div>
          </div>
          <Button onClick={save} disabled={saving || !isDirty} variant="outline" size="sm" className="rounded-xl border-zinc-200 gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : isDirty ? "Save changes" : "Saved"}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 w-fit">
          {(["builder", "test"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize",
                activeTab === t ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
              {t === "builder" ? "DAG Builder" : "Test Run"}
            </button>
          ))}
        </div>

        {activeTab === "builder" ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: settings + nodes */}
            <div className="lg:col-span-3 space-y-4">
              {/* Pipeline settings */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pipeline Settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Name</label>
                    <Input value={name} onChange={e => { setName(e.target.value); setIsDirty(true) }} className="h-9 rounded-xl border-zinc-200 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Timeout (s)</label>
                    <Input type="number" value={timeout} onChange={e => { setTimeout_(parseInt(e.target.value) || 300); setIsDirty(true) }} min={30} max={1800} className="h-9 rounded-xl border-zinc-200 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600">Description</label>
                  <Input value={description} onChange={e => { setDesc(e.target.value); setIsDirty(true) }} placeholder="What does this pipeline do?" className="h-9 rounded-xl border-zinc-200 text-sm" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={() => { setIsPublic(v => !v); setIsDirty(true) }}
                    className={cn("w-8 h-4 rounded-full relative flex-shrink-0 transition-colors", isPublic ? "bg-primary" : "bg-zinc-200")}>
                    <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
                  </div>
                  <span className="text-xs font-medium text-zinc-600 flex items-center gap-1">
                    {isPublic ? <Globe className="inline h-3 w-3 mr-0.5" /> : <Lock className="inline h-3 w-3 mr-0.5" />}
                    {isPublic ? "Public — discoverable by others" : "Private — only you can run this"}
                  </span>
                </label>
              </div>

              {/* Flow info */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 leading-relaxed">
                  <strong>Sequential flow:</strong> Output of agent 1 → input of agent 2, and so on.
                  Nodes in parallel branches run concurrently. Only <strong>active</strong> agents can be added.
                </p>
              </div>

              {/* Nodes */}
              <div className="space-y-0">
                {nodes.length === 0 ? (
                  <div className="text-center py-16 border-2 border-dashed border-zinc-100 rounded-2xl">
                    <Bot className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-zinc-500 mb-1">No agents yet</p>
                    <p className="text-xs text-zinc-400 mb-5">Add agents from the panel on the right.</p>
                    <Button onClick={() => setShowPicker(true)} className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2">
                      <Plus className="h-4 w-4" /> Add first agent
                    </Button>
                  </div>
                ) : (
                  nodes.map((node, i) => (
                    <NodeCard key={node.id} node={node} index={i} total={nodes.length}
                      agentName={agentMap[node.agent_id]?.name ?? node.label ?? "Unknown Agent"}
                      onRemove={() => removeNode(i)}
                      onMoveUp={() => moveNode(i, -1)}
                      onMoveDown={() => moveNode(i, 1)}
                      onToggleContinue={() => toggleContinue(i)}
                    />
                  ))
                )}
              </div>

              {nodes.length > 0 && (
                <button type="button" onClick={() => setShowPicker(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-zinc-200 rounded-xl text-zinc-400 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-all text-sm font-semibold">
                  <Plus className="h-4 w-4" /> Add next agent
                </button>
              )}
            </div>

            {/* Right: agent picker panel */}
            <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl overflow-hidden flex flex-col" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)", minHeight: "400px" }}>
              <div className="px-4 py-3.5 border-b border-zinc-100 bg-zinc-50">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Add Agent Step</p>
              </div>
              {/* Inline agent browser (no modal) */}
              <InlineAgentBrowser onAdd={addAgent} existingIds={nodes.map(n => n.agent_id)} />
            </div>
          </div>
        ) : (
          <div className="max-w-xl">
            <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p className="text-sm font-semibold text-zinc-900 mb-4">Test this pipeline</p>
              <TestPanel pipelineId={pipeline.id} disabled={nodes.length === 0} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Inline Agent Browser ──────────────────────────────────────────────────────

function InlineAgentBrowser({ onAdd, existingIds }: { onAdd: (a: Agent) => void; existingIds: string[] }) {
  const supabase = useRef(createClient()).current
  const [q, setQ]            = useState("")
  const [agents, setAgents]  = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const base = supabase.from("agents")
      .select("id, name, description, category, model_name, pricing_model, price_per_call, average_rating, total_executions, status")
      .eq("status", "active")
      .order("total_executions", { ascending: false })
      .limit(20)
    const query = q.trim() ? base.textSearch("name", q.trim(), { type: "websearch", config: "english" }) : base
    query.then(({ data }) => { if (!cancelled) { setAgents(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [q])

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search active agents…" className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {loading ? (
          [...Array(5)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-zinc-50 animate-pulse" />)
        ) : agents.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            No active agents found.<br />
            <Link href="/builder" className="text-primary hover:underline text-xs mt-1 block">Create and approve one first →</Link>
          </div>
        ) : agents.map(agent => {
          const already = existingIds.includes(agent.id)
          return (
            <div key={agent.id}
              className={cn("flex items-center gap-3 p-3 rounded-xl border transition-all", already ? "opacity-40 cursor-default border-zinc-100 bg-zinc-50" : "border-zinc-100 bg-white hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer")}
              onClick={() => !already && onAdd(agent)}>
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                <p className="text-xs text-zinc-400 truncate">{agent.description?.slice(0, 50)}</p>
              </div>
              {already
                ? <span className="text-[10px] text-zinc-400 font-medium flex-shrink-0">Added</span>
                : <Plus className="h-4 w-4 text-zinc-300 flex-shrink-0" />}
            </div>
          )
        })}
      </div>
      {agents.length === 20 && (
        <div className="px-3 py-2 border-t border-zinc-100 bg-zinc-50">
          <p className="text-[11px] text-zinc-400 text-center">Search to find more agents</p>
        </div>
      )}
    </div>
  )
}
