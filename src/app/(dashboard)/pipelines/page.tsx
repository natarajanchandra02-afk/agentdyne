"use client"
export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Plus, Layers, Play, Globe, Lock, Clock,
  MoreHorizontal, Trash2, Copy, AlertCircle, Loader2,
  ChevronRight, ArrowRight, Zap, Bot, Sparkles, X,
  GitBranch, Cpu, CheckCircle2, BarChart3, TrendingUp,
  CheckCircle, Flame,
} from "lucide-react"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatDate, formatNumber } from "@/lib/utils"
import toast from "react-hot-toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Pipeline {
  id:              string
  name:            string
  description:     string | null
  is_public:       boolean
  timeout_seconds: number
  tags:            string[]
  dag:             { nodes: { agent_id: string; label?: string }[]; edges: any[] }
  created_at:      string
  updated_at:      string
  run_count?:      number
  success_count?:  number
  last_run_at?:    string | null
  status?:         "idle" | "running" | "success" | "failed"
}

type PatternType = "linear" | "parallel" | "branch" | "subagent" | "mixed"

interface ComposerResult {
  ok:          boolean
  dag?:        { nodes: any[]; edges: any[]; pattern: PatternType; description: string; estimatedCost: number }
  reasoning:   string
  patternUsed: PatternType
  confidence:  number
  error?:      string
}

interface Template {
  id: string; name: string; description: string; goal: string
  pattern: PatternType; emoji: string; category: string
  sampleInput: string
}

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    id:          "support-automation",
    name:        "Customer Support Auto-Responder",
    description: "Classify tickets by urgency and draft personalised replies automatically.",
    goal:        "Read a customer support ticket, classify it as low/medium/high urgency, draft a helpful reply based on the urgency level, and flag critical issues needing escalation.",
    pattern:     "branch",
    emoji:       "🎧",
    category:    "Customer Support",
    sampleInput: '{"input": "My order hasn\'t arrived after 2 weeks. I need it for an event this weekend."}',
  },
  {
    id:          "lead-enrichment",
    name:        "Lead Enrichment & Scoring",
    description: "Research a lead, score qualification, and write a personalised outreach message.",
    goal:        "Given a lead's name and company: research them, score qualification 1-10 with reasoning, write a personalised outreach message. Output structured JSON.",
    pattern:     "linear",
    emoji:       "🎯",
    category:    "Sales",
    sampleInput: '{"name": "Sarah Chen", "company": "Acme Corp", "role": "CTO"}',
  },
  {
    id:          "content-pipeline",
    name:        "Content Generation Suite",
    description: "Turn a topic into blog post, SEO keywords, and social captions — all in parallel.",
    goal:        "Given a topic: run in parallel — (A) write a 600-word SEO blog post, (B) extract 5 keywords, (C) write a 280-char social summary. Output a complete content package.",
    pattern:     "parallel",
    emoji:       "✍️",
    category:    "Marketing",
    sampleInput: '{"topic": "AI automation for small businesses", "audience": "SME founders"}',
  },
  {
    id:          "data-extraction",
    name:        "Document Data Extraction",
    description: "Extract structured data from any document, validate it, and output clean JSON.",
    goal:        "Given raw text: extract all key fields as structured JSON, validate required fields, flag missing or suspicious values. Output validated JSON + warnings list.",
    pattern:     "linear",
    emoji:       "📄",
    category:    "Data Analysis",
    sampleInput: "Invoice #INV-2026-1234\nDate: April 21 2026\nAmount: $4,500.00\nDue: May 21 2026\nClient: Acme Corp",
  },
]

// ─── Quick run modal ──────────────────────────────────────────────────────────

