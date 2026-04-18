export const runtime = 'edge'
"use client"

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline editor — canonical route served here (outside route group).
// This file owns the /pipelines/[id] URL and wraps the DashboardSidebar
// itself (no group layout available).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Plus, Trash2, Play, Save, Loader2,
  Search, AlertCircle, ChevronRight, Zap,
  Bot, ArrowRight, Settings2, Globe, Lock,
  Info,
} from "lucide-react"
import { Button }    from "@/components/ui/button"
import { Input }     from "@/components/ui/input"
import { Textarea }  from "@/components/ui/textarea"
import { cn, formatCurrency } from "@/lib/utils"
import { DashboardSidebar } from "@/components/dashboard/sidebar"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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
  icon_url:       string | null
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

// ─────────────────────────────────────────────────────────────────────────────
// Agent picker
// ─────────────────────────────────────────────────────────────────────────────

function AgentPicker({
  onAdd, existingAgentIds,
}: { onAdd: (a: Agent) => void; existingAgentIds: string[] }) {
  const [q,       setQ]       = useState("")
  const [agents,  setAgents]  = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (query: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: "active", limit: "20", sort: "popular" })
      if (query.trim()) params.set("q", query.trim())
      const res  = await fetch(`/api/agents?${params}`)
      const data = await res.json()
      setAgents(data.agents ?? [])
    } catch { setAgents([]) }
    finally  { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(q), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, search])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Add Agent Step</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search active agents…"
            className="pl-9 h-9 rounded-xl border-zinc-200 text-sm" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {loading ? (
          <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-300 mx-auto" /></div>
        ) : agents.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            No active agents found.<br />
            <Link href="/builder" className="text-primary hover:underline text-xs mt-1 block">Create one →</Link>
          </div>
        ) : agents.map(agent => {
          const added = existingAgentIds.includes(agent.id)
          return (
            <div key={agent.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all group",
                added ? "border-zinc-100 bg-zinc-50 opacity-50" : "border-zinc-100 bg-white hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer"
              )}
              onClick={() => !added && onAdd(agent)}>
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                <p className="text-xs text-zinc-400 truncate">{agent.description?.slice(0, 55)}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-zinc-400 capitalize">{agent.model_name?.split("-")[0]}</span>
                  {agent.pricing_model !== "free" && agent.price_per_call != null && (
                    <span className="text-[10px] text-zinc-400">{formatCurrency(agent.price_per_call)}/call</span>
                  )}
                </div>
              </div>
              {added
                ? <span className="text-[10px] text-zinc-400 font-medium flex-shrink-0">Added</span>
                : <Plus className="h-4 w-4 text-zinc-300 group-hover:text-primary transition-colors flex-shrink-0" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Node card
// ─────────────────────────────────────────────────────────────────────────────

function NodeCard({
  node, index, total, agentName, agentModel,
  onRemove, onMoveUp, onMoveDown, onToggleContinue,
}: {
  node: DAGNode; index: number; total: number
  agentName: string; agentModel: string
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void; onToggleContinue: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-white border border-zinc-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-lg bg-primary/8 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-900 truncate">{node.label || agentName}</p>
          <p className="text-xs text-zinc-400">{agentModel?.split("-")[0] ?? "claude"} model</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp}    disabled={index === 0}          className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20 transition-colors">▲</button>
          <button onClick={onMoveDown}  disabled={index === total - 1}  className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20 transition-colors">▼</button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"><Settings2 className="h-3.5 w-3.5" /></button>
          <button onClick={onRemove}    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-zinc-50 px-4 py-3 space-y-3 bg-zinc-50/50">
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={onToggleContinue}
              className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", node.continue_on_failure ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", node.continue_on_failure ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-700">Continue on failure</p>
              <p className="text-[11px] text-zinc-400">Pass null to the next step instead of aborting.</p>
            </div>
          </label>
        </div>
      )}
      {index < total - 1 && (
        <div className="flex justify-center py-1 bg-zinc-50">
          <ChevronRight className="h-4 w-4 text-zinc-300 rotate-90" />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Test panel
// ─────────────────────────────────────────────────────────────────────────────

function TestPanel({ pipelineId }: { pipelineId: string }) {
  const [input,   setInput]   = useState('{"input": "Hello, run this pipeline."}')
  const [output,  setOutput]  = useState("")
  const [running, setRunning] = useState(false)
  const [trace,   setTrace]   = useState<any>(null)

  const run = async () => {
    setRunning(true); setOutput(""); setTrace(null)
    try {
      let parsed: unknown; try { parsed = JSON.parse(input) } catch { parsed = input }
      const res  = await fetch(`/api/pipelines/${pipelineId}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: parsed }),
      })
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
      <Button onClick={run} disabled={running}
        className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
        {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run Pipeline</>}
      </Button>
      {output && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Output</label>
          <div className="min-h-[80px] max-h-[200px] overflow-auto rounded-xl border border-zinc-200 bg-white font-mono text-xs p-3 whitespace-pre-wrap text-zinc-700">{output}</div>
        </div>
      )}
      {trace && (
        <div className="rounded-xl border border-zinc-100 bg-white px-3 py-2.5 space-y-1">
          <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">Summary</p>
          {[
            { label: "Nodes run",  value: trace.nodes_executed },
            { label: "Latency",    value: `${trace.total_latency_ms}ms` },
            { label: "Total cost", value: `$${trace.total_cost_usd}` },
          ].map(r => (
            <div key={r.label} className="flex justify-between text-xs">
              <span className="text-zinc-400">{r.label}</span>
              <span className="font-mono font-semibold text-zinc-700">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PipelineEditPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()

  const [pipeline,    setPipeline]  = useState<Pipeline | null>(null)
  const [nodes,       setNodes]     = useState<DAGNode[]>([])
  const [agentMap,    setAgentMap]  = useState<Record<string, Agent>>({})
  const [loading,     setLoading]   = useState(true)
  const [saving,      setSaving]    = useState(false)
  const [error,       setError]     = useState("")
  const [activeTab,   setActiveTab] = useState<"builder" | "test">("builder")

  const [name,        setName]       = useState("")
  const [description, setDesc]       = useState("")
  const [isPublic,    setIsPublic]   = useState(false)
  const [timeout,     setTimeout_]   = useState(300)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }

      const res = await fetch(`/api/pipelines/${id}`)
      if (!res.ok) { setError("Pipeline not found"); setLoading(false); return }
      const p: Pipeline = await res.json()
      setPipeline(p); setName(p.name); setDesc(p.description ?? "")
      setIsPublic(p.is_public); setTimeout_(p.timeout_seconds ?? 300)

      const dagNodes: DAGNode[] = p.dag?.nodes ?? []
      setNodes(dagNodes)

      const agentIds = [...new Set(dagNodes.map(n => n.agent_id).filter(Boolean))]
      if (agentIds.length > 0) {
        const { data: agents } = await supabase.from("agents")
          .select("id,name,description,category,model_name,pricing_model,price_per_call,average_rating,total_executions,icon_url,status")
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

  const addAgent = (agent: Agent) => {
    const newNode: DAGNode = { id: `node_${Date.now()}`, agent_id: agent.id, label: agent.name, continue_on_failure: false }
    setNodes(prev => [...prev, newNode])
    setAgentMap(prev => ({ ...prev, [agent.id]: agent }))
  }

  const removeNode    = (i: number) => setNodes(prev => prev.filter((_, idx) => idx !== i))
  const moveNode      = (i: number, dir: -1 | 1) => setNodes(prev => { const arr = [...prev]; const j = i + dir; if (j < 0 || j >= arr.length) return prev; [arr[i], arr[j]] = [arr[j]!, arr[i]!]; return arr })
  const toggleCont    = (i: number) => setNodes(prev => prev.map((n, idx) => idx === i ? { ...n, continue_on_failure: !n.continue_on_failure } : n))
  const buildEdges    = (ns: DAGNode[]): DAGEdge[] => ns.slice(0, -1).map((n, i) => ({ from: n.id, to: ns[i + 1]!.id }))

  const save = async () => {
    if (!pipeline) return
    if (nodes.length === 0) { toast.error("Add at least one agent"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || pipeline.name, description: description.trim() || null, is_public: isPublic, timeout_seconds: timeout, dag: { nodes, edges: buildEdges(nodes) } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      toast.success("Pipeline saved!")
      setPipeline(data)
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  // ── Loading / error ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 p-8 space-y-4 animate-pulse">
          <div className="h-8 w-48 bg-zinc-100 rounded-xl" />
          <div className="h-64 bg-zinc-50 border border-zinc-100 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error || !pipeline) {
    return (
      <div className="flex min-h-screen bg-white">
        <DashboardSidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
            <p className="text-zinc-600">{error || "Pipeline not found"}</p>
            <Link href="/pipelines"><Button variant="outline" className="rounded-xl mt-4">← Back to Pipelines</Button></Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-white">
      <DashboardSidebar />
      <main className="flex-1 overflow-auto bg-white">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

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
            <Button variant="outline" size="sm" className="rounded-xl border-zinc-200 gap-1.5" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1 w-fit">
            {(["builder","test"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize",
                  activeTab === t ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
                {t === "builder" ? "DAG Builder" : "Test Run"}
              </button>
            ))}
          </div>

          {activeTab === "builder" ? (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: pipeline settings + nodes */}
              <div className="lg:col-span-3 space-y-3">
                {/* Settings */}
                <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pipeline Settings</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">Name</label>
                      <Input value={name} onChange={e => setName(e.target.value)} className="h-9 rounded-xl border-zinc-200 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-600">Timeout (s)</label>
                      <Input type="number" value={timeout} onChange={e => setTimeout_(parseInt(e.target.value) || 300)} min={30} max={1800} className="h-9 rounded-xl border-zinc-200 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Description</label>
                    <Input value={description} onChange={e => setDesc(e.target.value)} placeholder="What does this pipeline do?" className="h-9 rounded-xl border-zinc-200 text-sm" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div onClick={() => setIsPublic(v => !v)}
                      className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", isPublic ? "bg-primary" : "bg-zinc-200")}>
                      <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
                    </div>
                    <span className="text-xs font-medium text-zinc-600 flex items-center gap-1">
                      {isPublic ? <Globe className="inline h-3 w-3 mr-0.5" /> : <Lock className="inline h-3 w-3 mr-0.5" />}
                      {isPublic ? "Public pipeline" : "Private pipeline"}
                    </span>
                  </label>
                </div>

                {/* Nodes */}
                <div className="space-y-0">
                  {nodes.length === 0 ? (
                    <div className="text-center py-16 border-2 border-dashed border-zinc-100 rounded-2xl">
                      <Bot className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
                      <p className="text-sm font-semibold text-zinc-500 mb-1">No agents yet</p>
                      <p className="text-xs text-zinc-400">Search and click + to add agents from the panel on the right.</p>
                    </div>
                  ) : nodes.map((node, i) => (
                    <NodeCard key={node.id} node={node} index={i} total={nodes.length}
                      agentName={agentMap[node.agent_id]?.name ?? node.label ?? "Unknown"}
                      agentModel={agentMap[node.agent_id]?.model_name ?? ""}
                      onRemove={() => removeNode(i)}
                      onMoveUp={() => moveNode(i, -1)}
                      onMoveDown={() => moveNode(i, 1)}
                      onToggleContinue={() => toggleCont(i)}
                    />
                  ))}
                </div>

                {nodes.length > 0 && (
                  <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 text-xs text-zinc-500 flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-primary" />
                    Agents run sequentially. Output from each step becomes input to the next. Click ▲▼ to reorder.
                  </div>
                )}
              </div>

              {/* Right: agent picker */}
              <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl overflow-hidden flex flex-col"
                style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)", maxHeight: "680px" }}>
                <AgentPicker onAdd={addAgent} existingAgentIds={nodes.map(n => n.agent_id)} />
              </div>
            </div>
          ) : (
            <div className="max-w-xl">
              <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <p className="text-sm font-semibold text-zinc-900 mb-4">Test this pipeline</p>
                {nodes.length === 0
                  ? <div className="text-center py-8 text-zinc-400 text-sm">Add agents first, then save before testing.</div>
                  : <TestPanel pipelineId={pipeline.id} />}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
