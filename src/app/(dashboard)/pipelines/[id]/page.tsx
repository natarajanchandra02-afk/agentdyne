"use client"
export const runtime = 'edge'

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft, Plus, Trash2, Play, Save, Loader2, Search,
  AlertCircle, ChevronRight, Bot, Settings2, Globe, Lock,
  Info, Zap, GitBranch, Cpu, ArrowRight, ChevronDown, ChevronUp,
  X, Layers, CheckCircle2, AlertTriangle, DollarSign, FlaskConical,
  Clock, History, Tag, Sparkles, Check,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import { estimateCost, formatCostForDisplay } from "@/core/execution/costEstimator"

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = "linear" | "parallel" | "branch" | "subagent"

interface DAGNode {
  id:                   string
  agent_id:             string
  label:                string
  node_type?:           NodeType
  continue_on_failure?: boolean
  parallel_group?:      string
  condition?:           string
  sub_pipeline_id?:     string
  output_field?:        string
}

interface DAGEdge {
  from:       string
  to:         string
  condition?: string
}

interface Pipeline {
  id: string; name: string; description: string | null
  is_public: boolean; timeout_seconds: number
  dag: { nodes: DAGNode[]; edges: DAGEdge[] }
}

interface Agent {
  id: string; name: string; description: string
  model_name: string; pricing_model: string
  price_per_call: number | null; status: string
  input_schema?: Record<string, unknown> | null
  output_schema?: Record<string, unknown> | null
  system_prompt?: string; max_tokens?: number
}

interface ExecutionNodeResult {
  node_id:    string
  agent_name: string
  status:     "success" | "failed" | "skipped"
  latency_ms: number
  cost:       number
  tokens?:    { input: number; output: number }
  error?:     string
  output?:    unknown
}

interface ExecutionRun {
  id:               string
  status:           string
  created_at:       string
  total_latency_ms: number
  total_cost:       number
  error_message?:   string
  node_results?:    ExecutionNodeResult[]
  output?:          unknown
}

// ─── Node type config ─────────────────────────────────────────────────────────

const NODE_TYPE_CONFIG: Record<NodeType, { label: string; desc: string; color: string; bg: string; icon: React.ReactNode }> = {
  linear:   { label: "Linear",   desc: "Runs sequentially",                      color: "text-zinc-600",    bg: "bg-zinc-50",     icon: <ArrowRight className="h-3.5 w-3.5" /> },
  parallel: { label: "Parallel", desc: "Runs concurrently with other group nodes",color: "text-blue-600",    bg: "bg-blue-50",     icon: <Zap className="h-3.5 w-3.5" /> },
  branch:   { label: "Branch",   desc: "Conditional — skipped if condition false",color: "text-amber-600",   bg: "bg-amber-50",    icon: <GitBranch className="h-3.5 w-3.5" /> },
  subagent: { label: "Subagent", desc: "Delegates to a nested pipeline",          color: "text-violet-600",  bg: "bg-violet-50",   icon: <Cpu className="h-3.5 w-3.5" /> },
}

// ─── Branch condition presets ─────────────────────────────────────────────────

const BRANCH_PRESETS = [
  { label: "Sentiment is negative",     expr: (v: string) => `output.sentiment === 'negative'`,         hasValue: false },
  { label: "Sentiment is positive",     expr: (v: string) => `output.sentiment === 'positive'`,         hasValue: false },
  { label: "Score above threshold",     expr: (v: string) => `output.score > ${v || "0.7"}`,            hasValue: true, placeholder: "0.7" },
  { label: "Score below threshold",     expr: (v: string) => `output.score < ${v || "0.3"}`,            hasValue: true, placeholder: "0.3" },
  { label: "Output contains keyword",   expr: (v: string) => `output.text?.includes('${v || ""}')`,     hasValue: true, placeholder: "keyword" },
  { label: "Output field equals value", expr: (v: string) => `output.${v || "status"} === 'approved'`,  hasValue: true, placeholder: "fieldName" },
  { label: "Output is non-empty",       expr: (v: string) => `!!output.text`,                           hasValue: false },
  { label: "Custom expression",         expr: (v: string) => v,                                         hasValue: true, placeholder: "output.field > 0.5" },
]

// ─── Visual Condition Builder ─────────────────────────────────────────────────

function ConditionBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode,       setMode]       = useState<"preset" | "advanced">(value ? "advanced" : "preset")
  const [presetIdx,  setPresetIdx]  = useState(0)
  const [presetVal,  setPresetVal]  = useState("")

  const applyPreset = (idx: number, val: string) => {
    const preset = BRANCH_PRESETS[idx]!
    const expr   = preset.expr(val)
    onChange(expr)
  }

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 w-fit">
        {(["preset", "advanced"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all",
              mode === m ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500")}>
            {m === "preset" ? "Presets" : "Advanced"}
          </button>
        ))}
      </div>

      {mode === "preset" ? (
        <div className="space-y-2">
          {/* Preset selector */}
          <select
            value={presetIdx}
            onChange={e => { const i = parseInt(e.target.value); setPresetIdx(i); setPresetVal(""); applyPreset(i, "") }}
            className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white focus:outline-none focus:border-amber-300">
            {BRANCH_PRESETS.map((p, i) => (
              <option key={i} value={i}>{p.label}</option>
            ))}
          </select>

          {/* Value input if preset needs one */}
          {BRANCH_PRESETS[presetIdx]?.hasValue && (
            <input
              value={presetVal}
              onChange={e => { setPresetVal(e.target.value); applyPreset(presetIdx, e.target.value) }}
              placeholder={BRANCH_PRESETS[presetIdx]?.placeholder ?? "value"}
              className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white font-mono focus:outline-none focus:border-amber-300 transition-all"
            />
          )}

          {/* Live preview */}
          {value && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-[10px] text-amber-600 font-semibold mb-0.5">Expression preview</p>
              <code className="text-[11px] text-amber-800 font-mono">{value}</code>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="output.sentiment === 'negative'"
            className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-mono focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-50 transition-all"
          />
          <p className="text-[10px] text-zinc-400">
            Access previous output as <code className="bg-zinc-100 px-1 rounded text-[9px]">output</code> object.
            Examples: <code className="bg-zinc-100 px-1 rounded text-[9px]">output.score &gt; 0.8</code> ·
            <code className="bg-zinc-100 px-1 rounded text-[9px] ml-1">output.lang === &apos;en&apos;</code>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Schema mismatch checker ──────────────────────────────────────────────────

function schemaCompatible(
  outputSchema: Record<string, unknown> | null | undefined,
  inputSchema:  Record<string, unknown> | null | undefined
): { compatible: boolean; warnings: string[] } {
  if (!outputSchema || !inputSchema) return { compatible: true, warnings: [] }

  const outProps = (outputSchema as any).properties ?? {}
  const inProps  = (inputSchema  as any).properties ?? {}
  const required = ((inputSchema as any).required as string[]) ?? []

  const warnings: string[] = []

  for (const req of required) {
    if (!(req in outProps)) {
      warnings.push(`Required field "${req}" not in upstream output`)
    }
  }

  // Check type mismatches for overlapping fields
  for (const [key, inDef] of Object.entries(inProps)) {
    if (key in outProps) {
      const outType = (outProps[key] as any)?.type
      const inType  = (inDef as any)?.type
      if (outType && inType && outType !== inType) {
        warnings.push(`Field "${key}": output is ${outType}, input expects ${inType}`)
      }
    }
  }

  return { compatible: warnings.length === 0, warnings }
}

// ─── Schema mismatch badge ────────────────────────────────────────────────────

function SchemaMismatch({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)
  if (!warnings.length) return null
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full hover:bg-amber-100 transition-colors">
        <AlertTriangle className="h-3 w-3" /> Schema mismatch
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 bg-white border border-amber-100 rounded-xl shadow-lg p-3 w-72 space-y-1.5">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Schema warnings
            </p>
            {warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-zinc-600 flex items-start gap-1.5">
                <span className="text-amber-400 flex-shrink-0">•</span> {w}
              </p>
            ))}
            <p className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-100">
              Pipeline will still run — this is a warning only.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Node cost badge ──────────────────────────────────────────────────────────

function NodeCostBadge({ agent }: { agent?: Agent }) {
  if (!agent) return null
  if (agent.pricing_model === "free") return (
    <span className="text-[10px] text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full font-medium">Free</span>
  )
  const est = estimateCost({
    inputText:   "average input",
    systemPrompt: agent.system_prompt ?? "",
    model:       agent.model_name ?? "claude-sonnet-4-6",
    maxTokens:   agent.max_tokens ?? 4096,
  })
  return (
    <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
      <DollarSign className="h-2.5 w-2.5" /> ~{formatCostForDisplay(est.userCostUsd)}
    </span>
  )
}

// ─── Subagent pipeline selector ────────────────────────────────────────────────

function SubagentPipelineSelector({ value, onChange, currentPipelineId }: {
  value: string; onChange: (id: string, name: string) => void; currentPipelineId: string
}) {
  const [pipelines, setPipelines] = useState<Array<{ id: string; name: string; updated_at: string }>>([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    fetch("/api/pipelines?limit=50")
      .then(r => r.json())
      .then(d => {
        const list = (d.data ?? []).filter((p: any) => p.id !== currentPipelineId)
        setPipelines(list)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentPipelineId])

  if (loading) return <div className="h-9 bg-zinc-50 rounded-xl animate-pulse" />

  if (pipelines.length === 0) return (
    <div className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2">
      No other pipelines available. <Link href="/pipelines" className="text-primary hover:underline">Create one →</Link>
    </div>
  )

  return (
    <select
      value={value}
      onChange={e => {
        const selected = pipelines.find(p => p.id === e.target.value)
        if (selected) onChange(selected.id, selected.name)
      }}
      className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white focus:outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-50 transition-all">
      <option value="">— Select a pipeline —</option>
      {pipelines.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}

// ─── Per-node test panel ───────────────────────────────────────────────────────

function SingleNodeTester({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [input,   setInput]   = useState("")
  const [output,  setOutput]  = useState("")
  const [running, setRunning] = useState(false)

  const run = async () => {
    if (!input.trim()) { toast.error("Enter test input"); return }
    setRunning(true); setOutput("")
    try {
      const res  = await fetch(`/api/agents/${agent.id}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ input: input.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Test failed")
      const out = data.output
      setOutput(typeof out === "string" ? out : JSON.stringify(out, null, 2))
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (err: any) {
      toast.error(err.message); setOutput(`Error: ${err.message}`)
    } finally { setRunning(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg z-10 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">Test node: {agent.name}</p>
              <p className="text-xs text-zinc-400">Runs this agent in isolation with your test input</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Test Input</label>
            <Textarea value={input} onChange={e => setInput(e.target.value)} rows={4}
              placeholder='Enter test input for this agent...'
              className="rounded-xl border-zinc-200 text-sm resize-none" />
          </div>
          <Button onClick={run} disabled={running} className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
            {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run Node</>}
          </Button>
          {output && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Output</label>
              <div className="min-h-[60px] max-h-[200px] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 font-mono text-xs p-3 whitespace-pre-wrap text-zinc-700">{output}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Execution timeline ────────────────────────────────────────────────────────

function ExecutionTimeline({ runs }: { runs: ExecutionRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (runs.length === 0) return (
    <div className="text-center py-8 text-zinc-400 text-sm">
      <History className="h-6 w-6 mx-auto mb-2 text-zinc-300" />
      No executions yet. Run the pipeline to see traces here.
    </div>
  )

  return (
    <div className="space-y-2">
      {runs.map(run => (
        <div key={run.id} className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(e => e === run.id ? null : run.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
              run.status === "success" ? "bg-green-100 text-green-600" :
              run.status === "failed"  ? "bg-red-100 text-red-600" :
                                         "bg-blue-100 text-blue-600"
            )}>
              {run.status === "success" ? <Check className="h-3 w-3" /> :
               run.status === "failed"  ? <X className="h-3 w-3" /> :
                                          <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  run.status === "success" ? "bg-green-50 text-green-600" :
                  run.status === "failed"  ? "bg-red-50 text-red-600" :
                                             "bg-blue-50 text-blue-600"
                )}>{run.status}</span>
                <span className="text-xs text-zinc-500 font-mono">{run.id.slice(0, 8)}…</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-0.5">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{run.total_latency_ms}ms</span>
                <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />${Number(run.total_cost ?? 0).toFixed(6)}</span>
                <span>{new Date(run.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
            {expanded === run.id ? <ChevronUp className="h-4 w-4 text-zinc-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-zinc-400 flex-shrink-0" />}
          </button>

          {/* Expanded: per-node trace */}
          {expanded === run.id && (
            <div className="border-t border-zinc-50 px-4 py-3 space-y-2 bg-zinc-50/40">
              {run.error_message && (
                <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" /> {run.error_message}
                </div>
              )}
              {run.node_results?.map((nr, i) => (
                <div key={i} className="flex items-center gap-3 bg-white border border-zinc-100 rounded-lg px-3 py-2">
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px]",
                    nr.status === "success" ? "bg-green-100 text-green-600" :
                    nr.status === "failed"  ? "bg-red-100 text-red-600" :
                                              "bg-zinc-100 text-zinc-400"
                  )}>
                    {nr.status === "success" ? "✓" : nr.status === "failed" ? "✕" : "—"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-800 truncate">{nr.agent_name}</p>
                    {nr.error && <p className="text-[11px] text-red-500 truncate">{nr.error}</p>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-400 flex-shrink-0">
                    <span>{nr.latency_ms}ms</span>
                    <span>${Number(nr.cost ?? 0).toFixed(6)}</span>
                    {nr.tokens && <span>{nr.tokens.input + nr.tokens.output}t</span>}
                  </div>
                </div>
              ))}
              {run.output !== undefined && run.output !== null && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Final output</p>
                  <div className="bg-white border border-zinc-100 rounded-lg px-3 py-2 font-mono text-[11px] text-zinc-600 max-h-[120px] overflow-auto whitespace-pre-wrap">
                    {typeof run.output === "string" ? run.output : JSON.stringify(run.output, null, 2)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Agent Picker ─────────────────────────────────────────────────────────────

function AgentPicker({ onAdd, existingIds }: { onAdd: (a: Agent) => void; existingIds: string[] }) {
  const [q, setQ]       = useState("")
  const [agents, set]   = useState<Agent[]>([])
  const [loading, setL] = useState(false)

  const search = useCallback(async (query: string) => {
    setL(true)
    try {
      const params = new URLSearchParams({ status: "active", limit: "20", sort: "popular", ...(query.trim() ? { q: query.trim() } : {}) })
      const res  = await fetch(`/api/agents?${params}`)
      const data = await res.json()
      set(data.data ?? data.agents ?? [])
    } catch { set([]) } finally { setL(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(q), q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, search])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-100">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Add Agent Step</p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search active agents…"
            className="pl-9 h-9 rounded-xl border-zinc-200 text-sm bg-white" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {loading
          ? <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-300 mx-auto" /></div>
          : agents.length === 0
            ? <div className="text-center py-8 text-zinc-400 text-sm">No active agents.<br />
                <Link href="/builder" className="text-primary hover:underline text-xs mt-1 block">Create one →</Link>
              </div>
            : agents.map(agent => {
                const added = existingIds.includes(agent.id)
                return (
                  <div key={agent.id} onClick={() => !added && onAdd(agent)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border transition-all",
                      added ? "border-zinc-100 bg-zinc-50 opacity-50 cursor-default"
                            : "border-zinc-100 bg-white hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer group"
                    )}>
                    <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{agent.name}</p>
                      <p className="text-xs text-zinc-400 truncate">{agent.description?.slice(0, 55)}</p>
                    </div>
                    {added ? <span className="text-[10px] text-zinc-400 flex-shrink-0">Added</span>
                           : <Plus className="h-4 w-4 text-zinc-300 group-hover:text-primary flex-shrink-0" />}
                  </div>
                )
              })}
      </div>
    </div>
  )
}

// ─── Node Card ────────────────────────────────────────────────────────────────

function NodeCard({ node, index, total, agent, nextAgent, onParallelSelect, isParallelSelected, onChange, onRemove, onMoveUp, onMoveDown, onTestNode, currentPipelineId }: {
  node:               DAGNode
  index:              number
  total:              number
  agent?:             Agent
  nextAgent?:         Agent
  onParallelSelect:   () => void
  isParallelSelected: boolean
  onChange:           (patch: Partial<DAGNode>) => void
  onRemove:           () => void
  onMoveUp:           () => void
  onMoveDown:         () => void
  onTestNode:         () => void
  currentPipelineId:  string
}) {
  const [exp, setExp] = useState(false)
  const cfg = NODE_TYPE_CONFIG[node.node_type ?? "linear"]

  // Schema mismatch with next node
  const schemaCheck = agent && nextAgent
    ? schemaCompatible(agent.output_schema, nextAgent.input_schema)
    : { compatible: true, warnings: [] }

  return (
    <div className={cn(
      "bg-white border rounded-2xl overflow-hidden shadow-sm transition-all",
      isParallelSelected ? "border-blue-300 ring-2 ring-blue-100" : "border-zinc-100"
    )}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Parallel select checkbox */}
        <button
          onClick={onParallelSelect}
          title="Select for parallel grouping"
          className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
            isParallelSelected ? "border-blue-400 bg-blue-400 text-white" : "border-zinc-200 hover:border-blue-300"
          )}>
          {isParallelSelected && <Check className="h-3 w-3" />}
        </button>

        <div className={cn(
          "w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0",
          cfg.bg, cfg.color
        )}>
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <input
            value={node.label}
            onChange={e => onChange({ label: e.target.value })}
            className="w-full text-sm font-semibold text-zinc-900 bg-transparent border-none outline-none focus:bg-zinc-50 focus:px-1 rounded transition-all truncate"
          />
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
              {cfg.icon} {cfg.label}
            </span>
            {node.parallel_group && (
              <span className="text-[10px] text-blue-500 font-medium bg-blue-50 px-1.5 py-0.5 rounded-full">
                ∥ {node.parallel_group}
              </span>
            )}
            {node.condition && (
              <span className="text-[10px] text-amber-600 font-medium">
                if: {node.condition.slice(0, 25)}{node.condition.length > 25 ? "…" : ""}
              </span>
            )}
            <NodeCostBadge agent={agent} />
            {!schemaCheck.compatible && index < total - 1 && (
              <SchemaMismatch warnings={schemaCheck.warnings} />
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onTestNode} title="Test this node in isolation"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-primary hover:bg-primary/8 transition-colors">
            <FlaskConical className="h-3.5 w-3.5" />
          </button>
          <button onClick={onMoveUp}   disabled={index === 0}         className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20"><ChevronUp   className="h-3.5 w-3.5" /></button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button onClick={() => setExp(e => !e)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onRemove} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded config */}
      {exp && (
        <div className="border-t border-zinc-50 px-4 py-4 bg-zinc-50/60 space-y-4">

          {/* Node type */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Pattern</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.entries(NODE_TYPE_CONFIG) as [NodeType, typeof NODE_TYPE_CONFIG[NodeType]][]).map(([type, c]) => (
                <button key={type}
                  onClick={() => onChange({ node_type: type, condition: type !== "branch" ? undefined : node.condition, parallel_group: type !== "parallel" ? undefined : node.parallel_group })}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all text-xs",
                    (node.node_type ?? "linear") === type
                      ? `${c.bg} ${c.color} border-current/20 font-semibold`
                      : "bg-white border-zinc-100 text-zinc-500 hover:border-zinc-200"
                  )}>
                  {c.icon}
                  <div><p className="font-semibold">{c.label}</p><p className="text-[10px] opacity-70">{c.desc}</p></div>
                  {(node.node_type ?? "linear") === type && <CheckCircle2 className="h-3.5 w-3.5 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Branch: visual condition builder */}
          {node.node_type === "branch" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <GitBranch className="h-3 w-3 text-amber-500" /> Run condition
              </label>
              <ConditionBuilder value={node.condition ?? ""} onChange={v => onChange({ condition: v })} />
            </div>
          )}

          {/* Parallel: note about grouping (actual grouping done via checkboxes) */}
          {node.node_type === "parallel" && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-blue-700 flex items-center gap-1.5">
                <Zap className="h-3 w-3" /> Parallel group: {node.parallel_group ?? "not set"}
              </p>
              <p className="text-[11px] text-blue-600">
                Use the checkboxes on the node cards to select multiple nodes, then click
                <strong> "Group as Parallel"</strong> to assign them the same group.
                Nodes in the same group run at the same time.
              </p>
            </div>
          )}

          {/* Subagent: pipeline selector */}
          {node.node_type === "subagent" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-violet-500" /> Delegate to pipeline
              </label>
              <SubagentPipelineSelector
                value={node.sub_pipeline_id ?? ""}
                currentPipelineId={currentPipelineId}
                onChange={(id, name) => onChange({ sub_pipeline_id: id, label: node.label || name })}
              />
              {node.sub_pipeline_id && (
                <p className="text-[10px] text-zinc-400">
                  Selected: <code className="bg-zinc-100 px-1 rounded text-[9px]">{node.sub_pipeline_id.slice(0, 8)}…</code>
                </p>
              )}
            </div>
          )}

          {/* Output field */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Output field (optional)</label>
            <input
              value={node.output_field ?? ""}
              onChange={e => onChange({ output_field: e.target.value })}
              placeholder={`"text", "result.items[0]", "summary"`}
              className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-mono focus:outline-none focus:border-zinc-300 transition-all"
            />
            <p className="text-[10px] text-zinc-400">Extract a specific field from output before passing downstream.</p>
          </div>

          {/* Continue on failure */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => onChange({ continue_on_failure: !node.continue_on_failure })}
              className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", node.continue_on_failure ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", node.continue_on_failure ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-700">Continue on failure</p>
              <p className="text-[11px] text-zinc-400">Pass null downstream instead of aborting the pipeline.</p>
            </div>
          </label>
        </div>
      )}

      {/* Connector arrow */}
      {index < total - 1 && (
        <div className="flex items-center justify-center py-1.5 bg-zinc-50 gap-1.5">
          {/* Show warning between incompatible nodes */}
          {!schemaCheck.compatible
            ? <span className="flex items-center gap-1 text-[10px] text-amber-500"><AlertTriangle className="h-3 w-3" /> type mismatch</span>
            : <ChevronRight className="h-4 w-4 text-zinc-300 rotate-90" />}
        </div>
      )}
    </div>
  )
}

// ─── Pattern help ─────────────────────────────────────────────────────────────

function PatternHelp() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Info className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
        <span className="text-xs font-semibold text-blue-700 flex-1">Multi-agent pattern guide</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-blue-400" /> : <ChevronDown className="h-3.5 w-3.5 text-blue-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-blue-100">
          {[
            { icon: <ArrowRight className="h-3.5 w-3.5" />, color: "text-zinc-600", title: "Linear A→B→C", desc: "Default. Each step's output feeds the next. Use for: Fetch → Summarise → Email" },
            { icon: <Zap className="h-3.5 w-3.5" />,          color: "text-blue-600",   title: "Parallel (B∥C)", desc: "Select multiple nodes with checkboxes → click 'Group as Parallel'. Same-group nodes run at once." },
            { icon: <GitBranch className="h-3.5 w-3.5" />,    color: "text-amber-600",  title: "Branch [condition]", desc: "Use preset conditions or write custom JS. Node is skipped when expression evaluates to false." },
            { icon: <Cpu className="h-3.5 w-3.5" />,          color: "text-violet-600", title: "Subagent", desc: "Select a pipeline from the dropdown. That pipeline runs as a nested workflow and returns its output." },
          ].map(p => (
            <div key={p.title} className="flex items-start gap-2.5">
              <div className={cn("mt-0.5 flex-shrink-0", p.color)}>{p.icon}</div>
              <div>
                <p className={cn("text-[11px] font-semibold", p.color)}>{p.title}</p>
                <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PipelineEditPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const [pipeline,         setPipeline]         = useState<Pipeline | null>(null)
  const [nodes,            setNodes]             = useState<DAGNode[]>([])
  const [agentMap,         setAgentMap]          = useState<Record<string, Agent>>({})
  const [loading,          setLoading]           = useState(true)
  const [saving,           setSaving]            = useState(false)
  const [error,            setError]             = useState("")
  const [activeTab,        setActiveTab]         = useState<"builder" | "test" | "history">("builder")
  const [name,             setName]              = useState("")
  const [description,      setDesc]              = useState("")
  const [isPublic,         setIsPublic]          = useState(false)
  const [timeout,          setTimeout_]          = useState(300)
  const [parallelSelected, setParallelSelected]  = useState<Set<string>>(new Set())
  const [testingNode,      setTestingNode]       = useState<Agent | null>(null)
  const [runs,             setRuns]              = useState<ExecutionRun[]>([])
  const [runsLoading,      setRunsLoading]       = useState(false)

  // Load pipeline
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push("/login"); return }
      try {
        const res = await fetch(`/api/pipelines/${id}`)
        if (!res.ok) { setError("Pipeline not found"); setLoading(false); return }
        const p: Pipeline = await res.json()
        if (cancelled) return

        setPipeline(p); setName(p.name); setDesc(p.description ?? "")
        setIsPublic(p.is_public); setTimeout_(p.timeout_seconds ?? 300)
        const dagNodes = p.dag?.nodes ?? []
        setNodes(dagNodes)

        const agentIds = [...new Set(dagNodes.map(n => n.agent_id).filter(Boolean))]
        if (agentIds.length > 0) {
          const { data: agents } = await supabase
            .from("agents")
            .select("id, name, description, model_name, pricing_model, price_per_call, status, input_schema, output_schema, system_prompt, max_tokens")
            .in("id", agentIds)
          if (!cancelled) {
            const map: Record<string, Agent> = {}
            for (const a of agents ?? []) map[a.id] = a as Agent
            setAgentMap(map)
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  // Load execution history when History tab is opened
  useEffect(() => {
    if (activeTab !== "history" || !id) return
    setRunsLoading(true)
    supabase
      .from("pipeline_executions")
      .select("id, status, created_at, total_latency_ms, total_cost, error_message, node_results, output")
      .eq("pipeline_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setRuns((data ?? []) as ExecutionRun[]))
      .finally(() => setRunsLoading(false))
  }, [activeTab, id])

  const addAgent = (agent: Agent) => {
    const nodeId = `node_${Date.now()}`
    setNodes(prev => [...prev, { id: nodeId, agent_id: agent.id, label: agent.name, node_type: "linear", continue_on_failure: false }])
    setAgentMap(prev => ({ ...prev, [agent.id]: agent }))
  }
  const removeNode  = (i: number) => setNodes(prev => prev.filter((_, j) => j !== i))
  const moveNode    = (i: number, d: -1 | 1) => setNodes(prev => {
    const a = [...prev]; const j = i + d
    if (j < 0 || j >= a.length) return prev
    ;[a[i], a[j]] = [a[j]!, a[i]!]
    return a
  })
  const patchNode   = (i: number, patch: Partial<DAGNode>) =>
    setNodes(prev => prev.map((n, j) => j === i ? { ...n, ...patch } : n))

  // Parallel grouping
  const toggleParallelSelect = (nodeId: string) =>
    setParallelSelected(prev => { const s = new Set(prev); s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId); return s })

  const groupAsParallel = () => {
    if (parallelSelected.size < 2) { toast.error("Select at least 2 nodes to group"); return }
    const groupId = `grp_${Date.now().toString(36)}`
    setNodes(prev => prev.map(n =>
      parallelSelected.has(n.id) ? { ...n, node_type: "parallel" as NodeType, parallel_group: groupId } : n
    ))
    setParallelSelected(new Set())
    toast.success(`${parallelSelected.size} nodes grouped as parallel (${groupId})`)
  }

  const buildEdges = (ns: DAGNode[]): DAGEdge[] => {
    const edges: DAGEdge[] = []
    for (let i = 0; i < ns.length - 1; i++) {
      const e: DAGEdge = { from: ns[i]!.id, to: ns[i + 1]!.id }
      if (ns[i + 1]!.node_type === "branch" && ns[i + 1]!.condition) {
        e.condition = ns[i + 1]!.condition
      }
      edges.push(e)
    }
    return edges
  }

  const save = async () => {
    if (!pipeline) return
    if (nodes.length === 0) { toast.error("Add at least one agent"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:            name.trim() || pipeline.name,
          description:     description.trim() || null,
          is_public:       isPublic,
          timeout_seconds: timeout,
          dag:             { nodes, edges: buildEdges(nodes) },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      toast.success("Pipeline saved!")
      setPipeline(data)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setSaving(false) }
  }

  // Computed values
  const totalEstimatedCost = nodes.reduce((sum, n) => {
    const agent = agentMap[n.agent_id]
    if (!agent || agent.pricing_model === "free") return sum
    const est = estimateCost({ inputText: "average", systemPrompt: agent.system_prompt ?? "", model: agent.model_name ?? "claude-sonnet-4-6", maxTokens: agent.max_tokens ?? 4096 })
    return sum + est.userCostUsd
  }, 0)

  const hasParallel  = nodes.some(n => n.node_type === "parallel")
  const hasBranch    = nodes.some(n => n.node_type === "branch")
  const hasSubagent  = nodes.some(n => n.node_type === "subagent")
  const patternLabel = hasParallel && hasBranch ? "mixed" : hasParallel ? "parallel" : hasBranch ? "branch" : hasSubagent ? "subagent" : "linear"

  if (loading) return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-zinc-400">Loading pipeline…</p>
      </div>
    </div>
  )

  if (error || !pipeline) return (
    <div className="flex-1 flex items-center justify-center p-8 min-h-[60vh]">
      <div className="text-center">
        <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
        <p className="text-zinc-700 font-semibold mb-1">{error || "Pipeline not found"}</p>
        <Link href="/pipelines"><Button variant="outline" className="rounded-xl mt-3">← Back</Button></Link>
      </div>
    </div>
  )

  return (
    <>
      {/* Per-node test modal */}
      {testingNode && <SingleNodeTester agent={testingNode} onClose={() => setTestingNode(null)} />}

      <div className="flex flex-col min-h-full">

        {/* Top bar */}
        <div className="bg-white border-b border-zinc-100 px-6 py-3 flex items-center justify-between -mx-6 -mt-8 mb-6 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Link href="/pipelines">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl"><ArrowLeft className="h-4 w-4" /></Button>
            </Link>
            <div>
              <h1 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                {pipeline.name}
                {patternLabel !== "linear" && (
                  <span className={cn(
                    "flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full",
                    patternLabel === "parallel" ? "bg-blue-50 text-blue-600" :
                    patternLabel === "branch"   ? "bg-amber-50 text-amber-600" :
                    patternLabel === "subagent" ? "bg-violet-50 text-violet-600" :
                                                  "bg-green-50 text-green-600"
                  )}>
                    {patternLabel === "parallel" ? <Zap className="h-3 w-3" /> : patternLabel === "branch" ? <GitBranch className="h-3 w-3" /> : patternLabel === "subagent" ? <Cpu className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                    {patternLabel}
                  </span>
                )}
              </h1>
              <p className="text-xs text-zinc-400">
                {nodes.length} agent{nodes.length !== 1 ? "s" : ""}
                {totalEstimatedCost > 0 && <> · ~{formatCostForDisplay(totalEstimatedCost)}/run</>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Parallel group button */}
            {parallelSelected.size >= 2 && (
              <Button size="sm" onClick={groupAsParallel}
                className="rounded-xl bg-blue-600 text-white hover:bg-blue-700 gap-1.5 font-semibold">
                <Zap className="h-3.5 w-3.5" /> Group as Parallel ({parallelSelected.size})
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={saving}
              className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 font-semibold">
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5" /> Save</>}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white border border-zinc-100 rounded-xl p-1 w-fit shadow-xs mb-5">
          {([
            ["builder", "DAG Builder", null],
            ["test",    "Test Run",    null],
            ["history", "Run History", runs.length > 0 ? runs.length : null],
          ] as const).map(([k, l, badge]) => (
            <button key={k} onClick={() => setActiveTab(k)}
              className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
                activeTab === k ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
              {l}
              {badge && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  activeTab === k ? "bg-white/20" : "bg-zinc-100 text-zinc-500")}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── BUILDER TAB ──────────────────────────────────────────────────── */}
        {activeTab === "builder" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 space-y-4">

              {/* Settings */}
              <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Name</label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="h-9 rounded-xl border-zinc-200 text-sm bg-white" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-600">Timeout (s)</label>
                    <Input type="number" value={timeout} onChange={e => setTimeout_(parseInt(e.target.value) || 300)} min={30} max={1800} className="h-9 rounded-xl border-zinc-200 text-sm bg-white" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-600">Description</label>
                  <Input value={description} onChange={e => setDesc(e.target.value)} placeholder="What does this pipeline do?" className="h-9 rounded-xl border-zinc-200 text-sm bg-white" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={() => setIsPublic(v => !v)} className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", isPublic ? "bg-primary" : "bg-zinc-200")}>
                    <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
                  </div>
                  <span className="text-xs font-medium text-zinc-600 flex items-center gap-1">
                    {isPublic ? <><Globe className="h-3 w-3" /> Public</> : <><Lock className="h-3 w-3" /> Private</>}
                  </span>
                </label>
              </div>

              {/* Parallel group hint */}
              {parallelSelected.size > 0 && parallelSelected.size < 2 && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 text-xs text-blue-700 flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 flex-shrink-0" />
                  Select {2 - parallelSelected.size} more node{2 - parallelSelected.size > 1 ? "s" : ""} to enable parallel grouping.
                </div>
              )}

              {/* Node list */}
              {nodes.length === 0 ? (
                <div className="text-center py-16 border-2 border-dashed border-zinc-100 rounded-2xl bg-white">
                  <Bot className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-zinc-500 mb-1">No agents yet</p>
                  <p className="text-xs text-zinc-400">Search and click + to add agents from the panel.</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {nodes.map((node, i) => (
                    <NodeCard
                      key={node.id}
                      node={node}
                      index={i}
                      total={nodes.length}
                      agent={agentMap[node.agent_id]}
                      nextAgent={i < nodes.length - 1 ? agentMap[nodes[i + 1]!.agent_id] : undefined}
                      isParallelSelected={parallelSelected.has(node.id)}
                      onParallelSelect={() => toggleParallelSelect(node.id)}
                      onChange={patch => patchNode(i, patch)}
                      onRemove={() => removeNode(i)}
                      onMoveUp={() => moveNode(i, -1)}
                      onMoveDown={() => moveNode(i, 1)}
                      onTestNode={() => { const a = agentMap[node.agent_id]; if (a) setTestingNode(a) }}
                      currentPipelineId={pipeline.id}
                    />
                  ))}
                </div>
              )}

              {/* Cost summary */}
              {nodes.length > 0 && totalEstimatedCost > 0 && (
                <div className="bg-white border border-zinc-100 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <DollarSign className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Estimated cost per run:</span>
                  </div>
                  <span className="text-sm font-bold text-zinc-900 font-mono">
                    ~{formatCostForDisplay(totalEstimatedCost)}
                  </span>
                </div>
              )}

              <PatternHelp />
            </div>

            {/* Right: agent picker */}
            <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl overflow-hidden flex flex-col"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)", maxHeight: 700 }}>
              <AgentPicker onAdd={addAgent} existingIds={nodes.map(n => n.agent_id)} />
            </div>
          </div>
        )}

        {/* ── TEST TAB ─────────────────────────────────────────────────────── */}
        {activeTab === "test" && (
          <div className="max-w-xl">
            <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <p className="text-sm font-semibold text-zinc-900 mb-4">Test this pipeline</p>
              {nodes.length === 0
                ? <p className="text-center py-8 text-zinc-400 text-sm">Add and save agents first.</p>
                : <FullPipelineTest pipelineId={pipeline.id} onNewRun={run => setRuns(prev => [run, ...prev])} />}
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="max-w-2xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">Recent Executions</p>
              <button onClick={() => {
                setRunsLoading(true)
                supabase.from("pipeline_executions")
                  .select("id, status, created_at, total_latency_ms, total_cost, error_message, node_results, output")
                  .eq("pipeline_id", id).order("created_at", { ascending: false }).limit(20)
                  .then(({ data }) => setRuns((data ?? []) as ExecutionRun[]))
                  .finally(() => setRunsLoading(false))
              }} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Loader2 className={cn("h-3 w-3", runsLoading && "animate-spin")} /> Refresh
              </button>
            </div>
            {runsLoading
              ? <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-zinc-50 rounded-xl animate-pulse" />)}</div>
              : <ExecutionTimeline runs={runs} />}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Full pipeline test (with live node trace) ────────────────────────────────

function FullPipelineTest({ pipelineId, onNewRun }: { pipelineId: string; onNewRun: (r: ExecutionRun) => void }) {
  const [input,   setInput]   = useState('{"input": "Hello, run this pipeline."}')
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<ExecutionRun | null>(null)

  const run = async () => {
    setRunning(true); setResult(null)
    try {
      let inp: unknown
      try { inp = JSON.parse(input) } catch { inp = input }
      const res  = await fetch(`/api/pipelines/${pipelineId}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ input: inp }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      const run: ExecutionRun = {
        id:               data.executionId,
        status:           data.status,
        created_at:       new Date().toISOString(),
        total_latency_ms: data.summary?.total_latency_ms ?? 0,
        total_cost:       parseFloat(data.summary?.total_cost_usd ?? "0"),
        node_results:     data.node_results,
        output:           data.output,
      }
      setResult(run)
      onNewRun(run)
      toast.success(`Done in ${run.total_latency_ms}ms`)
    } catch (err: any) {
      toast.error(err.message)
      setResult({ id: "err", status: "failed", created_at: new Date().toISOString(), total_latency_ms: 0, total_cost: 0, error_message: err.message })
    } finally { setRunning(false) }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Input</label>
        <Textarea value={input} onChange={e => setInput(e.target.value)} rows={4}
          className="rounded-xl border-zinc-200 bg-white font-mono text-xs resize-none" />
      </div>
      <Button onClick={run} disabled={running} className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
        {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run Pipeline</>}
      </Button>
      {result && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Execution Trace</p>
          <ExecutionTimeline runs={[result]} />
        </div>
      )}
    </div>
  )
}
