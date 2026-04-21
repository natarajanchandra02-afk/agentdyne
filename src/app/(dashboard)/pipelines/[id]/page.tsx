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
  Clock, History, Sparkles, Check, RefreshCw, ShieldAlert,
  Eye, EyeOff, ChevronsUpDown, Share2, Copy, Lightbulb,
  Network, Workflow, Code2, ChevronLeft,
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
type NodeStatus = "idle" | "running" | "success" | "failed" | "skipped"

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
  max_retries?:         number
  retry_delay_ms?:      number
  fallback_agent_id?:   string
}

interface DAGEdge { from: string; to: string; condition?: string }

interface Pipeline {
  id: string; name: string; description: string | null
  is_public: boolean; timeout_seconds: number
  dag: { nodes: DAGNode[]; edges: DAGEdge[]; strict_schema_mode?: boolean }
}

interface Agent {
  id: string; name: string; description: string
  model_name: string; pricing_model: string
  price_per_call: number | null; status: string
  input_schema?:  Record<string, unknown> | null
  output_schema?: Record<string, unknown> | null
  system_prompt?: string; max_tokens?: number
}

interface ExecutionNodeResult {
  node_id: string; agent_name: string
  status:  "success" | "failed" | "skipped"
  latency_ms: number; cost: number
  tokens?:    { input: number; output: number }
  error?: string; output?: unknown; input?: unknown
  retry_count?: number; used_fallback?: boolean
}

interface ExecutionRun {
  id: string; status: string; created_at: string
  total_latency_ms: number; total_cost: number
  error_message?: string; node_results?: ExecutionNodeResult[]
  output?: unknown; input?: unknown
}

// ─── Node type config (human-friendly labels) ────────────────────────────────

const NODE_TYPE_CONFIG: Record<NodeType, { label: string; friendlyLabel: string; desc: string; color: string; bg: string; icon: React.ReactNode }> = {
  linear:   { label: "Linear",      friendlyLabel: "Sequential",    desc: "Runs one after another",             color: "text-zinc-600",   bg: "bg-zinc-50",   icon: <ArrowRight className="h-3.5 w-3.5" /> },
  parallel: { label: "Run Together", friendlyLabel: "Run Together", desc: "Runs concurrently with grouped nodes", color: "text-blue-600",   bg: "bg-blue-50",   icon: <Zap className="h-3.5 w-3.5" /> },
  branch:   { label: "Condition",    friendlyLabel: "Condition",    desc: "Only runs if condition is true",     color: "text-amber-600",  bg: "bg-amber-50",  icon: <GitBranch className="h-3.5 w-3.5" /> },
  subagent: { label: "Nested Flow",  friendlyLabel: "Nested Flow",  desc: "Delegates to another pipeline",     color: "text-violet-600", bg: "bg-violet-50", icon: <Cpu className="h-3.5 w-3.5" /> },
}

const NODE_STATUS_CONFIG: Record<NodeStatus, { color: string; bg: string; border: string; label: string }> = {
  idle:    { color: "text-zinc-400",  bg: "bg-zinc-50",   border: "border-zinc-100",  label: ""         },
  running: { color: "text-blue-600",  bg: "bg-blue-50",   border: "border-blue-200",  label: "Running…" },
  success: { color: "text-green-600", bg: "bg-green-50",  border: "border-green-200", label: "Done"     },
  failed:  { color: "text-red-600",   bg: "bg-red-50",    border: "border-red-200",   label: "Failed"   },
  skipped: { color: "text-zinc-400",  bg: "bg-zinc-50",   border: "border-zinc-100",  label: "Skipped"  },
}