function QuickRunModal({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const router = useRouter()
  const [input,   setInput]   = useState('{"input": ""}')
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<{ output: any; latency: number; cost: number } | null>(null)

  const nodeCount = pipeline.dag?.nodes?.length ?? 0

  const run = async () => {
    setRunning(true); setResult(null)
    try {
      let parsed: unknown
      try { parsed = JSON.parse(input) } catch { parsed = input }
      const res  = await fetch(`/api/pipelines/${pipeline.id}/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ input: parsed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Execution failed")
      setResult({ output: data.output, latency: data.summary?.total_latency_ms ?? 0, cost: parseFloat(data.summary?.total_cost_usd ?? "0") })
      toast.success(`Done in ${data.summary?.total_latency_ms}ms`)
    } catch (err: any) {
      toast.error(err.message)
    } finally { setRunning(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-lg z-10 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/8 flex items-center justify-center">
              <Play className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-900">{pipeline.name}</p>
              <p className="text-xs text-zinc-400">{nodeCount} step{nodeCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {nodeCount === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-zinc-500 mb-3">No agents added yet.</p>
              <Button onClick={() => { onClose(); router.push(`/pipelines/${pipeline.id}`) }}
                className="rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 gap-2">
                Open Editor →
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Input</label>
                <Textarea value={input} onChange={e => setInput(e.target.value)} rows={4}
                  className="rounded-xl border-zinc-200 font-mono text-xs resize-none" />
              </div>
              <Button onClick={run} disabled={running}
                className="w-full rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
                {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : <><Play className="h-4 w-4" /> Run Pipeline</>}
              </Button>
              {result && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1 text-green-600 font-semibold"><CheckCircle className="h-3.5 w-3.5" /> Done</span>
                    <span>{result.latency}ms</span>
                    <span>${result.cost.toFixed(6)}</span>
                  </div>
                  <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 font-mono text-xs text-zinc-700 max-h-[160px] overflow-auto whitespace-pre-wrap">
                    {typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2)}
                  </div>
                  <button onClick={() => router.push(`/pipelines/${pipeline.id}?tab=history`)}
                    className="text-xs text-primary font-semibold hover:underline">
                    View full trace →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Pattern badge ────────────────────────────────────────────────────────────

function PatternBadge({ pattern }: { pattern?: PatternType }) {
  if (!pattern || pattern === "linear") return null
  const map: Record<PatternType, { label: string; color: string; icon: React.ReactNode }> = {
    linear:   { label: "Sequential", color: "bg-zinc-100 text-zinc-500",  icon: <ArrowRight className="h-3 w-3" /> },
    parallel: { label: "Parallel",   color: "bg-blue-50 text-blue-600",   icon: <Zap className="h-3 w-3" /> },
    branch:   { label: "Condition",  color: "bg-amber-50 text-amber-600", icon: <GitBranch className="h-3 w-3" /> },
    subagent: { label: "Nested",     color: "bg-violet-50 text-violet-600",icon: <Cpu className="h-3 w-3" /> },
    mixed:    { label: "Mixed",      color: "bg-green-50 text-green-600",  icon: <Layers className="h-3 w-3" /> },
  }
  const m = map[pattern]
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", m.color)}>
      {m.icon} {m.label}
    </span>
  )
}

// ─── Pipeline card ────────────────────────────────────────────────────────────

function PipelineCard({ pipeline, onDelete, onRun }: {
  pipeline: Pipeline
  onDelete: (id: string) => void
  onRun:    (p: Pipeline) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const nodeCount  = pipeline.dag?.nodes?.length ?? 0
  const pattern    = (pipeline.dag as any)?.pattern as PatternType | undefined
  const runCount   = pipeline.run_count ?? 0
  const successPct = runCount > 0 && (pipeline.success_count ?? 0) > 0
    ? Math.round(((pipeline.success_count ?? 0) / runCount) * 100)
    : null

  const handleDelete = async () => {
    if (!confirm(`Delete "${pipeline.name}"?`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Delete failed") }
      toast.success("Pipeline deleted"); onDelete(pipeline.id)
    } catch (err: any) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  const handleClone = async () => {
    try {
      const res = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${pipeline.name} (copy)`, description: pipeline.description, is_public: false, dag: pipeline.dag }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Clone failed")
      toast.success("Cloned!"); window.location.reload()
    } catch (err: any) { toast.error(err.message) }
  }

  return (
    <div className="bg-white border border-zinc-100 rounded-2xl p-5 hover:border-zinc-200 hover:shadow-md transition-all duration-200 group"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>

      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
          <Layers className="h-5 w-5 text-primary" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="font-bold text-zinc-900 text-sm truncate">{pipeline.name}</h3>
            <PatternBadge pattern={pattern} />
            {pipeline.is_public ? <Globe className="h-3.5 w-3.5 text-zinc-400" /> : <Lock className="h-3.5 w-3.5 text-zinc-400" />}
            {runCount > 50 && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                <Flame className="h-2.5 w-2.5" /> Popular
              </span>
            )}
          </div>

          {/* Description = outcome focus */}
          {pipeline.description ? (
            <p className="text-xs text-zinc-500 mb-2 leading-relaxed line-clamp-1">{pipeline.description}</p>
          ) : (
            <p className="text-xs text-zinc-300 mb-2 italic">No description — add one in the editor</p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-[11px] text-zinc-400 flex-wrap">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" /> {nodeCount} step{nodeCount !== 1 ? "s" : ""}
            </span>
            {runCount > 0 && (
              <span className="flex items-center gap-1 nums">
                <Play className="h-3 w-3" /> {formatNumber(runCount)} runs
              </span>
            )}
            {successPct !== null && (
              <span className={cn("flex items-center gap-1 nums font-semibold",
                successPct >= 90 ? "text-green-600" : successPct >= 70 ? "text-amber-600" : "text-red-500")}>
                <BarChart3 className="h-3 w-3" /> {successPct}% success
              </span>
            )}
            {runCount === 0 && (
              <span className="text-zinc-300">Not run yet</span>
            )}
            <span className="ml-auto flex-shrink-0">Updated {formatDate(pipeline.updated_at)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Run — primary action */}
          <Button size="sm" onClick={() => onRun(pipeline)}
            className="rounded-xl bg-primary text-white hover:bg-primary/90 gap-1.5 font-semibold h-8 text-xs">
            <Play className="h-3.5 w-3.5" /> Run
          </Button>

          {/* Menu */}
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-white border border-zinc-100 rounded-2xl shadow-xl p-1.5 w-44">
                  <Link href={`/pipelines/${pipeline.id}`}>
                    <button onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 rounded-xl">
                      <Layers className="h-3.5 w-3.5" /> Edit pipeline
                    </button>
                  </Link>
                  <button onClick={() => { setMenuOpen(false); handleClone() }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 rounded-xl">
                    <Copy className="h-3.5 w-3.5" /> Clone
                  </button>
                  <div className="my-1 border-t border-zinc-100" />
                  <button onClick={() => { setMenuOpen(false); handleDelete() }} disabled={deleting}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl">
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Node chips */}
      {nodeCount > 0 && (
        <div className="flex items-center gap-1.5 mt-4 pt-4 border-t border-zinc-50 overflow-x-auto scrollbar-hide">
          {pipeline.dag.nodes.map((node, i) => (
            <div key={i} className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] bg-zinc-50 border border-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium">
                {node.label || `Step ${i + 1}`}
              </span>
              {i < nodeCount - 1 && <ChevronRight className="h-3 w-3 text-zinc-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Template starter card ────────────────────────────────────────────────────

function TemplateStarterCard({ template, onUse }: { template: Template; onUse: (t: Template) => void }) {
  return (
    <button onClick={() => onUse(template)}
      className="group flex items-center gap-3 bg-white border border-zinc-100 rounded-2xl p-4 hover:border-primary/30 hover:bg-primary/[0.02] transition-all text-left w-full"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="w-10 h-10 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-center text-xl flex-shrink-0">
        {template.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 group-hover:text-primary transition-colors truncate">{template.name}</p>
        <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{template.description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-zinc-300 group-hover:text-primary transition-colors flex-shrink-0" />
    </button>
  )
}

// ─── Composer modal ───────────────────────────────────────────────────────────

function ComposerModal({ open, onClose, onCreated, prefillGoal, prefillPattern }: {
  open: boolean; onClose: () => void; onCreated: (p: Pipeline) => void
  prefillGoal?: string; prefillPattern?: PatternType
}) {
  const router = useRouter()
  const [goal,        setGoal]        = useState(prefillGoal ?? "")
  const [budget,      setBudget]      = useState("")
  const [pattern,     setPattern]     = useState<PatternType | "">(prefillPattern ?? "")
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState<ComposerResult | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)

  useEffect(() => {
    if (prefillGoal)    setGoal(prefillGoal)
    if (prefillPattern) setPattern(prefillPattern)
  }, [prefillGoal, prefillPattern])

  const PATTERNS: Array<{ value: PatternType; label: string; desc: string; icon: React.ReactNode }> = [
    { value: "linear",   label: "Sequential",   desc: "A → B → C one after another",   icon: <ArrowRight className="h-4 w-4" /> },
    { value: "parallel", label: "Run Together", desc: "A → (B + C) → D at same time",  icon: <Zap className="h-4 w-4" /> },
    { value: "branch",   label: "Condition",    desc: "A → if X then B else C",        icon: <GitBranch className="h-4 w-4" /> },
    { value: "subagent", label: "Nested",       desc: "Main pipeline calls sub-workflow",icon: <Cpu className="h-4 w-4" /> },
  ]

  const compose = async () => {
    if (!goal.trim()) { toast.error("Describe your goal"); return }
    setLoading(true); setResult(null)
    try {
      const res  = await fetch("/api/composer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ goal: goal.trim(), maxBudgetUsd: budget ? parseFloat(budget) : undefined, preferredPattern: pattern || undefined }),
      })
      const data: ComposerResult = await res.json()
      setResult(data)
      if (!data.ok) toast.error(data.error ?? "Composer failed")
    } catch (err: any) { toast.error(err.message) } finally { setLoading(false) }
  }

  const save = async () => {
    if (!result?.dag) return
    setSaveLoading(true)
    try {
      const res  = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: result.dag.description.slice(0, 80), description: `Auto-built: "${goal.slice(0, 180)}"`, dag: { nodes: result.dag.nodes, edges: result.dag.edges }, is_public: false, tags: [result.dag.pattern, "ai-composed"] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      toast.success("Pipeline created!"); onCreated(data); onClose()
      router.push(`/pipelines/${data.id}`)
    } catch (err: any) { toast.error(err.message) } finally { setSaveLoading(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!loading) onClose() }} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-2xl z-10 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-zinc-100 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-zinc-900">AI Workflow Composer</h2>
            <p className="text-sm text-zinc-400 mt-0.5">Describe your goal — AI picks the best agents and wires them up for you.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">What do you want to automate? *</label>
            <Textarea value={goal} onChange={e => setGoal(e.target.value)} rows={3} maxLength={1000}
              placeholder={`e.g. "Classify support tickets by urgency and draft replies"\n"Research competitors and write a comparison report"\n"Translate content to French and Spanish at the same time"`}
              className="rounded-xl border-zinc-200 text-sm resize-none" />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Structure <span className="text-zinc-300 font-normal">(optional — AI decides)</span></label>
            <div className="grid grid-cols-2 gap-2">
              {PATTERNS.map(p => (
                <button key={p.value}
                  onClick={() => setPattern(prev => prev === p.value ? "" : p.value)}
                  className={cn("flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                    pattern === p.value ? "border-primary/40 bg-primary/[0.04] ring-1 ring-primary/20" : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50")}>
                  <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    pattern === p.value ? "bg-primary/10 text-primary" : "bg-zinc-50 text-zinc-400")}>
                    {p.icon}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-zinc-900">{p.label}</p>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{p.desc}</p>
                  </div>
                  {pattern === p.value && <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 ml-auto mt-0.5" />}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Max cost per run <span className="text-zinc-300 font-normal">(optional)</span></label>
            <div className="relative max-w-[160px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">$</span>
              <input type="number" min="0" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} placeholder="0.10"
                className="w-full h-9 pl-7 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 transition-all" />
            </div>
          </div>
          {result && (
            <div className={cn("rounded-xl border p-4 space-y-3", result.ok ? "border-green-100 bg-green-50/50" : "border-red-100 bg-red-50/50")}>
              {result.ok && result.dag ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm font-semibold text-zinc-900">Workflow designed!</p>
                    <PatternBadge pattern={result.dag.pattern} />
                    <span className="text-xs text-zinc-400 ml-auto">{Math.round(result.confidence * 100)}% confidence</span>
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">{result.reasoning}</p>
                  <div className="bg-white border border-zinc-100 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">{result.dag.nodes.length} steps</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {result.dag.nodes.map((n: any, i: number) => (
                        <div key={n.id} className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-zinc-700 bg-zinc-50 border border-zinc-100 rounded-lg px-2.5 py-1.5">{n.label}</span>
                          {i < result.dag!.nodes.length - 1 && <ArrowRight className="h-3 w-3 text-zinc-300 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    {result.dag.estimatedCost > 0 && <p className="text-[11px] text-zinc-400 mt-2">~${result.dag.estimatedCost.toFixed(4)}/run</p>}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700">Couldn't compose</p>
                    <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
                    <p className="text-xs text-zinc-400 mt-2">Try being more specific, or check that you have active agents in the marketplace.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-zinc-100 bg-zinc-50/50 flex items-center gap-3">
          <Button variant="outline" onClick={onClose} disabled={loading || saveLoading} className="rounded-xl border-zinc-200 flex-1">Cancel</Button>
          {result?.ok ? (
            <Button onClick={save} disabled={saveLoading} className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold gap-2">
              {saveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saveLoading ? "Creating…" : "Save & Open →"}
            </Button>
          ) : (
            <Button onClick={compose} disabled={loading || !goal.trim()}
              className="flex-1 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-white font-semibold gap-2">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Building…</> : <><Sparkles className="h-4 w-4" /> Build Workflow</>}
            </Button>
          )}
          {result?.ok && <Button variant="outline" onClick={() => setResult(null)} disabled={saveLoading} className="rounded-xl border-zinc-200 px-3">↺</Button>}
        </div>
      </div>
    </div>
  )
}

// ─── New pipeline modal ────────────────────────────────────────────────────────

function NewPipelineModal({ open, onClose, onCreated, prefilledAgentId, prefilledAgentName }: {
  open: boolean; onClose: () => void; onCreated: (p: Pipeline) => void
  prefilledAgentId?: string; prefilledAgentName?: string
}) {
  const router = useRouter()
  const [name,     setName]     = useState(prefilledAgentName ? `${prefilledAgentName} Pipeline` : "")
  const [desc,     setDesc]     = useState("")
  const [isPublic, setIsPublic] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState("")

  useEffect(() => {
    if (prefilledAgentName && !name) setName(`${prefilledAgentName} Pipeline`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledAgentName])

  const reset  = () => { setName(""); setDesc(""); setIsPublic(false); setError("") }
  const submit = async () => {
    if (!name.trim()) { setError("Name is required"); return }
    setLoading(true); setError("")
    try {
      const nodes = prefilledAgentId ? [{ id: `node_${Date.now()}`, agent_id: prefilledAgentId, label: prefilledAgentName ?? "Step 1" }] : []
      const res  = await fetch("/api/pipelines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ name: name.trim(), description: desc.trim() || null, is_public: isPublic, dag: { nodes, edges: [] } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      toast.success("Pipeline created!"); onCreated(data); reset(); onClose()
      router.push(`/pipelines/${data.id}`)
    } catch (err: any) { setError(err.message) } finally { setLoading(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { if (!loading) { reset(); onClose() } }} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-zinc-100 w-full max-w-md p-6 z-10">
        <h2 className="text-lg font-bold text-zinc-900 mb-1">New Pipeline</h2>
        <p className="text-sm text-zinc-400 mb-5">
          {prefilledAgentId ? `"${prefilledAgentName}" will be the first step.` : "You'll add agents in the editor."}
        </p>
        {prefilledAgentId && (
          <div className="flex items-center gap-3 bg-primary/[0.04] border border-primary/20 rounded-xl px-3 py-2.5 mb-4">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-900">{prefilledAgentName}</p>
              <p className="text-[11px] text-zinc-400">Step 1 — pre-added from Marketplace</p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">Pipeline name *</label>
            <input type="text" maxLength={100} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="e.g. Support Auto-Responder"
              className="w-full h-10 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-all" />
          </div>
          <div>
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wider block mb-1.5">What does it do? <span className="text-zinc-300 font-normal">(helps teammates understand)</span></label>
            <textarea rows={2} maxLength={500} value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Classifies support tickets by urgency and drafts replies"
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm resize-none focus:outline-none focus:border-zinc-400 transition-all" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => setIsPublic(v => !v)} className={cn("w-9 h-5 rounded-full transition-colors relative flex-shrink-0", isPublic ? "bg-primary" : "bg-zinc-200")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", isPublic ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <span className="text-sm font-medium text-zinc-900">Share publicly</span>
          </label>
          {error && <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2"><AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {error}</div>}
        </div>
        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={() => { if (!loading) { reset(); onClose() } }} className="flex-1 rounded-xl border-zinc-200" disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !name.trim()} className="flex-1 rounded-xl bg-zinc-900 text-white hover:bg-zinc-700 font-semibold">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create & Edit →"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

function PipelinesPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const addAgentId   = searchParams.get("add_agent") ?? undefined
  const addAgentName = searchParams.get("agent_name") ? decodeURIComponent(searchParams.get("agent_name")!) : undefined

  const [pipelines,       setPipelines]       = useState<Pipeline[]>([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState("")
  const [showNew,         setShowNew]         = useState(false)
  const [showComposer,    setShowComposer]    = useState(false)
  const [composerGoal,    setComposerGoal]    = useState("")
  const [composerPattern, setComposerPattern] = useState<PatternType | "">("")
  const [tab,             setTab]             = useState<"mine" | "public">("mine")
  const [runningPipeline, setRunningPipeline] = useState<Pipeline | null>(null)
  const [goalInput,       setGoalInput]       = useState("")

  useEffect(() => { if (addAgentId) setShowNew(true) }, [addAgentId])

  const load = useCallback(async (visibility: "mine" | "public") => {
    setLoading(true); setError("")
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (visibility === "public") params.set("public", "true")
      const res  = await fetch(`/api/pipelines?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load")
      setPipelines(data.data ?? [])
    } catch (err: any) { setError(err.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  const handleCreated = (p: Pipeline) => setPipelines(prev => [p, ...prev])
  const handleDelete  = (id: string)  => setPipelines(prev => prev.filter(p => p.id !== id))
  const handleRun     = (p: Pipeline) => setRunningPipeline(p)

  const openComposerWithTemplate = (t: Template) => {
    setComposerGoal(t.goal); setComposerPattern(t.pattern); setShowComposer(true)
  }

  const submitGoal = () => {
    if (!goalInput.trim()) return
    setComposerGoal(goalInput); setComposerPattern(""); setShowComposer(true)
  }

  const hasPipelines = pipelines.length > 0

  return (
    <>
      {runningPipeline && <QuickRunModal pipeline={runningPipeline} onClose={() => setRunningPipeline(null)} />}
      <NewPipelineModal
        open={showNew}
        onClose={() => { setShowNew(false); if (addAgentId) router.replace("/pipelines", { scroll: false }) }}
        onCreated={handleCreated}
        prefilledAgentId={addAgentId}
        prefilledAgentName={addAgentName}
      />
      <ComposerModal
        open={showComposer}
        onClose={() => { setShowComposer(false); setComposerGoal(""); setComposerPattern("") }}
        onCreated={handleCreated}
        prefillGoal={composerGoal}
        prefillPattern={composerPattern as PatternType | undefined}
      />

      <div className="space-y-6">

        {/* ── Hero: describe goal → AI builds pipeline ──────────────────────── */}
        <div className="bg-gradient-to-br from-primary/[0.06] via-primary/[0.03] to-transparent border border-primary/20 rounded-2xl p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-zinc-900">What do you want to automate?</h1>
              <p className="text-xs text-zinc-500 mt-0.5">Describe your goal — AI selects agents and builds the workflow in seconds.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={goalInput}
              onChange={e => setGoalInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitGoal()}
              placeholder='e.g. "Classify support tickets by urgency and draft replies automatically"'
              className="flex-1 h-11 px-4 rounded-xl border border-primary/20 bg-white text-sm focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
            />
            <Button onClick={submitGoal} disabled={!goalInput.trim()}
              className="rounded-xl bg-primary text-white hover:bg-primary/90 font-semibold gap-2 px-5 flex-shrink-0 h-11">
              <Sparkles className="h-4 w-4" /> Build
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-[11px] text-zinc-400">Try:</span>
            {["Classify and reply to support tickets", "Research competitors and compare", "Extract data from documents"].map(hint => (
              <button key={hint} onClick={() => { setGoalInput(hint); setComposerGoal(hint); setComposerPattern(""); setShowComposer(true) }}
                className="text-[11px] text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 bg-white/60 px-2.5 py-1 rounded-full transition-all">
                {hint}
              </button>
            ))}
          </div>
        </div>

        {/* ── Start instantly — templates inline ───────────────────────────── */}
        {!hasPipelines && !loading && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Start instantly</p>
              <button onClick={() => { setComposerGoal(""); setComposerPattern(""); setShowComposer(true) }}
                className="text-xs text-primary font-semibold hover:underline flex items-center gap-1">
                All templates <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TEMPLATES.map(t => <TemplateStarterCard key={t.id} template={t} onUse={openComposerWithTemplate} />)}
            </div>
          </div>
        )}

        {/* ── Tabs + header ─────────────────────────────────────────────────── */}
        {hasPipelines && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1 bg-zinc-50 border border-zinc-100 rounded-xl p-1">
              {(["mine", "public"] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={cn("px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                    tab === t ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-900")}>
                  {t === "mine" ? "My Pipelines" : "Public"}
                  {t === "mine" && pipelines.length > 0 && (
                    <span className="ml-1.5 text-[10px] text-zinc-400">{pipelines.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowNew(true)} className="rounded-xl border-zinc-200 gap-1.5 text-sm h-9">
                <Plus className="h-4 w-4" /> Manual
              </Button>
            </div>
          </div>
        )}

        {/* ── Pipeline list ─────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />)}
          </div>
        ) : pipelines.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-zinc-100 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto mb-3">
              <Layers className="h-6 w-6 text-primary" />
            </div>
            <h3 className="font-semibold text-zinc-900 mb-1">{tab === "mine" ? "Your pipelines will appear here" : "No public pipelines yet"}</h3>
            <p className="text-sm text-zinc-400 mb-4">Use the form above or pick a template to get started in seconds.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pipelines.map(p => <PipelineCard key={p.id} pipeline={p} onDelete={handleDelete} onRun={handleRun} />)}
          </div>
        )}

        {/* ── Network effects: top templates if user has pipelines ──────────── */}
        {hasPipelines && !loading && (
          <div className="border-t border-zinc-100 pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Popular templates</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TEMPLATES.slice(0, 2).map(t => <TemplateStarterCard key={t.id} template={t} onUse={openComposerWithTemplate} />)}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function PipelinesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-36 bg-primary/[0.04] border border-primary/20 rounded-2xl animate-pulse" />
      <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-zinc-50 border border-zinc-100 rounded-2xl animate-pulse" />)}</div>
    </div>
  )
}

export default function PipelinesPage() {
  return (
    <Suspense fallback={<PipelinesSkeleton />}>
      <PipelinesPageInner />
    </Suspense>
  )
}