const BRANCH_PRESETS = [
  { label: "Sentiment is negative",   expr: (_v: string) => `output.sentiment === 'negative'`,     hasVal: false },
  { label: "Score above threshold",   expr: (v: string) => `output.score > ${v || "0.7"}`,         hasVal: true, placeholder: "0.7" },
  { label: "Score below threshold",   expr: (v: string) => `output.score < ${v || "0.3"}`,         hasVal: true, placeholder: "0.3" },
  { label: "Output contains keyword", expr: (v: string) => `output.text?.includes('${v || ""}')`,  hasVal: true, placeholder: "keyword" },
  { label: "Output is non-empty",     expr: (_v: string) => `!!output.text`,                        hasVal: false },
  { label: "Custom expression",       expr: (v: string) => v,                                       hasVal: true, placeholder: "output.score > 0.5" },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function schemaCompatible(out?: Record<string,unknown>|null, inp?: Record<string,unknown>|null) {
  if (!out || !inp) return { compatible: true, warnings: [] as string[] }
  const outP = (out as any).properties ?? {}
  const inP  = (inp as any).properties ?? {}
  const req  = ((inp as any).required as string[]) ?? []
  const warnings: string[] = []
  for (const r of req) { if (!(r in outP)) warnings.push(`Required field "${r}" not in upstream output`) }
  for (const [k, d] of Object.entries(inP)) {
    if (k in outP) {
      const ot = (outP[k] as any)?.type, it = (d as any)?.type
      if (ot && it && ot !== it) warnings.push(`"${k}": output=${ot}, input expects ${it}`)
    }
  }
  return { compatible: warnings.length === 0, warnings }
}

function buildEdges(ns: DAGNode[]): DAGEdge[] {
  return ns.slice(0, -1).map((n, i) => {
    const next = ns[i + 1]!
    const e: DAGEdge = { from: n.id, to: next.id }
    if (next.node_type === "branch" && next.condition) e.condition = next.condition
    return e
  })
}

// Build topological levels for DAG diagram
function buildLevels(nodes: DAGNode[]): DAGNode[][] {
  if (!nodes.length) return []
  const levels: DAGNode[][] = []
  const seen = new Set<string>()
  // Group parallel nodes together
  const remaining = [...nodes]
  while (remaining.length > 0) {
    const node = remaining.shift()!
    if (seen.has(node.id)) continue
    if (node.node_type === "parallel" && node.parallel_group) {
      // Collect all nodes in this parallel group
      const groupNodes = [node, ...remaining.filter(n => n.parallel_group === node.parallel_group)]
      groupNodes.forEach(n => seen.add(n.id))
      remaining.splice(0, remaining.length, ...remaining.filter(n => n.parallel_group !== node.parallel_group))
      levels.push(groupNodes)
    } else {
      seen.add(node.id)
      levels.push([node])
    }
  }
  return levels
}

// ─── DAG Visual Diagram ───────────────────────────────────────────────────────

function DAGVisual({ nodes, agentMap, nodeStatuses }: {
  nodes: DAGNode[]
  agentMap: Record<string, Agent>
  nodeStatuses: Record<string, NodeStatus>
}) {
  if (nodes.length === 0) return null

  const levels = buildLevels(nodes)

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 overflow-x-auto" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
          <Network className="h-3.5 w-3.5 text-primary" /> Flow Diagram
        </p>
        <p className="text-[11px] text-zinc-400">{nodes.length} step{nodes.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="flex items-center gap-0 min-w-max">
        {levels.map((levelNodes, levelIdx) => (
          <div key={levelIdx} className="flex items-center gap-0">

            {/* Level: single node or parallel group */}
            <div className={cn(
              "flex items-center gap-0",
              levelNodes.length > 1 ? "flex-col gap-1.5" : "flex-row"
            )}>
              {levelNodes.length > 1 && (
                <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 mb-1">
                    <Zap className="h-3 w-3 text-blue-500" />
                    <span className="text-[10px] font-semibold text-blue-500">Run Together</span>
                  </div>
                  {levelNodes.map(node => (
                    <DAGNode key={node.id} node={node} agent={agentMap[node.agent_id]} status={nodeStatuses[node.id] ?? "idle"} />
                  ))}
                </div>
              )}
              {levelNodes.length === 1 && (
                <DAGNode node={levelNodes[0]!} agent={agentMap[levelNodes[0]!.agent_id]} status={nodeStatuses[levelNodes[0]!.id] ?? "idle"} />
              )}
            </div>

            {/* Arrow between levels */}
            {levelIdx < levels.length - 1 && (
              <div className="flex flex-col items-center justify-center px-2">
                {/* Show condition label if next level starts with a branch node */}
                {levels[levelIdx + 1]?.[0]?.node_type === "branch" && levels[levelIdx + 1]?.[0]?.condition ? (
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1">
                      <div className="h-px w-4 bg-amber-300" />
                      <div className="text-[9px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full font-medium max-w-[80px] truncate">
                        if: {levels[levelIdx + 1]?.[0]?.condition?.slice(0, 20)}
                      </div>
                      <div className="h-px w-2 bg-amber-300" />
                      <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-amber-300" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {/* Show output field hint */}
                    {levelNodes[0]?.output_field && (
                      <div className="text-[9px] text-zinc-400 bg-zinc-50 border border-zinc-100 px-1 py-0.5 rounded-full max-w-[60px] truncate">
                        .{levelNodes[0].output_field}
                      </div>
                    )}
                    <div className="h-px w-5 bg-zinc-200" />
                    <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-zinc-300" />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function DAGNode({ node, agent, status }: { node: DAGNode; agent?: Agent; status: NodeStatus }) {
  const cfg     = NODE_TYPE_CONFIG[node.node_type ?? "linear"]
  const stCfg   = NODE_STATUS_CONFIG[status]
  const isLive  = status !== "idle"

  return (
    <div className={cn(
      "relative flex flex-col items-start px-3 py-2.5 rounded-xl border transition-all min-w-[100px] max-w-[140px]",
      isLive ? `${stCfg.bg} ${stCfg.border}` : "bg-white border-zinc-100",
      status === "running" && "ring-2 ring-blue-200 ring-offset-1",
      status === "success" && "ring-1 ring-green-200",
      status === "failed"  && "ring-1 ring-red-200"
    )} style={{ boxShadow: isLive ? "none" : "0 1px 2px rgba(0,0,0,0.04)" }}>

      {/* Node type icon */}
      <div className={cn("w-5 h-5 rounded-md flex items-center justify-center mb-1.5 flex-shrink-0", cfg.bg)}>
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Label */}
      <p className="text-[11px] font-semibold text-zinc-900 leading-tight line-clamp-2">{node.label}</p>

      {/* Agent model hint */}
      {agent && (
        <p className="text-[9px] text-zinc-400 mt-0.5 truncate w-full">{agent.model_name?.split("-")[0] ?? ""}</p>
      )}

      {/* Status badge during execution */}
      {isLive && (
        <div className={cn("absolute -top-2 -right-2 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border", stCfg.bg, stCfg.color, stCfg.border)}>
          {status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
          {status === "success" && <Check className="h-2.5 w-2.5" />}
          {status === "failed"  && <X className="h-2.5 w-2.5" />}
          {stCfg.label}
        </div>
      )}
    </div>
  )
}

// ─── AI Edit Panel ────────────────────────────────────────────────────────────

function AIEditPanel({ nodes, agentMap, pipelineId, onApply }: {
  nodes: DAGNode[]
  agentMap: Record<string, Agent>
  pipelineId: string
  onApply: (newNodes: DAGNode[]) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [input,   setInput]   = useState("")
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<any>(null)

  const submit = async () => {
    if (!input.trim()) { toast.error("Describe the change you want"); return }
    setLoading(true); setResult(null)
    try {
      const context = nodes.map(n => `${n.label} (${n.node_type ?? "linear"})`).join(" → ")
      const res = await fetch("/api/composer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: `Modify this pipeline: "${context}". Change: ${input.trim()}`,
          currentNodes: nodes,
        }),
      })
      const data = await res.json()
      setResult(data)
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-gradient-to-r from-primary/[0.04] to-transparent border border-primary/20 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/[0.02] transition-colors">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-zinc-900">AI Edit Assistant</p>
          <p className="text-[11px] text-zinc-400">Describe a change in plain English</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-primary/10">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={2}
            placeholder='e.g. "Add a sentiment analysis step after the classifier" or "Make the first two steps run in parallel"'
            className="mt-3 rounded-xl border-primary/20 bg-white/70 text-sm resize-none focus:ring-primary/20"
          />
          <Button onClick={submit} disabled={loading || !input.trim()}
            className="w-full rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-2 h-9">
            {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…</> : <><Sparkles className="h-3.5 w-3.5" /> Apply Change</>}
          </Button>

          {result?.ok && result?.dag && (
            <div className="bg-white border border-green-100 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-green-700 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> AI suggests {result.dag.nodes.length}-step pipeline
              </p>
              <p className="text-[11px] text-zinc-600 leading-relaxed">{result.reasoning}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {result.dag.nodes.map((n: any, i: number) => (
                  <span key={i} className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{n.label}</span>
                ))}
              </div>
              <Button size="sm" onClick={() => { onApply(result.dag.nodes); setResult(null); setInput(""); toast.success("Pipeline updated!") }}
                className="w-full rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 h-8 text-xs font-semibold">
                Apply This Design →
              </Button>
            </div>
          )}

          {result && !result.ok && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {result.error ?? "Composer failed. Try being more specific."}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Subcomponents (schema mismatch, condition builder, etc.) ─────────────────

function ConditionBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"preset"|"advanced">(value ? "advanced" : "preset")
  const [pidx, setPidx] = useState(0)
  const [pval, setPval] = useState("")
  const apply = (i: number, v: string) => onChange(BRANCH_PRESETS[i]!.expr(v))

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 w-fit">
        {(["preset","advanced"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={cn("px-3 py-1 rounded-md text-xs font-medium transition-all", mode===m ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500")}>
            {m === "preset" ? "Presets" : "Advanced"}
          </button>
        ))}
      </div>
      {mode === "preset" ? (
        <div className="space-y-2">
          <select value={pidx} onChange={e => { const i = +e.target.value; setPidx(i); setPval(""); apply(i, "") }}
            className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white focus:outline-none focus:border-amber-300">
            {BRANCH_PRESETS.map((p,i) => <option key={i} value={i}>{p.label}</option>)}
          </select>
          {BRANCH_PRESETS[pidx]?.hasVal && (
            <input value={pval} onChange={e => { setPval(e.target.value); apply(pidx, e.target.value) }}
              placeholder={BRANCH_PRESETS[pidx]?.placeholder ?? "value"}
              className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white font-mono focus:outline-none focus:border-amber-300 transition-all" />
          )}
          {value && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <p className="text-[10px] text-amber-600 font-semibold mb-0.5">Expression</p>
              <code className="text-[11px] text-amber-800 font-mono">{value}</code>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <input value={value} onChange={e => onChange(e.target.value)}
            placeholder="output.sentiment === 'negative'"
            className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-mono focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-50 transition-all" />
          <p className="text-[10px] text-zinc-400">
            Use <code className="bg-zinc-100 px-1 rounded text-[9px]">output</code> to access upstream results.
          </p>
        </div>
      )}
    </div>
  )
}

function SchemaMismatch({ warnings }: { warnings: string[] }) {
  const [open, setOpen] = useState(false)
  if (!warnings.length) return null
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full hover:bg-amber-100 transition-colors">
        <AlertTriangle className="h-3 w-3" /> Type mismatch
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 bg-white border border-amber-100 rounded-xl shadow-lg p-3 w-72 space-y-1.5">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Schema warnings</p>
            {warnings.map((w,i) => <p key={i} className="text-[11px] text-zinc-600 flex items-start gap-1.5"><span className="text-amber-400 flex-shrink-0">•</span>{w}</p>)}
            <p className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-100">Enable strict mode in settings to fail on mismatch.</p>
          </div>
        </>
      )}
    </div>
  )
}

function NodeCostBadge({ agent }: { agent?: Agent }) {
  if (!agent) return null
  if (agent.pricing_model === "free") return (
    <span className="text-[10px] text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full font-medium">Free</span>
  )
  const est = estimateCost({ inputText: "average input", systemPrompt: agent.system_prompt ?? "", model: agent.model_name ?? "claude-sonnet-4-20250514", maxTokens: agent.max_tokens ?? 4096 })
  return (
    <span className="text-[10px] text-zinc-400 bg-zinc-50 border border-zinc-100 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
      <DollarSign className="h-2.5 w-2.5" /> ~{formatCostForDisplay(est.userCostUsd)}
    </span>
  )
}

function SubagentPipelineSelector({ value, onChange, currentPipelineId }: { value: string; onChange: (id: string, name: string) => void; currentPipelineId: string }) {
  const [pipelines, setPipelines] = useState<Array<{id:string;name:string}>>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch("/api/pipelines?limit=50").then(r => r.json())
      .then(d => setPipelines((d.data ?? []).filter((p: any) => p.id !== currentPipelineId)))
      .catch(() => {}).finally(() => setLoading(false))
  }, [currentPipelineId])
  if (loading) return <div className="h-9 bg-zinc-50 rounded-xl animate-pulse" />
  if (!pipelines.length) return (
    <div className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2">
      No other pipelines. <Link href="/pipelines" className="text-primary hover:underline">Create one →</Link>
    </div>
  )
  return (
    <select value={value} onChange={e => { const p = pipelines.find(x => x.id === e.target.value); if (p) onChange(p.id, p.name) }}
      className="w-full h-9 px-3 rounded-xl border border-zinc-200 text-xs bg-white focus:outline-none focus:border-violet-300 transition-all">
      <option value="">— Select a pipeline —</option>
      {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

// ─── ShareModal ────────────────────────────────────────────────────────────────

function ShareModal({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const [shareKey, setShareKey] = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [copied,   setCopied]   = useState(false)
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://agentdyne.com"

  const generate = async () => {
    setLoading(true)
    try {
      const buf = new Uint8Array(8); crypto.getRandomValues(buf)
      const key = Array.from(buf).map(b => b.toString(36)).join("").slice(0, 10)
      const res = await fetch("/api/share-keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_id: pipeline.id, share_key: key, allow_execute: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setShareKey(data.share_key ?? key)
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 1500); toast.success("Copied!")
  }

  const shareUrl = shareKey ? `${baseUrl}/api/run/${shareKey}` : null
  const curlCmd  = shareKey ? `curl -X POST ${baseUrl}/api/run/${shareKey} \\\n  -H "Content-Type: application/json" \\\n  -d '{"input": "Your input here"}'` : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg z-10 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center">
              <Share2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">Deploy as API</p>
              <p className="text-xs text-zinc-400">One HTTP endpoint for this entire pipeline</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!shareKey ? (
            <>
              <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-zinc-700">What this creates</p>
                {["A unique URL for this pipeline", "Accept POST requests with JSON input", "Rate limited (100 runs/day by default)", "Costs deducted from your account"].map(i => (
                  <div key={i} className="flex items-start gap-2 text-xs text-zinc-600">
                    <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />{i}
                  </div>
                ))}
              </div>
              <Button onClick={generate} disabled={loading} className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Share2 className="h-4 w-4" /> Generate Endpoint</>}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">POST Endpoint</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 font-mono text-xs text-zinc-700 truncate">{shareUrl}</div>
                  <button onClick={() => copy(shareUrl!)} className="flex-shrink-0 p-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-zinc-400" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Example</label>
                <div className="relative">
                  <pre className="bg-zinc-900 text-zinc-200 rounded-xl px-4 py-3 text-[11px] font-mono whitespace-pre overflow-x-auto">{curlCmd}</pre>
                  <button onClick={() => copy(curlCmd!)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600">
                    {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-zinc-400" />}
                  </button>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 text-xs text-amber-700 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                All runs via this URL are billed to your account.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Explain Failure ──────────────────────────────────────────────────────────

function ExplainFailure({ executionId, pipelineId }: { executionId: string; pipelineId: string }) {
  const [loading, setLoading] = useState(false)
  const [data,    setData]    = useState<any>(null)

  const explain = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pipelines/${pipelineId}/explain`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? "Failed")
      setData(d)
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  if (data) return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> AI Analysis</p>
      {data.summary   && <p className="text-xs text-zinc-700"><strong>Summary:</strong> {data.summary}</p>}
      {data.rootCause && <p className="text-xs text-zinc-700"><strong>Root cause:</strong> {data.rootCause}</p>}
      {data.fix       && <p className="text-xs text-zinc-700"><strong>Fix:</strong> {data.fix}</p>}
      {data.suggestion && <p className="text-xs text-zinc-700"><strong>Alternative:</strong> {data.suggestion}</p>}
      <div className="flex items-center gap-2 pt-1">
        <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full",
          data.severity === "critical" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
          {data.severity}
        </span>
        {data.retryable && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Retryable</span>}
      </div>
    </div>
  )

  return (
    <button onClick={explain} disabled={loading}
      className="flex items-center gap-2 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-100 hover:bg-amber-100 px-3 py-2 rounded-xl transition-colors w-full justify-center">
      {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing…</> : <><Lightbulb className="h-3.5 w-3.5" /> Explain this failure</>}
    </button>
  )
}

// ─── Execution Timeline ────────────────────────────────────────────────────────

function ExecutionTimeline({ runs, pipelineId, onReplay }: {
  runs: ExecutionRun[]; pipelineId: string; onReplay: (run: ExecutionRun) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [nodeOpen, setNodeOpen] = useState<Record<string, boolean>>({})

  if (!runs.length) return (
    <div className="text-center py-8 text-zinc-400 text-sm">
      <History className="h-6 w-6 mx-auto mb-2 text-zinc-300" />No executions yet.
    </div>
  )

  return (
    <div className="space-y-2">
      {runs.map(run => (
        <div key={run.id} className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <button onClick={() => setExpanded(e => e === run.id ? null : run.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors">
            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
              run.status === "success" ? "bg-green-100 text-green-600" : run.status === "failed" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600")}>
              {run.status === "success" ? <Check className="h-3 w-3" /> : run.status === "failed" ? <X className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  run.status === "success" ? "bg-green-50 text-green-600" : run.status === "failed" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600")}>
                  {run.status}
                </span>
                <span className="text-xs text-zinc-500 font-mono">{run.id.slice(0, 8)}…</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-0.5">
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{run.total_latency_ms}ms</span>
                <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />${Number(run.total_cost ?? 0).toFixed(6)}</span>
                <span>{new Date(run.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
            <button onClick={e => { e.stopPropagation(); onReplay(run) }}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-primary hover:bg-primary/8 px-2 py-1 rounded-lg transition-colors flex-shrink-0">
              <RefreshCw className="h-3.5 w-3.5" /> Replay
            </button>
            {expanded === run.id ? <ChevronUp className="h-4 w-4 text-zinc-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-zinc-400 flex-shrink-0" />}
          </button>

          {expanded === run.id && (
            <div className="border-t border-zinc-50 px-4 py-3 space-y-2.5 bg-zinc-50/40">
              {run.error_message && (
                <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />{run.error_message}
                </div>
              )}
              {run.status === "failed" && <ExplainFailure executionId={run.id} pipelineId={pipelineId} />}

              {run.node_results?.map((nr, i) => {
                const key = `${run.id}-${i}`
                return (
                  <div key={i} className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors"
                      onClick={() => setNodeOpen(prev => ({ ...prev, [key]: !prev[key] }))}>
                      <div className={cn("w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold",
                        nr.status === "success" ? "bg-green-100 text-green-600" : nr.status === "failed" ? "bg-red-100 text-red-600" : "bg-zinc-100 text-zinc-400")}>
                        {nr.status === "success" ? "✓" : nr.status === "failed" ? "✕" : "—"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-800 truncate">{nr.agent_name}</p>
                        {nr.error && <p className="text-[11px] text-red-500 truncate">{nr.error}</p>}
                        {(nr.retry_count ?? 0) > 0 && <p className="text-[11px] text-zinc-400">{nr.retry_count} retries</p>}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-400 flex-shrink-0">
                        <span>{nr.latency_ms}ms</span>
                        <span>${Number(nr.cost ?? 0).toFixed(6)}</span>
                        {nr.tokens && <span>{nr.tokens.input + nr.tokens.output}t</span>}
                        <ChevronsUpDown className="h-3 w-3 text-zinc-300" />
                      </div>
                    </button>
                    {nodeOpen[key] && (
                      <div className="border-t border-zinc-50 px-3 py-3 space-y-2.5 bg-zinc-50/60">
                        {nr.input !== null && nr.input !== undefined && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1"><Eye className="h-3 w-3" /> Input received</p>
                            <div className="bg-white border border-zinc-100 rounded-lg px-2.5 py-2 font-mono text-[11px] text-zinc-600 max-h-[100px] overflow-auto whitespace-pre-wrap">
                              {typeof nr.input === "string" ? nr.input : JSON.stringify(nr.input, null, 2)}
                            </div>
                          </div>
                        )}
                        {nr.output !== null && nr.output !== undefined && (
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1"><EyeOff className="h-3 w-3" /> Output sent</p>
                            <div className="bg-white border border-zinc-100 rounded-lg px-2.5 py-2 font-mono text-[11px] text-zinc-700 max-h-[100px] overflow-auto whitespace-pre-wrap">
                              {typeof nr.output === "string" ? nr.output : JSON.stringify(nr.output, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {run.output !== null && run.output !== undefined && (
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

// ─── Agent Picker ──────────────────────────────────────────────────────────────

function AgentPicker({ onAdd, existingIds }: { onAdd: (a: Agent) => void; existingIds: string[] }) {
  const [q, setQ]       = useState("")
  const [agents, set]   = useState<Agent[]>([])
  const [loading, setL] = useState(false)

  const search = useCallback(async (query: string) => {
    setL(true)
    try {
      const params = new URLSearchParams({ status: "active", limit: "20", sort: "popular", ...(query.trim() ? { q: query.trim() } : {}) })
      const res = await fetch(`/api/agents?${params}`)
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
            ? <div className="text-center py-8 text-zinc-400 text-sm">No active agents.<br /><Link href="/builder" className="text-primary hover:underline text-xs mt-1 block">Create one →</Link></div>
            : agents.map(agent => {
                const added = existingIds.includes(agent.id)
                return (
                  <div key={agent.id} onClick={() => !added && onAdd(agent)}
                    className={cn("flex items-center gap-3 p-3 rounded-xl border transition-all",
                      added ? "border-zinc-100 bg-zinc-50 opacity-50 cursor-default"
                            : "border-zinc-100 bg-white hover:border-primary/30 hover:bg-primary/[0.02] cursor-pointer group")}>
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

// ─── NodeCard ─────────────────────────────────────────────────────────────────

function NodeCard({ node, index, total, agent, nextAgent, isParallelSelected, onParallelSelect, onChange, onRemove, onMoveUp, onMoveDown, onTestNode, currentPipelineId, executionStatus }: {
  node: DAGNode; index: number; total: number
  agent?: Agent; nextAgent?: Agent
  isParallelSelected: boolean; onParallelSelect: () => void
  onChange: (p: Partial<DAGNode>) => void
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void
  onTestNode: () => void; currentPipelineId: string
  executionStatus?: NodeStatus
}) {
  const [exp,    setExp]    = useState(false)
  const [resExp, setResExp] = useState(false)
  const cfg = NODE_TYPE_CONFIG[node.node_type ?? "linear"]
  const schemaCheck = agent && nextAgent ? schemaCompatible(agent.output_schema, nextAgent.input_schema) : { compatible: true, warnings: [] as string[] }
  const hasResilience = (node.max_retries ?? 0) > 0 || !!node.fallback_agent_id
  const stCfg = executionStatus ? NODE_STATUS_CONFIG[executionStatus] : null

  return (
    <div className={cn("bg-white border rounded-2xl overflow-hidden shadow-sm transition-all",
      isParallelSelected ? "border-blue-300 ring-2 ring-blue-100" : stCfg ? `${stCfg.border}` : "border-zinc-100",
      executionStatus === "running" && "ring-2 ring-blue-200")}>

      {/* Live execution status bar */}
      {executionStatus && executionStatus !== "idle" && (
        <div className={cn("h-1 w-full transition-all", {
          "bg-blue-400 animate-pulse": executionStatus === "running",
          "bg-green-400": executionStatus === "success",
          "bg-red-400": executionStatus === "failed",
          "bg-zinc-200": executionStatus === "skipped",
        })} />
      )}

      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onParallelSelect} title="Select for parallel grouping"
          className={cn("w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all",
            isParallelSelected ? "border-blue-400 bg-blue-400 text-white" : "border-zinc-200 hover:border-blue-300")}>
          {isParallelSelected && <Check className="h-3 w-3" />}
        </button>
        <div className={cn("w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0", cfg.bg, cfg.color)}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <input value={node.label} onChange={e => onChange({ label: e.target.value })}
            className="w-full text-sm font-semibold text-zinc-900 bg-transparent border-none outline-none focus:bg-zinc-50 focus:px-1 rounded transition-all truncate" />
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
              {cfg.icon} {cfg.friendlyLabel}
            </span>
            {node.parallel_group && <span className="text-[10px] text-blue-500 font-medium bg-blue-50 px-1.5 py-0.5 rounded-full">∥ group</span>}
            {node.condition && <span className="text-[10px] text-amber-600 font-medium">if: {node.condition.slice(0,20)}…</span>}
            {node.output_field && <span className="text-[10px] text-zinc-400 font-mono bg-zinc-50 border border-zinc-100 px-1.5 py-0.5 rounded-full">.{node.output_field}</span>}
            <NodeCostBadge agent={agent} />
            {hasResilience && <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1"><RefreshCw className="h-2.5 w-2.5" /> {node.max_retries}×</span>}
            {!schemaCheck.compatible && index < total - 1 && <SchemaMismatch warnings={schemaCheck.warnings} />}
            {/* Live status badge */}
            {executionStatus && executionStatus !== "idle" && stCfg && (
              <span className={cn("flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full", stCfg.bg, stCfg.color)}>
                {executionStatus === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {executionStatus === "success" && <Check className="h-2.5 w-2.5" />}
                {executionStatus === "failed"  && <X className="h-2.5 w-2.5" />}
                {stCfg.label}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onTestNode} title="Test this node" className="p-1.5 rounded-lg text-zinc-400 hover:text-primary hover:bg-primary/8 transition-colors"><FlaskConical className="h-3.5 w-3.5" /></button>
          <button onClick={onMoveUp}   disabled={index === 0}         className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20"><ChevronUp   className="h-3.5 w-3.5" /></button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded-lg text-zinc-300 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button onClick={() => setExp(e => !e)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><Settings2 className="h-3.5 w-3.5" /></button>
          <button onClick={onRemove} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {exp && (
        <div className="border-t border-zinc-50 px-4 py-4 bg-zinc-50/60 space-y-4">
          {/* Pattern selector */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Step behaviour</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.entries(NODE_TYPE_CONFIG) as [NodeType, typeof NODE_TYPE_CONFIG[NodeType]][]).map(([type, c]) => (
                <button key={type} onClick={() => onChange({ node_type: type, condition: type !== "branch" ? undefined : node.condition, parallel_group: type !== "parallel" ? undefined : node.parallel_group })}
                  className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all text-xs",
                    (node.node_type ?? "linear") === type ? `${c.bg} ${c.color} border-current/20 font-semibold` : "bg-white border-zinc-100 text-zinc-500 hover:border-zinc-200")}>
                  {c.icon}
                  <div>
                    <p className="font-semibold">{c.friendlyLabel}</p>
                    <p className="text-[10px] opacity-70">{c.desc}</p>
                  </div>
                  {(node.node_type ?? "linear") === type && <CheckCircle2 className="h-3.5 w-3.5 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {node.node_type === "branch" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><GitBranch className="h-3 w-3 text-amber-500" /> Run if…</label>
              <ConditionBuilder value={node.condition ?? ""} onChange={v => onChange({ condition: v })} />
            </div>
          )}

          {node.node_type === "parallel" && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
              <p className="text-[11px] font-semibold text-blue-700 flex items-center gap-1.5"><Zap className="h-3 w-3" /> Group: {node.parallel_group ?? "not set"}</p>
              <p className="text-[11px] text-blue-600 mt-0.5">Select multiple nodes with checkboxes, then click "Group Parallel".</p>
            </div>
          )}

          {node.node_type === "subagent" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><Cpu className="h-3 w-3 text-violet-500" /> Nested pipeline</label>
              <SubagentPipelineSelector value={node.sub_pipeline_id ?? ""} currentPipelineId={currentPipelineId}
                onChange={(id, name) => onChange({ sub_pipeline_id: id, label: node.label || name })} />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Extract field from output (optional)</label>
            <input value={node.output_field ?? ""} onChange={e => onChange({ output_field: e.target.value })}
              placeholder={`e.g. "result", "text", "items[0].title"`}
              className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-mono focus:outline-none focus:border-zinc-300 transition-all" />
            <p className="text-[10px] text-zinc-400">Extract a specific field to pass downstream instead of the full output.</p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => onChange({ continue_on_failure: !node.continue_on_failure })}
              className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", node.continue_on_failure ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", node.continue_on_failure ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-700">Continue if this step fails</p>
              <p className="text-[11px] text-zinc-400">Pass null to the next step instead of stopping the pipeline.</p>
            </div>
          </label>

          {/* Resilience settings */}
          <div className="border-t border-zinc-100 pt-3">
            <button onClick={() => setResExp(r => !r)} className="flex items-center gap-2 w-full text-left mb-2 group">
              <RefreshCw className="h-3.5 w-3.5 text-zinc-400 group-hover:text-primary transition-colors" />
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider group-hover:text-primary transition-colors flex-1">
                Retry settings {hasResilience && <span className="text-blue-500 ml-1">(active)</span>}
              </p>
              {resExp ? <ChevronUp className="h-3 w-3 text-zinc-400" /> : <ChevronDown className="h-3 w-3 text-zinc-400" />}
            </button>
            {resExp && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-600">Max retries (0–3)</label>
                    <input type="number" min={0} max={3} value={node.max_retries ?? 0}
                      onChange={e => onChange({ max_retries: Math.min(3, Math.max(0, parseInt(e.target.value) || 0)) })}
                      className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs focus:outline-none focus:border-zinc-300 transition-all" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-zinc-600">Retry delay (ms)</label>
                    <input type="number" min={100} max={5000} step={100} value={node.retry_delay_ms ?? 500}
                      onChange={e => onChange({ retry_delay_ms: Math.min(5000, Math.max(100, parseInt(e.target.value) || 500)) })}
                      className="w-full h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs focus:outline-none focus:border-zinc-300 transition-all" />
                  </div>
                </div>
                {(node.max_retries ?? 0) > 0 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-[11px] text-blue-700">
                    Max delay: ~{((node.retry_delay_ms ?? 500) * (Math.pow(2, node.max_retries ?? 0) - 1) / 1000).toFixed(1)}s (exponential backoff)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connector arrow + data flow hint */}
      {index < total - 1 && (
        <div className="flex items-center justify-center py-1.5 bg-zinc-50 gap-1.5">
          {!schemaCheck.compatible
            ? <span className="flex items-center gap-1 text-[10px] text-amber-500"><AlertTriangle className="h-3 w-3" /> type mismatch — may fail</span>
            : node.output_field
              ? <span className="flex items-center gap-1 text-[10px] text-zinc-400 font-mono">↓ .{node.output_field}</span>
              : <ChevronRight className="h-4 w-4 text-zinc-300 rotate-90" />}
        </div>
      )}
    </div>
  )
}

// ─── Test Panels ──────────────────────────────────────────────────────────────

function SingleNodeTestPanel({ agent }: { agent: Agent }) {
  const [input, setInput]   = useState("")
  const [output, setOutput] = useState("")
  const [running, setR]     = useState(false)
  const run = async () => {
    if (!input.trim()) { toast.error("Enter input"); return }
    setR(true); setOutput("")
    try {
      const res  = await fetch(`/api/agents/${agent.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setOutput(typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2))
      toast.success(`Done in ${data.latencyMs}ms`)
    } catch (err: any) { toast.error(err.message); setOutput(`Error: ${err.message}`) }
    finally { setR(false) }
  }
  return (
    <div className="space-y-3">
      <Textarea value={input} onChange={e => setInput(e.target.value)} rows={4} placeholder="Enter test input…" className="rounded-xl border-zinc-200 text-sm resize-none" />
      <Button onClick={run} disabled={running} className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2 font-semibold">
        {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run Step</>}
      </Button>
      {output && <div className="min-h-[60px] max-h-[200px] overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 font-mono text-xs p-3 whitespace-pre-wrap text-zinc-700">{output}</div>}
    </div>
  )
}

function FullPipelineTestPanel({ pipelineId, defaultInput, onNewRun, onNodeStatusChange }: {
  pipelineId: string; defaultInput?: string
  onNewRun: (r: ExecutionRun) => void
  onNodeStatusChange?: (statuses: Record<string, NodeStatus>) => void
}) {
  const [input, setInput]   = useState(defaultInput ?? '{"input": "Hello, run this pipeline."}')
  const [running, setR]     = useState(false)
  const [result, setResult] = useState<ExecutionRun | null>(null)

  const run = async () => {
    setR(true); setResult(null)
    // Clear node statuses
    onNodeStatusChange?.({})
    try {
      let inp: unknown; try { inp = JSON.parse(input) } catch { inp = input }
      const res  = await fetch(`/api/pipelines/${pipelineId}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: inp }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      // Update node statuses from results
      if (data.node_results && onNodeStatusChange) {
        const statuses: Record<string, NodeStatus> = {}
        for (const nr of data.node_results as ExecutionNodeResult[]) {
          statuses[nr.node_id] = nr.status as NodeStatus
        }
        onNodeStatusChange(statuses)
      }

      const run: ExecutionRun = {
        id:               data.executionId,
        status:           data.status,
        created_at:       new Date().toISOString(),
        total_latency_ms: data.summary?.total_latency_ms ?? 0,
        total_cost:       parseFloat(data.summary?.total_cost_usd ?? "0"),
        node_results:     data.node_results,
        output:           data.output,
      }
      setResult(run); onNewRun(run)
      toast.success(`Done in ${run.total_latency_ms}ms`)
    } catch (err: any) {
      toast.error(err.message)
      setResult({ id: "err", status: "failed", created_at: new Date().toISOString(), total_latency_ms: 0, total_cost: 0, error_message: err.message })
      onNodeStatusChange?.({})
    } finally { setR(false) }
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
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Execution trace</p>
          <ExecutionTimeline runs={[result]} pipelineId={pipelineId} onReplay={() => {}} />
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PipelineEditPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const [pipeline,         setPipeline]        = useState<Pipeline | null>(null)
  const [nodes,            setNodes]            = useState<DAGNode[]>([])
  const [agentMap,         setAgentMap]         = useState<Record<string, Agent>>({})
  const [loading,          setLoading]          = useState(true)
  const [saving,           setSaving]           = useState(false)
  const [error,            setError]            = useState("")
  const [activeTab,        setActiveTab]        = useState<"builder"|"test"|"history">("builder")
  const [name,             setName]             = useState("")
  const [description,      setDesc]             = useState("")
  const [isPublic,         setIsPublic]         = useState(false)
  const [timeout,          setTimeoutVal]       = useState(300)
  const [strictMode,       setStrictMode]       = useState(false)
  const [parallelSelected, setParallelSelected] = useState<Set<string>>(new Set())
  const [testingNode,      setTestingNode]      = useState<Agent | null>(null)
  const [runs,             setRuns]             = useState<ExecutionRun[]>([])
  const [runsLoading,      setRunsLoading]      = useState(false)
  const [replayInput,      setReplayInput]      = useState<string | null>(null)
  const [showShare,        setShowShare]        = useState(false)
  // Live execution status: maps nodeId → status
  const [nodeStatuses,     setNodeStatuses]     = useState<Record<string, NodeStatus>>({})

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
        setIsPublic(p.is_public); setTimeoutVal(p.timeout_seconds ?? 300)
        setStrictMode(p.dag?.strict_schema_mode ?? false)
        const dagNodes = p.dag?.nodes ?? []
        setNodes(dagNodes)
        const agentIds = [...new Set(dagNodes.map(n => n.agent_id).filter(Boolean))]
        if (agentIds.length > 0) {
          const { data: agents } = await supabase
            .from("agents").select("id, name, description, model_name, pricing_model, price_per_call, status, input_schema, output_schema, system_prompt, max_tokens").in("id", agentIds)
          if (!cancelled) {
            const map: Record<string, Agent> = {}
            for (const a of agents ?? []) map[a.id] = a as Agent
            setAgentMap(map)
          }
        }
      } catch (err: any) { if (!cancelled) setError(err.message) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [id])

  useEffect(() => {
    if (activeTab !== "history" || !id) return
    setRunsLoading(true)
    supabase.from("pipeline_executions")
      .select("id, status, created_at, total_latency_ms, total_cost, error_message, node_results, output, input")
      .eq("pipeline_id", id).order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => setRuns((data ?? []) as ExecutionRun[]))
      .finally(() => setRunsLoading(false))
  }, [activeTab, id])

  const addAgent = (agent: Agent) => {
    setNodes(prev => [...prev, { id: `node_${Date.now()}`, agent_id: agent.id, label: agent.name, node_type: "linear", continue_on_failure: false }])
    setAgentMap(prev => ({ ...prev, [agent.id]: agent }))
  }

  const removeNode  = (i: number) => setNodes(prev => prev.filter((_, j) => j !== i))
  const moveNode    = (i: number, d: -1|1) => setNodes(prev => {
    const a = [...prev]; const j = i + d
    if (j < 0 || j >= a.length) return prev
    ;[a[i], a[j]] = [a[j]!, a[i]!]; return a
  })
  const patchNode   = (i: number, patch: Partial<DAGNode>) => setNodes(prev => prev.map((n, j) => j === i ? { ...n, ...patch } : n))

  const toggleParallelSelect = (nodeId: string) =>
    setParallelSelected(prev => { const s = new Set(prev); s.has(nodeId) ? s.delete(nodeId) : s.add(nodeId); return s })

  const groupAsParallel = () => {
    if (parallelSelected.size < 2) { toast.error("Select ≥2 nodes"); return }
    const groupId = `grp_${Date.now().toString(36)}`
    setNodes(prev => prev.map(n => parallelSelected.has(n.id) ? { ...n, node_type: "parallel" as NodeType, parallel_group: groupId } : n))
    setParallelSelected(new Set())
    toast.success(`${parallelSelected.size} nodes will run in parallel`)
  }

  const save = async () => {
    if (!pipeline) return
    if (nodes.length === 0) { toast.error("Add at least one agent"); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ name: name.trim() || pipeline.name, description: description.trim() || null, is_public: isPublic, timeout_seconds: timeout, dag: { nodes, edges: buildEdges(nodes), strict_schema_mode: strictMode } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      toast.success("Pipeline saved!"); setPipeline(data)
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const handleReplay = (run: ExecutionRun) => {
    const inputStr = run.input ? (typeof (run.input as any).value === "string" ? (run.input as any).value : JSON.stringify(run.input)) : ""
    setReplayInput(inputStr || null); setActiveTab("test")
    toast.success("Input loaded from run — switch to Test tab")
  }

  const totalCost = nodes.reduce((sum, n) => {
    const a = agentMap[n.agent_id]
    if (!a || a.pricing_model === "free") return sum
    return sum + estimateCost({ inputText: "average", systemPrompt: a.system_prompt ?? "", model: a.model_name ?? "claude-sonnet-4-20250514", maxTokens: a.max_tokens ?? 4096 }).userCostUsd
  }, 0)

  const patternLabel =
    nodes.some(n => n.node_type === "parallel") && nodes.some(n => n.node_type === "branch") ? "mixed" :
    nodes.some(n => n.node_type === "parallel") ? "parallel" :
    nodes.some(n => n.node_type === "branch")   ? "branch" :
    nodes.some(n => n.node_type === "subagent")  ? "subagent" : "linear"

  const schemaIssueCount = nodes.reduce((count, node, i) => {
    if (i === nodes.length - 1) return count
    const agent     = agentMap[node.agent_id]
    const nextAgent = agentMap[nodes[i + 1]!.agent_id]
    const check = schemaCompatible(agent?.output_schema, nextAgent?.input_schema)
    return check.compatible ? count : count + 1
  }, 0)

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
        <Link href="/pipelines"><Button variant="outline" className="rounded-xl mt-3">← Back to Pipelines</Button></Link>
      </div>
    </div>
  )

  return (
    <>
      {/* Single-node test modal */}
      {testingNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setTestingNode(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg z-10 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Test: {testingNode.name}</p>
              <button onClick={() => setTestingNode(null)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5"><SingleNodeTestPanel agent={testingNode} /></div>
          </div>
        </div>
      )}

      {showShare && pipeline && <ShareModal pipeline={pipeline} onClose={() => setShowShare(false)} />}

      <div className="flex flex-col min-h-full">

        {/* Top bar */}
        <div className="bg-white border-b border-zinc-100 px-6 py-3 flex items-center justify-between -mx-6 -mt-8 mb-6 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <Link href="/pipelines"><Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                {pipeline.name}
                {/* Trust indicators */}
                {strictMode && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600"><ShieldAlert className="h-3 w-3" /> Schema enforced</span>}
                {nodes.some(n => (n.max_retries ?? 0) > 0) && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600"><RefreshCw className="h-3 w-3" /> Retry on</span>}
                {totalCost > 0 && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-50 text-zinc-500"><DollarSign className="h-3 w-3" /> ~{formatCostForDisplay(totalCost)}/run</span>}
                {schemaIssueCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> {schemaIssueCount} schema {schemaIssueCount === 1 ? "issue" : "issues"}
                  </span>
                )}
              </h1>
              <p className="text-xs text-zinc-400">{nodes.length} step{nodes.length !== 1 ? "s" : ""} · {patternLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {parallelSelected.size >= 2 && (
              <Button size="sm" onClick={groupAsParallel} className="rounded-xl bg-blue-600 text-white hover:bg-blue-700 gap-1.5 font-semibold">
                <Zap className="h-3.5 w-3.5" /> Group ({parallelSelected.size})
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowShare(true)} className="rounded-xl border-zinc-200 gap-1.5">
              <Share2 className="h-3.5 w-3.5" /> Deploy API
            </Button>
            <Button size="sm" onClick={save} disabled={saving} className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-1.5 font-semibold">
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5" /> Save</>}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white border border-zinc-100 rounded-xl p-1 w-fit shadow-xs mb-5">
          {(["builder","test","history"] as const).map(k => (
            <button key={k} onClick={() => setActiveTab(k)}
              className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5",
                activeTab === k ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900")}>
              {k === "builder" ? <><Workflow className="h-3.5 w-3.5" /> Builder</> : k === "test" ? <><Play className="h-3.5 w-3.5" /> Test</> : <><History className="h-3.5 w-3.5" /> History</>}
              {k === "history" && runs.length > 0 && (
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", activeTab === k ? "bg-white/20" : "bg-zinc-100 text-zinc-500")}>{runs.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── BUILDER TAB ─────────────────────────────────────────────────────── */}
        {activeTab === "builder" && (
          <div className="space-y-4">

            {/* Visual DAG diagram — only shown when nodes exist */}
            {nodes.length > 0 && (
              <DAGVisual nodes={nodes} agentMap={agentMap} nodeStatuses={nodeStatuses} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-3 space-y-4">

                {/* Pipeline settings */}
                <div className="bg-white border border-zinc-100 rounded-2xl p-4 space-y-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pipeline settings</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><label className="text-xs font-medium text-zinc-600">Name</label><Input value={name} onChange={e => setName(e.target.value)} className="h-9 rounded-xl border-zinc-200 text-sm bg-white" /></div>
                    <div className="space-y-1"><label className="text-xs font-medium text-zinc-600">Timeout (s)</label><Input type="number" value={timeout} onChange={e => setTimeoutVal(parseInt(e.target.value) || 300)} min={30} max={1800} className="h-9 rounded-xl border-zinc-200 text-sm bg-white" /></div>
                  </div>
                  <div className="space-y-1"><label className="text-xs font-medium text-zinc-600">What does this pipeline do?</label><Input value={description} onChange={e => setDesc(e.target.value)} placeholder="e.g. Classify support tickets then draft replies" className="h-9 rounded-xl border-zinc-200 text-sm bg-white" /></div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div onClick={() => setIsPublic(v => !v)} className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", isPublic ? "bg-primary" : "bg-zinc-200")}>
                        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
                      </div>
                      <span className="text-xs font-medium text-zinc-600 flex items-center gap-1">{isPublic ? <><Globe className="h-3 w-3" /> Public</> : <><Lock className="h-3 w-3" /> Private</>}</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div onClick={() => setStrictMode(v => !v)} className={cn("w-8 h-4 rounded-full transition-colors relative flex-shrink-0", strictMode ? "bg-red-500" : "bg-zinc-200")}>
                        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform", strictMode ? "translate-x-4" : "translate-x-0.5")} />
                      </div>
                      <span className="text-xs font-medium text-zinc-600 flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-red-400" /> Strict schema</span>
                    </label>
                  </div>
                </div>

                {/* AI Edit Panel */}
                {nodes.length > 0 && (
                  <AIEditPanel
                    nodes={nodes}
                    agentMap={agentMap}
                    pipelineId={pipeline.id}
                    onApply={newNodes => {
                      setNodes(newNodes)
                      // Load agent info for any new nodes
                      const newIds = newNodes.map(n => n.agent_id).filter(id => !agentMap[id])
                      if (newIds.length > 0) {
                        supabase.from("agents").select("id, name, description, model_name, pricing_model, price_per_call, status").in("id", newIds)
                          .then(({ data }) => {
                            if (data) {
                              const map: Record<string, Agent> = { ...agentMap }
                              for (const a of data) map[a.id] = a as Agent
                              setAgentMap(map)
                            }
                          })
                      }
                    }}
                  />
                )}

                {parallelSelected.size === 1 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 text-xs text-blue-700 flex items-center gap-2">
                    <Zap className="h-3.5 w-3.5 flex-shrink-0" /> Select 1 more step to enable parallel grouping.
                  </div>
                )}

                {nodes.length === 0 ? (
                  <div className="text-center py-16 border-2 border-dashed border-zinc-100 rounded-2xl bg-white">
                    <Workflow className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-zinc-500 mb-1">No steps yet</p>
                    <p className="text-xs text-zinc-400 mb-4">Add agents from the panel, or use AI to compose your workflow.</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {nodes.map((node, i) => (
                      <NodeCard key={node.id} node={node} index={i} total={nodes.length}
                        agent={agentMap[node.agent_id]}
                        nextAgent={i < nodes.length - 1 ? agentMap[nodes[i+1]!.agent_id] : undefined}
                        isParallelSelected={parallelSelected.has(node.id)}
                        onParallelSelect={() => toggleParallelSelect(node.id)}
                        onChange={patch => patchNode(i, patch)}
                        onRemove={() => removeNode(i)}
                        onMoveUp={() => moveNode(i, -1)}
                        onMoveDown={() => moveNode(i, 1)}
                        onTestNode={() => { const a = agentMap[node.agent_id]; if (a) setTestingNode(a) }}
                        currentPipelineId={pipeline.id}
                        executionStatus={nodeStatuses[node.id]}
                      />
                    ))}
                  </div>
                )}

                {nodes.length > 0 && totalCost > 0 && (
                  <div className="bg-white border border-zinc-100 rounded-xl px-4 py-3 flex items-center justify-between">
                    <span className="text-xs text-zinc-500 flex items-center gap-2"><DollarSign className="h-3.5 w-3.5 text-zinc-400" /> Estimated cost per run</span>
                    <span className="text-sm font-bold text-zinc-900 font-mono">~{formatCostForDisplay(totalCost)}</span>
                  </div>
                )}
              </div>

              <div className="lg:col-span-2 bg-white border border-zinc-100 rounded-2xl overflow-hidden flex flex-col" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)", maxHeight: 700 }}>
                <AgentPicker onAdd={addAgent} existingIds={nodes.map(n => n.agent_id)} />
              </div>
            </div>
          </div>
        )}

        {/* ── TEST TAB ──────────────────────────────────────────────────────── */}
        {activeTab === "test" && (
          <div className="max-w-xl">
            <div className="bg-white border border-zinc-100 rounded-2xl p-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                  <Play className="h-4 w-4 text-primary" /> Test Pipeline
                  {replayInput && <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Replay input loaded</span>}
                </p>
                {/* Quick switch to see node statuses in builder */}
                {Object.keys(nodeStatuses).length > 0 && (
                  <button onClick={() => setActiveTab("builder")} className="text-[11px] text-primary hover:underline font-semibold flex items-center gap-1">
                    <Workflow className="h-3 w-3" /> View in builder
                  </button>
                )}
              </div>
              {nodes.length === 0
                ? <p className="text-center py-8 text-zinc-400 text-sm">Add and save agents first.</p>
                : <FullPipelineTestPanel
                    key={replayInput ?? "fresh"}
                    pipelineId={pipeline.id}
                    defaultInput={replayInput ?? undefined}
                    onNewRun={run => { setRuns(prev => [run, ...prev]); setReplayInput(null) }}
                    onNodeStatusChange={setNodeStatuses}
                  />}
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="max-w-2xl space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-900">Run History</p>
              <button onClick={() => {
                setRunsLoading(true)
                supabase.from("pipeline_executions").select("id, status, created_at, total_latency_ms, total_cost, error_message, node_results, output, input").eq("pipeline_id", id).order("created_at", { ascending: false }).limit(20)
                  .then(({ data }) => setRuns((data ?? []) as ExecutionRun[])).finally(() => setRunsLoading(false))
              }} className="text-xs text-primary hover:underline flex items-center gap-1">
                <RefreshCw className={cn("h-3 w-3", runsLoading && "animate-spin")} /> Refresh
              </button>
            </div>
            {runsLoading
              ? <div className="space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-14 bg-zinc-50 rounded-xl animate-pulse" />)}</div>
              : <ExecutionTimeline runs={runs} pipelineId={pipeline.id} onReplay={handleReplay} />}
          </div>
        )}
      </div>
    </>
  )
}
